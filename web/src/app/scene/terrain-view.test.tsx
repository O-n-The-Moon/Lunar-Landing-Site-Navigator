// The 3D Terrain tab with the three.js scene replaced by a stand-in that records its props: jsdom has no WebGL, and what
// matters here is what the view hands the scene (beacon states, overlays, camera goal) and when it loads things.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import type { GridWorkerRequest, GridWorkerResponse } from '../../workers/grid-score.worker'
import { App } from '../app'
import { fixtureDataSource, type DataSource } from '../data'
import { signalAt } from './site-status'
import { createInitialState, scenarioReducer } from '../state'
import { computeScenarioResults } from '../use-scenario-results'
import type { OpsSceneProps } from './ops-scene'

const mocks = vi.hoisted(() => ({ webgl: true, crash: false, last: null as unknown }))
vi.mock('./webgl', () => ({ hasWebGL: () => mocks.webgl }))
vi.mock('./ops-scene', async () => {
  const { createElement } = await import('react')
  return {
    default: (props: OpsSceneProps) => {
      if (mocks.crash) throw new Error('no GPU')
      mocks.last = props
      return createElement(
        'div',
        { 'data-testid': 'ops-scene', 'data-active': String(props.active) },
        ...props.beacons.map((b) =>
          createElement('button', { key: b.id, type: 'button', onClick: () => props.onFocus(b.id), 'data-signal': b.signal }, `${b.letter} ${b.name} ${b.signal}`),
        ),
        createElement('button', { key: 'pick', type: 'button', onClick: () => props.onPickTerrain(-89.97, 30) }, 'pick terrain'),
      )
    },
  }
})
const scene = () => mocks.last as OpsSceneProps

beforeEach(() => {
  mocks.webgl = true
  mocks.crash = false
  mocks.last = null
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const terrainPanel = () => within(screen.getByRole('tabpanel', { name: '3D Terrain' }))

async function renderTerrain(source: DataSource = fixtureDataSource()) {
  render(<App dataSources={{ source }} />)
  await screen.findByTestId('ops-scene')
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } }) // the fixture ephemeris covers 48 h
  return userEvent.setup()
}

