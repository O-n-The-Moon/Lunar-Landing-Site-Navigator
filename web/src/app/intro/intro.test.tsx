// The intro overlay inside the real App: when it plays, what the boot log says, how it ends. The 3D scenes are stand-ins
// (jsdom has no WebGL); the skip rules themselves are unit-tested in intro-rules.test.ts.
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureEphemerisManifest, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource, type DataSource } from '../data'
import { INTRO_MS } from './intro-rules'

const mocks = vi.hoisted(() => ({ webgl: true }))
vi.mock('../scene/webgl', () => ({ hasWebGL: () => mocks.webgl }))
vi.mock('../scene/ops-scene', () => ({ default: () => null }))
vi.mock('../surface/surface-scene', () => ({ default: () => null }))
vi.mock('./intro-scene', () => ({ default: () => <div data-testid="intro-scene" /> }))

/** Fixture data presented as real data, so the intro (which skips synthetic data) is allowed to play. */
const realKind = (): DataSource => ({ ...fixtureDataSource(), kind: 'data' })

const setUrl = (search: string) => window.history.replaceState({}, '', `/${search}`)
const dialog = () => screen.queryByRole('dialog', { name: 'Introduction' })

beforeEach(() => {
  mocks.webgl = true
  setUrl('')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setUrl('')
})

async function renderApp(source: DataSource) {
  render(<App dataSources={{ source }} />)
  await screen.findByRole('region', { name: 'Mission deck' })
}

describe('intro', () => {
  it('plays over the console and reads its numbers from the loaded data', async () => {
    await renderApp(realKind())
    const intro = within(dialog()!)
    const log = intro.getByRole('list', { name: 'Loading status' })
    expect(log).toHaveTextContent(`EPHEMERIS · ${fixtureEphemerisManifest.count.toLocaleString('en-US')} epochs`)
    expect(await screen.findByTestId('intro-scene')).toBeInTheDocument() // the lazy chunk
    // The console is mounted underneath but unreachable while the intro plays.
    expect(screen.getByRole('region', { name: 'Mission deck' }).closest('.console')).toHaveAttribute('inert')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(log).toHaveTextContent(`SITES · ${fixtureSitesFile.sites.length} curated`)
    expect(log.querySelectorAll('li')).toHaveLength(4)
  })

  it('ends by itself at the time budget and hands the console back', async () => {
    await renderApp(realKind())
    expect(dialog()).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTRO_MS - 200)
    })
    expect(dialog()).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(dialog()).not.toBeInTheDocument()
    expect(document.querySelector('.console')).not.toHaveAttribute('inert')
  })

  it('is skipped by the Skip button', async () => {
    await renderApp(realKind())
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /skip/i }))
    expect(dialog()).not.toBeInTheDocument()
    expect(document.querySelector('.console')).not.toHaveAttribute('inert')
  })

  it('is skipped by Escape', async () => {
    await renderApp(realKind())
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).keyboard('{Escape}')
    expect(dialog()).not.toBeInTheDocument()
  })

  it('does not play with ?nointro, for reduced motion, without WebGL or on fixture data', async () => {
    setUrl('?nointro')
    await renderApp(realKind())
    expect(dialog()).not.toBeInTheDocument()
    cleanup()

    setUrl('')
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    await renderApp(realKind())
    expect(dialog()).not.toBeInTheDocument()
    cleanup()
    vi.unstubAllGlobals()

    mocks.webgl = false
    await renderApp(realKind())
    expect(dialog()).not.toBeInTheDocument()
    cleanup()

    mocks.webgl = true
    await renderApp(fixtureDataSource())
    expect(dialog()).not.toBeInTheDocument()
  })
})
