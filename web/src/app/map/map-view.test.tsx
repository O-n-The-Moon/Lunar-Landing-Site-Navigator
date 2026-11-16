import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import type { GridWorkerRequest, GridWorkerResponse } from '../../workers/grid-score.worker'
import { MOON_RADIUS_KM, latLonToKm } from './projection'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

/**
 * The App on fixture data, Map tab open. The fixture PGDA raster is 8 × 8 cells of 2 km: x, y ∈ [−8, 8) km. The map is mocked
 * to 160 px wide, so 1 px = 0.1 km. The fixture grid is the same 8 × 8: (−89.97°, 30°E) is in cell (4, 4), and the
 * no-data cell is (7, 7).
 */
async function openMap() {
  const user = userEvent.setup()
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  await user.click(await screen.findByRole('tab', { name: /opportunity map/i }))
  const plot = await screen.findByRole('img', { name: /opportunity map/i })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 160, height: 160, right: 160, bottom: 160, x: 0, y: 0, toJSON: () => ({}),
  })
  const clickAt = (latDeg: number, lonDeg: number) => {
    const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, latDeg, lonDeg)
    fireEvent.click(plot, { clientX: (xKm + 8) * 10, clientY: (8 - yKm) * 10 })
  }
  const siteNames = () => within(screen.getByRole('group', { name: /^sites/i })).getAllByRole('radio').map((r) => r.closest('label')?.textContent)
  return { user, plot, clickAt, siteNames }
}