describe('3D Terrain tab', () => {
  it('is the default tab and loads in stages: 2 km heights, then display terrain, then the horizon grid, each once', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = {
      ...fixtures,
      loadGridHeights: vi.fn(fixtures.loadGridHeights),
      loadDisplayTerrain: vi.fn(fixtures.loadDisplayTerrain),
      loadGrid: vi.fn(fixtures.loadGrid),
    }
    const user = await renderTerrain(source)
    expect(screen.getByRole('tab', { name: '3D Terrain' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(source.loadGrid).toHaveBeenCalledTimes(1))
    const order = (fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0]
    expect(order(source.loadGridHeights)).toBeLessThan(order(source.loadDisplayTerrain))
    expect(order(source.loadDisplayTerrain)).toBeLessThan(order(source.loadGrid))

    await user.click(screen.getByRole('tab', { name: 'Opportunity Map' })) // the map shares the loads
    await within(screen.getByRole('tabpanel', { name: 'Opportunity Map' })).findByText(/horizon grid loaded/i)
    expect(source.loadGrid).toHaveBeenCalledTimes(1)
    expect(source.loadGridHeights).toHaveBeenCalledTimes(1)
  })

  it('labels the terrain as display only, with the vertical exaggeration', async () => {
    await renderTerrain()
    expect(terrainPanel().getByText(/Terrain: LOLA 2 km grid · ×3 vertical · display only/)).toBeInTheDocument()
  })

  it('draws a beacon per scenario site whose state is the timeline’s own state at the cursor', async () => {
    await renderTerrain()
    await waitFor(() => expect(scene().beacons.length).toBeGreaterThan(1))
    const state = scenarioReducer(createInitialState({ sites: fixtureSitesFile.sites }), { type: 'setDuration', durationH: 24 })
    const results = computeScenarioResults(state, { ephemeris: fixtureEphemeris, sitesFile: fixtureSitesFile })
    expect(results.sites.length).toBeGreaterThan(1)
    for (const r of results.sites) {
      const beacon = scene().beacons.find((b) => b.id === r.site.id)
      expect(beacon?.signal).toBe(signalAt(r.slipped, state.cursorMs).signal)
    }
    expect(scene().beacons.map((b) => b.letter)).toEqual(['A', 'B'].slice(0, scene().beacons.length))
  })

  it('shows live shadows by default and the window overlay with its "grid-approximate" label once picked', async () => {
    const user = await renderTerrain()
    await waitFor(() => expect(scene().shadow).not.toBeNull())
    expect(scene().overlay).toBeNull()
    expect(terrainPanel().getByRole('button', { name: 'Live shadows' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(terrainPanel().getByRole('button', { name: 'Sun' }))
    expect(terrainPanel().getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'true')
    expect(scene().shadow).toBeNull() // overlays replace the shadows
    expect(terrainPanel().getByText(/grid-approximate \(2 km grid\)/)).toBeInTheDocument()
  })

  it('loads the PGDA layers only when a PGDA overlay is picked', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadPgda: vi.fn(fixtures.loadPgda) }
    const user = await renderTerrain(source)
    await waitFor(() => expect(scene().shadow).not.toBeNull())
    expect(source.loadPgda).not.toHaveBeenCalled()
    await user.click(terrainPanel().getByRole('button', { name: 'PGDA Sun' }))
    await waitFor(() => expect(source.loadPgda).toHaveBeenCalledTimes(1))
  })

  it('clicking a beacon focuses that site and flies the camera to it', async () => {
    const user = await renderTerrain()
    await waitFor(() => expect(scene().beacons.length).toBeGreaterThan(1))
    const overview = scene().goal
    const other = scene().beacons.find((b) => !b.focused)
    if (!other) throw new Error('expected an unfocused beacon')
    await user.click(terrainPanel().getByRole('button', { name: new RegExp(`^${other.letter} `) }))
    await waitFor(() => expect(scene().beacons.find((b) => b.id === other.id)?.focused).toBe(true))
    expect(scene().goal.nonce).not.toBe(overview.nonce)
    expect(scene().goal.distanceKm).toBeLessThan(overview.distanceKm)
    await user.click(terrainPanel().getByRole('button', { name: 'Reset view' }))
    expect(scene().goal.distanceKm).toBe(overview.distanceKm)
  })

  it('clicking the terrain adds a custom site through the same flow as the 2D map', async () => {
    const user = await renderTerrain()
    await waitFor(() => expect(scene().shadow).not.toBeNull()) // the grid is loaded
    const before = scene().beacons.length
    await user.click(terrainPanel().getByRole('button', { name: 'pick terrain' }))
    expect(await terrainPanel().findByText(/Added custom site 89\.97°S 30\.\d+°E \(snapped/)).toBeInTheDocument()
    await waitFor(() => expect(scene().beacons.length).toBe(before + 1))
  })

  it('clicking a terrain cell that is already a site says so instead of claiming it added one', async () => {
    const user = await renderTerrain()
    await waitFor(() => expect(scene().shadow).not.toBeNull())
    const pick = () => terrainPanel().getByRole('button', { name: 'pick terrain' })
    await user.click(pick())
    await terrainPanel().findByText(/Added custom site/)
    const count = scene().beacons.length
    await user.click(pick())
    expect(await terrainPanel().findByText(/That grid cell is already in the scenario\./)).toBeInTheDocument()
    expect(terrainPanel().queryByText(/Added custom site/)).not.toBeInTheDocument()
    expect(scene().beacons.length).toBe(count)
  })

  it('stops rendering while another tab is showing', async () => {
    const user = await renderTerrain()
    expect(scene().active).toBe(true)
    await user.click(screen.getByRole('tab', { name: 'Compare' }))
    await waitFor(() => expect(scene().active).toBe(false))
  })

  it('falls back to the 2D map with a notice when the scene throws', async () => {
    mocks.crash = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('tabpanel', { name: '3D Terrain' })
    expect(await terrainPanel().findByText(/could not start on this device.*showing the 2D opportunity map instead/i)).toBeInTheDocument()
    expect(terrainPanel().getByRole('radiogroup', { name: /layer/i })).toBeInTheDocument()
  })

  it('falls back to the 2D map when WebGL 2 is missing', async () => {
    mocks.webgl = false
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('tabpanel', { name: '3D Terrain' })
    expect(await terrainPanel().findByText(/needs WebGL 2/i)).toBeInTheDocument()
    expect(screen.queryByTestId('ops-scene')).not.toBeInTheDocument()
  })
})

describe('window scores with several views mounted', () => {
  class FakeWorker {
    static instances: FakeWorker[] = []
    posted: GridWorkerRequest[] = []
    onmessage: ((e: MessageEvent<GridWorkerResponse>) => void) | null = null
    onerror: ((e: ErrorEvent) => void) | null = null
    constructor() {
      FakeWorker.instances.push(this)
    }
    postMessage(msg: GridWorkerRequest) {
      this.posted.push(msg)
    }
    terminate() {}
    scoreRequests() {
      return this.posted.filter((m): m is Extract<GridWorkerRequest, { type: 'score' }> => m.type === 'score')
    }
  }

  it('runs one worker and one scoring job for the 3D overlay and the Map tab together, and drapes the cell values un-flipped', async () => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    const user = await renderTerrain()
    await waitFor(() => expect(scene().shadow).not.toBeNull())
    await user.click(terrainPanel().getByRole('button', { name: 'Sun' })) // window overlay in 3D
    await user.click(screen.getByRole('tab', { name: 'Opportunity Map' }))
    await user.click(within(screen.getByRole('tabpanel', { name: 'Opportunity Map' })).getByRole('radio', { name: 'Window Sun' }))
    await waitFor(() => expect(FakeWorker.instances.flatMap((w) => w.scoreRequests()).length).toBeGreaterThan(0), { timeout: 2000 })
    await new Promise((r) => setTimeout(r, 400)) // longer than the debounce: a second consumer would have sent its own job by now
    expect(FakeWorker.instances).toHaveLength(1)
    const requests = FakeWorker.instances[0].scoreRequests()
    expect(requests).toHaveLength(1)

    // 8 × 8 grid in grid order (iy = 0 is the lowest y): only cell (ix 4, iy 4) is 100 %.
    const sunPct = new Float32Array(64).fill(0)
    sunPct[4 * 8 + 4] = 100
    const scores = { startMs: requests[0].startMs, endMs: requests[0].endMs, nx: 8, ny: 8, sunPct, earthPct: sunPct, bothPct: sunPct }
    act(() => FakeWorker.instances[0].onmessage?.({ data: { type: 'result', requestId: requests[0].requestId, scores, elapsedMs: 5 } } as MessageEvent<GridWorkerResponse>))
    await user.click(screen.getByRole('tab', { name: '3D Terrain' }))
    await waitFor(() => expect(scene().overlay).not.toBeNull())
    const overlay = scene().overlay
    if (!overlay) throw new Error('expected an overlay')
    const alpha = (ix: number, iy: number) => overlay.rgba[(iy * overlay.nx + ix) * 4 + 3]
    expect(overlay.nx).toBe(8)
    expect(alpha(4, 4)).toBe(255)
    expect(overlay.rgba[(4 * 8 + 4) * 4]).toBeGreaterThan(overlay.rgba[(3 * 8 + 4) * 4]) // the 100 % cell is brighter than its neighbour
    expect(overlay.rgba[(4 * 8 + 4) * 4 + 1]).toBeGreaterThan(overlay.rgba[(4 * 8 + 3) * 4 + 1])
  })
})
