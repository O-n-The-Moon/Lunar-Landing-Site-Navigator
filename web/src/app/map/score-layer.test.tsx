import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VISIBILITY_OPTS, type GridScores } from '../../engine'
import { fixtureEphemeris, fixtureGrid } from '../../engine/__fixtures__'
import type { GridWorkerRequest, GridWorkerResponse } from '../../workers/grid-score.worker'
import { rasterValueAt, pgdaToGridOrder, NO_DATA } from './pgda-raster'
import { DEBOUNCE_MS, scoresToRaster, useGridScores, windowScoresToShow, type GridScoresState } from './score-layer'

/** A stand-in worker that records requests; the test answers them by hand. */
class FakeWorker {
  posted: GridWorkerRequest[] = []
  onmessage: ((e: MessageEvent<GridWorkerResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  postMessage(msg: GridWorkerRequest) {
    this.posted.push(msg)
  }
  terminate() {
    this.terminated = true
  }
  scores() {
    return this.posted.filter((m): m is Extract<GridWorkerRequest, { type: 'score' }> => m.type === 'score')
  }
  reply(msg: GridWorkerResponse) {
    act(() => this.onmessage?.({ data: msg } as MessageEvent<GridWorkerResponse>))
  }
}

const scoresFor = (startMs: number): GridScores => ({
  startMs,
  endMs: startMs + 1,
  nx: 1,
  ny: 1,
  sunPct: new Float32Array([startMs % 100]),
  earthPct: new Float32Array([0]),
  bothPct: new Float32Array([0]),
})

const T0 = fixtureEphemeris.startUtcMs
const H = 3_600_000

function setup(active = true) {
  const worker = new FakeWorker()
  const factory = () => worker as unknown as Worker
  const hook = renderHook(
    ({ startMs, active: on }: { startMs: number; active: boolean }) =>
      useGridScores(fixtureGrid, fixtureEphemeris, startMs, startMs + 24 * H, DEFAULT_VISIBILITY_OPTS, on, factory),
    { initialProps: { startMs: T0, active } },
  )
  const tick = () => act(() => vi.advanceTimersByTime(DEBOUNCE_MS + 1))
  return { worker, hook, tick }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useGridScores', () => {
  it('inits the worker once and scores the window after the debounce', () => {
    const { worker, tick } = setup()
    expect(worker.posted.map((m) => m.type)).toEqual(['init'])
    tick()
    expect(worker.scores()).toHaveLength(1)
    expect(worker.scores()[0].startMs).toBe(T0)
  })

  it('keeps at most one job in flight and sends only the newest parameters when it finishes', () => {
    const { worker, hook, tick } = setup()
    tick()
    const first = worker.scores()[0]
    // Two changes while the first job runs: only the newest is kept.
    hook.rerender({ startMs: T0 + H, active: true })
    tick()
    hook.rerender({ startMs: T0 + 2 * H, active: true })
    tick()
    expect(worker.scores()).toHaveLength(1)
    // The stale result must not be shown, and the newest request goes out.
    worker.reply({ type: 'result', requestId: first.requestId, scores: scoresFor(T0), elapsedMs: 5 })
    expect(hook.result.current.status).toBe('computing')
    expect(worker.scores()).toHaveLength(2)
    const second = worker.scores()[1]
    expect(second.startMs).toBe(T0 + 2 * H)
    worker.reply({ type: 'result', requestId: second.requestId, scores: scoresFor(T0 + 2 * H), elapsedMs: 5 })
    const st = hook.result.current
    expect(st.status).toBe('ready')
    expect(st.status === 'ready' && st.scores.startMs).toBe(T0 + 2 * H)
  })

  it('ignores progress from an older request', () => {
    const { worker, hook, tick } = setup()
    tick()
    const first = worker.scores()[0]
    hook.rerender({ startMs: T0 + H, active: true })
    tick()
    worker.reply({ type: 'progress', requestId: first.requestId, fraction: 0.9 })
    const st = hook.result.current
    expect(st.status === 'computing' && st.progress).toBe(0)
  })

  it('scores nothing while hidden, and catches up when shown', () => {
    const { worker, hook, tick } = setup(false)
    tick()
    expect(worker.scores()).toHaveLength(0)
    hook.rerender({ startMs: T0, active: true })
    tick()
    expect(worker.scores()).toHaveLength(1)
  })

  it('does not create the worker until a view first asks for scores', () => {
    const worker = new FakeWorker()
    const factory = vi.fn(() => worker as unknown as Worker)
    const hook = renderHook(
      ({ on }: { on: boolean }) => useGridScores(fixtureGrid, fixtureEphemeris, T0, T0 + 24 * H, DEFAULT_VISIBILITY_OPTS, on, factory),
      { initialProps: { on: false } },
    )
    act(() => vi.advanceTimersByTime(DEBOUNCE_MS + 1))
    expect(factory).not.toHaveBeenCalled()
    hook.rerender({ on: true })
    expect(factory).toHaveBeenCalledTimes(1)
    // Hiding again keeps the worker (and its 13 MB) rather than rebuilding it.
    hook.rerender({ on: false })
    hook.rerender({ on: true })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('reports an error instead of throwing when the worker cannot be created', async () => {
    const factory = () => {
      throw new Error('module workers unsupported')
    }
    const hook = renderHook(() => useGridScores(fixtureGrid, fixtureEphemeris, T0, T0 + 24 * H, DEFAULT_VISIBILITY_OPTS, true, factory))
    await act(async () => {})
    const st = hook.result.current
    expect(st.status).toBe('error')
    expect(st.status === 'error' && st.message).toBe('module workers unsupported')
  })

  it('does not rescore unchanged parameters when the view is shown again', () => {
    const { worker, hook, tick } = setup()
    tick()
    const job = worker.scores()[0]
    worker.reply({ type: 'result', requestId: job.requestId, scores: scoresFor(T0), elapsedMs: 5 })
    hook.rerender({ startMs: T0, active: false })
    tick()
    hook.rerender({ startMs: T0, active: true })
    tick()
    expect(worker.scores()).toHaveLength(1)
    expect(hook.result.current.status).toBe('ready')
    // A changed window still rescores.
    hook.rerender({ startMs: T0 + H, active: true })
    tick()
    expect(worker.scores()).toHaveLength(2)
  })

  it('terminates the worker on unmount', () => {
    const { worker, hook } = setup()
    hook.unmount()
    expect(worker.terminated).toBe(true)
  })
})

describe('windowScoresToShow', () => {
  const window = { startMs: 100, endMs: 200 }
  const mine: GridScores = { ...scoresFor(100), endMs: 200 }
  const other: GridScores = { ...scoresFor(50), endMs: 150 }
  const ready = (scores: GridScores): GridScoresState => ({ status: 'ready', scores, elapsedMs: 1 })

  it('shows the result for this window as current', () => {
    expect(windowScoresToShow(ready(mine), window.startMs, window.endMs, true)).toEqual({ scores: mine, stale: false })
  })

  it('flags a result scored for another window as stale (the debounce gap after a slip)', () => {
    expect(windowScoresToShow(ready(other), window.startMs, window.endMs, true)).toEqual({ scores: other, stale: true })
  })

  it('shows the previous result while computing, flagged stale when it was for another window', () => {
    const st: GridScoresState = { status: 'computing', progress: 0.3, previous: other }
    expect(windowScoresToShow(st, window.startMs, window.endMs, true)).toEqual({ scores: other, stale: true })
  })

  it('draws nothing once the mission window is outside the ephemeris', () => {
    expect(windowScoresToShow(ready(other), window.startMs, window.endMs, false)).toEqual({ scores: null, stale: false })
    expect(windowScoresToShow(ready(mine), window.startMs, window.endMs, false)).toEqual({ scores: null, stale: false })
  })

  it('has nothing to show before the first result', () => {
    expect(windowScoresToShow({ status: 'idle' }, window.startMs, window.endMs, true)).toEqual({ scores: null, stale: false })
  })
})

describe('scoresToRaster', () => {
  const geom = { originKm: [0, 0] as const, cellKm: 1, nx: 3, ny: 2 }
  // Grid order: row iy = 0 is the lowest y.
  const values = Float32Array.from([10, 20.4, NaN, 70, 99.6, 0])

  it('flips rows to PNG order, rounds to whole percent and marks no data 255', () => {
    expect(Array.from(scoresToRaster(values, 3, 2))).toEqual([70, 100, 0, 10, 20, NO_DATA])
  })

  it('reads back through rasterValueAt at the cell it came from', () => {
    const raster = scoresToRaster(values, 3, 2)
    expect(rasterValueAt(raster, geom, 0.5, 0.5)).toBe(10) // cell (0, 0)
    expect(rasterValueAt(raster, geom, 1.5, 1.5)).toBe(100) // cell (1, 1), 99.6 rounded
    expect(rasterValueAt(raster, geom, 2.5, 0.5)).toBeNull() // cell (2, 0): no data
  })

  it('is the inverse of pgdaToGridOrder for whole percents', () => {
    const whole = Float32Array.from([0, 5, NaN, 50, 99, 100])
    expect(Array.from(pgdaToGridOrder(scoresToRaster(whole, 3, 2), 3, 2))).toEqual(Array.from(whole))
  })

  it('rejects a length that does not match the grid', () => {
    expect(() => scoresToRaster(values, 4, 2)).toThrow(RangeError)
  })
})
