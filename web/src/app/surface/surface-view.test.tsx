// The Surface tab with the three.js scene replaced by a stand-in that records its props (jsdom has no WebGL).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import type { SurfaceSceneProps } from './surface-scene'

const mocks = vi.hoisted(() => ({ webgl: true, crash: false, last: null as unknown }))
vi.mock('../scene/webgl', () => ({ hasWebGL: () => mocks.webgl }))
vi.mock('../scene/ops-scene', () => ({ default: () => null }))
vi.mock('./surface-scene', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: SurfaceSceneProps) => {
      if (mocks.crash) throw new Error('no GPU')
      mocks.last = props
      return createElement('div', {
        'data-testid': 'surface-scene',
        'data-active': String(props.active),
        'data-yaw': String(props.yawDeg),
        'data-sun-visible': String(props.sun?.visible),
        'data-earth-visible': String(props.earth?.visible),
      })
    },
  }
})
const scene = () => mocks.last as SurfaceSceneProps

beforeEach(() => {
  mocks.webgl = true
  mocks.crash = false
  mocks.last = null
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  Element.prototype.setPointerCapture = vi.fn() // jsdom has none
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The App on fixture data with a 1-day mission (the fixture ephemeris covers 48 h), Surface tab open. The time control is the deck's. */
async function openSurface() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  await screen.findByRole('heading', { name: 'Scenario' })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Surface' }))
  const region = await screen.findByRole('region', { name: 'Surface view' })
  const stage = within(region).getByRole('group', { name: /^Surface view\./ })
  const sceneEl = await screen.findByTestId('surface-scene')
  return { region, stage, sceneEl }
}

describe('Surface tab', () => {
  it('stands at the focused site: HUD names it, the scene gets its own horizon mask and the engine’s Sun and Earth', async () => {
    const { region } = await openSurface()
    expect(region.querySelector('.surface-site')?.textContent).toMatch(/\S/)
    expect(region.querySelector('.surface-site .site-letter')).toHaveTextContent('A')
    expect(scene().maskDeg.length * scene().azStepDeg).toBeCloseTo(360, 9)
    expect(scene().sun?.radiusDeg).toBeGreaterThan(0.2) // the Sun's disk is ~0.27°, not a point
    expect(scene().earth?.illuminatedFraction).toBeGreaterThanOrEqual(0)
    expect(scene().earth?.illuminatedFraction).toBeLessThanOrEqual(1)
    expect(scene().tracks?.sun.length).toBeGreaterThan(1)
    expect(scene().tracks?.sun.some((p) => p.dayTick === 1)).toBe(true)
  })

  it('says lit / blocked exactly as the timeline does (the scene’s visible flag and the HUD agree) at nine times', async () => {
    const { region, sceneEl } = await openSurface()
    const slider = screen.getByLabelText('Time in mission') as HTMLInputElement
    const start = Number(slider.min)
    const end = Number(slider.max)
    const seen = new Set<string>()
    for (let k = 0; k <= 8; k++) {
      fireEvent.change(slider, { target: { value: String(start + ((end - start) * k) / 8) } })
      const sunLine = region.querySelector('[data-body="sun"]')
      expect(sunLine).not.toBeNull()
      const visible = sceneEl.getAttribute('data-sun-visible') === 'true'
      expect(sunLine?.textContent).toMatch(visible ? /^SUN LIT · \d+ % VISIBLE/ : /^SUN BLOCKED/)
      const earthLine = region.querySelector('[data-body="earth"]')
      expect(earthLine?.textContent).toMatch(sceneEl.getAttribute('data-earth-visible') === 'true' ? /^EARTH IN VIEW/ : /^EARTH (BLOCKED|OUT OF LINK)/)
      seen.add(String(visible))
    }
    expect(seen.size).toBe(2) // the fixture sun both rises and sets over the day, or this proves nothing
  })

  it('draws the Sun below the real ridge whenever it names a ridge: "blocked · ridge" means elevation under the horizon', async () => {
    const { region } = await openSurface()
    const slider = screen.getByLabelText('Time in mission') as HTMLInputElement
    const start = Number(slider.min)
    const end = Number(slider.max)
    let ridge = 0
    for (let k = 0; k <= 24; k++) {
      fireEvent.change(slider, { target: { value: String(start + ((end - start) * k) / 24) } })
      const sun = scene().sun
      const text = region.querySelector('[data-body="sun"]')?.textContent ?? ''
      if (/ridge at/.test(text)) {
        ridge++
        expect(sun && sun.elevDeg < sun.horizonDeg - sun.radiusDeg).toBe(true)
      }
      if (/^SUN LIT/.test(text)) expect(sun?.visible).toBe(true)
    }
    expect(ridge).toBeGreaterThan(0)
  })

  it('turns with the arrow keys (5°, 15° with Shift) when the stage has focus', async () => {
    const user = userEvent.setup()
    const { stage, sceneEl } = await openSurface()
    const yaw = () => Number(sceneEl.getAttribute('data-yaw'))
    const before = yaw()
    stage.focus()
    await user.keyboard('{ArrowRight}')
    expect((yaw() - before + 360) % 360).toBeCloseTo(5, 5)
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect((yaw() - before + 360) % 360).toBeCloseTo(350, 5) // 5° − 15° = −10°
  })

  it('does not start a drag when a HUD button is pressed, but does when the stage is', async () => {
    const { region, stage, sceneEl } = await openSurface()
    const yaw = () => sceneEl.getAttribute('data-yaw')
    const before = yaw()
    fireEvent.pointerDown(within(region).getByRole('button', { name: /follow sun/i }), { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 300, pointerId: 1 })
    expect(yaw()).toBe(before)
    fireEvent.pointerDown(stage, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 300, pointerId: 1 })
    expect(yaw()).not.toBe(before)
  })

  it('toggles Follow Sun with the button', async () => {
    const user = userEvent.setup()
    const { region } = await openSurface()
    const follow = within(region).getByRole('button', { name: /follow sun/i })
    expect(follow).toHaveAttribute('aria-pressed', 'true')
    await user.click(follow)
    expect(follow).toHaveAttribute('aria-pressed', 'false')
  })

  it('stops rendering while another tab is showing', async () => {
    const { sceneEl } = await openSurface()
    expect(sceneEl).toHaveAttribute('data-active', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }))
    await waitFor(() => expect(screen.getByTestId('surface-scene')).toHaveAttribute('data-active', 'false'))
  })

  it('offers the 2D engineering view with the deck’s time control, and a way back', async () => {
    const user = userEvent.setup()
    const { region } = await openSurface()
    await user.click(within(region).getByRole('button', { name: /engineering view/i }))
    const twoD = screen.getByRole('region', { name: 'Surface view' }) // the section is re-created when the view changes
    expect(within(twoD).getByRole('region', { name: 'Horizon panorama' })).toBeInTheDocument()
    expect(screen.getByLabelText('Time in mission')).toBeInTheDocument()
    await user.click(within(twoD).getByRole('button', { name: /back to 3d/i }))
    expect(await screen.findByTestId('surface-scene')).toBeInTheDocument()
  })

  it('falls back to the 2D horizon view, still with the deck’s time control, when WebGL 2 is missing or the scene throws', async () => {
    mocks.webgl = false
    const { unmount } = render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('heading', { name: 'Scenario' })
    fireEvent.click(screen.getByRole('tab', { name: 'Surface' }))
    const region = await screen.findByRole('region', { name: 'Surface view' })
    expect(within(region).getByText(/needs WebGL 2/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Time in mission')).toBeInTheDocument()
    unmount()

    mocks.webgl = true
    mocks.crash = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('heading', { name: 'Scenario' })
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } }) // the scene is only drawn with a view to draw
    fireEvent.click(screen.getByRole('tab', { name: 'Surface' }))
    expect(await screen.findByText(/could not start on this device/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Time in mission')).toBeInTheDocument()
  })
})