describe('MapView', () => {
  it('shows the map with the layer control and the PGDA provenance once the layers load', async () => {
    await openMap()
    expect(screen.getByRole('radiogroup', { name: /layer/i })).toBeInTheDocument()
    expect(screen.getByText(/Source: synthetic test fixture/)).toBeInTheDocument()
    expect(screen.getByText(/observer height not documented by PGDA/)).toBeInTheDocument()
  })

  it('adds a clicked point as a custom site, snapped to its grid cell', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30)
    expect(await screen.findByText(/Added Custom 89\.97°S 30\.\d+°E \(snapped/)).toBeInTheDocument()
    expect(siteNames()).toContainEqual(expect.stringContaining('Custom 89.97°S'))
    expect(screen.getByTestId(/^marker-custom-4-4$/)).toHaveClass('marker-selected')
  })

  it('says so when the clicked cell has no terrain data', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    const before = siteNames().length
    clickAt(-89.67, 45) // cell (7, 7): no data
    expect(await screen.findByText(/No terrain data at that point/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(before)
  })

  it('does not add the same grid cell twice', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30)
    await screen.findByText(/Added Custom/)
    const after = siteNames().length
    clickAt(-89.97, 30)
    expect(await screen.findByText(/already in the scenario/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(after)
  })

  it('refuses a fourth site with a message instead of adding it', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30) // the default scenario has 2 sites, so this fills it
    await screen.findByText(/Added Custom/)
    clickAt(-89.97, -150) // a different, valid cell
    expect(await screen.findByText(/already has 3 sites/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(3)
  })

  it('keeps the chosen layer in the scenario, so it survives switching tabs', async () => {
    const { user } = await openMap()
    await user.click(within(screen.getByRole('radiogroup', { name: /layer/i })).getByRole('radio', { name: /PGDA Earth average/i }))
    await user.click(screen.getByRole('tab', { name: /compare/i }))
    await user.click(screen.getByRole('tab', { name: /opportunity map/i }))
    const group = await screen.findByRole('radiogroup', { name: /layer/i })
    expect(within(group).getByRole('radio', { name: /PGDA Earth average/i })).toBeChecked()
  })

  it('clears the last click message when the layer changes', async () => {
    const { user, clickAt } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30)
    await screen.findByText(/Added Custom/)
    await user.click(within(screen.getByRole('radiogroup', { name: /layer/i })).getByRole('radio', { name: /PGDA Earth average/i }))
    expect(screen.queryByText(/Added Custom/)).not.toBeInTheDocument()
  })

  describe('window-score layer (#29)', () => {
    /** A stand-in for the grid-score worker: records what it is sent; the test answers by hand. */
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
        return this.posted.filter((m) => m.type === 'score')
      }
    }
    const pickWindowLayer = (user: ReturnType<typeof userEvent.setup>, name: string) =>
      user.click(within(screen.getByRole('radiogroup', { name: /layer/i })).getByRole('radio', { name }))

    /** The fixture ephemeris covers 48 h; the default 14-day mission is outside it. */
    const setDurationDays = async (user: ReturnType<typeof userEvent.setup>, days: string) => {
      const duration = screen.getByLabelText('Duration (days)')
      await user.clear(duration)
      await user.type(duration, days)
    }

    it('scores nothing, and says why, when the mission window is outside the ephemeris', async () => {
      FakeWorker.instances = []
      vi.stubGlobal('Worker', FakeWorker)
      const { user } = await openMap()
      await pickWindowLayer(user, 'Window Sun')
      expect(await screen.findByText(/outside the ephemeris, so there is nothing to score/)).toBeInTheDocument()
      await new Promise((r) => setTimeout(r, 400)) // longer than the 300 ms debounce
      expect(FakeWorker.instances.flatMap((w) => w.scoreRequests())).toHaveLength(0)
    })

    it('says so when the browser has no Web Workers (jsdom has none), and still labels the layer as approximate', async () => {
      const { user } = await openMap()
      await setDurationDays(user, '1')
      await pickWindowLayer(user, 'Window Sun')
      expect(await screen.findByText(/need Web Workers/)).toBeInTheDocument()
      expect(screen.getByText(/approximate overview from the 2 km grid/i)).toBeInTheDocument()
    })

    it('scores the window once (debounced), shows the progress and the cell values un-flipped', async () => {
      FakeWorker.instances = []
      vi.stubGlobal('Worker', FakeWorker)
      const { user, plot } = await openMap()
      await setDurationDays(user, '1')
      await pickWindowLayer(user, 'Window Sun')
      await waitFor(() => expect(FakeWorker.instances.flatMap((w) => w.scoreRequests())).toHaveLength(1), { timeout: 2000 })
      expect(FakeWorker.instances).toHaveLength(1)
      const worker = FakeWorker.instances[0]
      const request = worker.scoreRequests()[0]
      if (request.type !== 'score') throw new Error('unreachable')

      act(() => worker.onmessage?.({ data: { type: 'progress', requestId: request.requestId, fraction: 0.5 } } as MessageEvent<GridWorkerResponse>))
      expect(await screen.findByText(/Scoring the 2 km grid… 50 %/)).toBeInTheDocument()

      // 8 × 8 grid in grid order (row iy = 0 is the lowest y): only cell (ix 4, iy 4) is 77 %.
      const sunPct = new Float32Array(64).fill(10)
      sunPct[4 * 8 + 4] = 77
      const scores = { startMs: request.startMs, endMs: request.endMs, nx: 8, ny: 8, sunPct, earthPct: sunPct, bothPct: sunPct }
      act(() => worker.onmessage?.({ data: { type: 'result', requestId: request.requestId, scores, elapsedMs: 40 } } as MessageEvent<GridWorkerResponse>))
      expect(await screen.findByText(/Scored the 2 km grid in 0\.0 s/)).toBeInTheDocument()

      // The fixture grid is the same 8 × 8 of 2 km cells as the 160 px mock plot: 1 px = 0.1 km, x, y ∈ [−8, 8) km.
      const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, -89.97, 30) // cell (4, 4)
      fireEvent.pointerMove(plot, { clientX: (xKm + 8) * 10, clientY: (8 - yKm) * 10 })
      expect(screen.getByText(/Window Sun 77 ?%/)).toBeInTheDocument()
    })
  })
})
