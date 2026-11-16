// Window-score layer (SPEC-app P0-6 v1, #29): Sun / Earth / Both % for the whole 2 km grid over the mission window,
// computed by the grid-score Web Worker so the UI never blocks.
// One worker per grid: `init` once (grid + ephemeris), then a debounced `score` whenever the window or options change.
//
// The worker can't interrupt a job, so requests are coalesced: at most one job is in flight, and while it runs only
// the newest parameters are kept and sent when it finishes. Nothing is scored while the map is hidden (`active`), and the
// worker is not even created (no ~13 MB copy) until a view first asks for scores.
// Only the newest request's progress/result is shown; anything older is ignored.
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Ephemeris, Grid, GridScores, VisibilityOpts } from '../../engine'
import type { GridWorkerRequest, GridWorkerResponse } from '../../workers/grid-score.worker'
import { useCoreData, useGrid } from '../data'
import { missionEndMs, slippedLandingMs, useScenario } from '../state'
import { missionInCoverage, visibilityOpts } from '../use-scenario-results'
import { NO_DATA } from './pgda-raster'

export type GridScoresState =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'computing'; progress: number; previous: GridScores | null }
  | { status: 'ready'; scores: GridScores; elapsedMs: number }
  | { status: 'error'; message: string; previous: GridScores | null }

export const DEBOUNCE_MS = 300

interface ScoreParams {
  startMs: number
  endMs: number
  opts: VisibilityOpts
}

/** Builds the worker; injectable for tests. */
export type WorkerFactory = () => Worker

const defaultFactory: WorkerFactory = () =>
  new Worker(new URL('../../workers/grid-score.worker.ts', import.meta.url), { type: 'module' })

export function useGridScores(
  grid: Grid | null,
  eph: Ephemeris,
  startMs: number,
  endMs: number,
  opts: VisibilityOpts,
  active = true,
  createWorker: WorkerFactory = defaultFactory,
): GridScoresState {
  const supported = typeof Worker !== 'undefined' || createWorker !== defaultFactory
  const [state, setState] = useState<GridScoresState>({ status: 'idle' })
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const busyRef = useRef(false)
  const pendingRef = useRef<ScoreParams | null>(null)
  const lastScores = useRef<GridScores | null>(null)
  const lastSentRef = useRef<ScoreParams | null>(null)
  // Latched on the first request, so the worker costs nothing for someone who never opens a score layer.
  const [everActive, setEverActive] = useState(false)
  if (active && !everActive) setEverActive(true)

  // One worker per grid. `send` lives here so the message handler can send the pending request.
  const sendRef = useRef<(p: ScoreParams) => void>(() => {})
  useEffect(() => {
    if (!supported || !grid || !everActive) return
    let worker: Worker
    try {
      worker = createWorker()
    } catch (e) {
      // A worker that cannot start must not take the whole app down (the provider sits at the root), only the overlay.
      const message = e instanceof Error ? e.message : 'could not start the grid worker'
      queueMicrotask(() => setState({ status: 'error', message, previous: lastScores.current }))
      return
    }
    workerRef.current = worker
    busyRef.current = false
    pendingRef.current = null
    lastSentRef.current = null
    const send = (p: ScoreParams) => {
      const requestId = ++requestRef.current
      busyRef.current = true
      lastSentRef.current = p
      setState({ status: 'computing', progress: 0, previous: lastScores.current })
      worker.postMessage({ type: 'score', requestId, ...p } satisfies GridWorkerRequest)
    }
    sendRef.current = send
    const finishJob = () => {
      busyRef.current = false
      const next = pendingRef.current
      pendingRef.current = null
      if (next) send(next)
    }
    worker.postMessage({ type: 'init', grid, eph } satisfies GridWorkerRequest)
    worker.onmessage = (e: MessageEvent<GridWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        if (msg.requestId === requestRef.current && !pendingRef.current) {
          setState({ status: 'computing', progress: msg.fraction, previous: lastScores.current })
        }
        return
      }
      // A result or error ends the in-flight job, whichever request it was for.
      const current = msg.requestId === requestRef.current && !pendingRef.current
      if (msg.type === 'result') {
        if (current) {
          lastScores.current = msg.scores
          setState({ status: 'ready', scores: msg.scores, elapsedMs: msg.elapsedMs })
        }
      } else if (current || msg.requestId === null) {
        setState({ status: 'error', message: msg.message, previous: lastScores.current })
      }
      finishJob()
    }
    worker.onerror = (e) => {
      setState({ status: 'error', message: e.message || 'grid worker failed', previous: lastScores.current })
      finishJob()
    }
    return () => {
      worker.terminate()
      workerRef.current = null
      sendRef.current = () => {}
    }
  }, [supported, grid, everActive, eph, createWorker])

  // Debounced scoring of the current window, only while visible.
  useEffect(() => {
    if (!supported || !grid || !active) return
    const timer = window.setTimeout(() => {
      if (!workerRef.current) return
      const p = { startMs, endMs, opts }
      // Coming back to a view with the same window and options: the scores on screen are already right.
      const sent = lastSentRef.current
      if (!busyRef.current && sent && sent.startMs === startMs && sent.endMs === endMs && sent.opts === opts && lastScores.current) return
      if (busyRef.current) pendingRef.current = p
      else sendRef.current(p)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [supported, grid, active, startMs, endMs, opts])

  return supported ? state : { status: 'unsupported' }
}

/**
 * The scores a view may draw for the mission window `[startMs, endMs]`. Out of coverage nothing is drawn (the last
 * result belongs to another window). Otherwise the newest result, or the previous one while a job runs; `stale` is true
 * when what is drawn was scored for a different window, so the view says so instead of presenting it as current.
 */
export function windowScoresToShow(
  state: GridScoresState,
  startMs: number,
  endMs: number,
  inCoverage: boolean,
): { scores: GridScores | null; stale: boolean } {
  if (!inCoverage) return { scores: null, stale: false }
  const scores = state.status === 'ready' ? state.scores : state.status === 'computing' || state.status === 'error' ? state.previous : null
  if (!scores) return { scores: null, stale: false }
  return { scores, stale: scores.startMs !== startMs || scores.endMs !== endMs }
}

/**
 * Score values (grid order `iy · nx + ix`, percent, NaN = no data) as the 8-bit raster the 2D map draws: PNG row order
 * (row `ny − 1 − iy`, see `pgda-raster.ts`), whole percent, 255 = no data. The inverse of `pgdaToGridOrder`.
 */
export function scoresToRaster(values: ArrayLike<number>, nx: number, ny: number): Uint8Array {
  if (values.length !== nx * ny) throw new RangeError(`expected ${nx * ny} values (${nx} × ${ny}), got ${values.length}`)
  const out = new Uint8Array(nx * ny)
  for (let iy = 0; iy < ny; iy++) {
    const row = (ny - 1 - iy) * nx
    for (let ix = 0; ix < nx; ix++) {
      const v = values[iy * nx + ix]
      out[row + ix] = Number.isNaN(v) ? NO_DATA : Math.round(Math.min(100, Math.max(0, v)))
    }
  }
  return out
}

// --- one scoring job per window change, however many views show the scores --------------------------------------------
// The Map tab, the 3D overlay and the 2D fallback all show the same window scores. Each would otherwise start its own
// worker and copy ~13 MB into it, so the provider owns the single `useGridScores` and runs it while any consumer wants it.

interface WindowScores {
  state: GridScoresState
  /** Registers one consumer's demand; returns the function that withdraws it. */
  want: () => () => void
}
const WindowScoresContext = createContext<WindowScores | null>(null)

/** Scores the slipped mission window with the scenario's visibility options while some `useWindowScores(true)` is mounted. */
export function GridScoresProvider({ children, createWorker }: { children: ReactNode; createWorker?: WorkerFactory }) {
  const { ephemeris } = useCoreData()
  const scenario = useScenario()
  const { state: gridState } = useGrid(false) // observing only: the views decide when the grid loads
  const [wanted, setWanted] = useState(0)
  const { sunThreshold, earthMarginDeg, durationH } = scenario
  const startMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)
  // `opts` is an effect dependency of the debounce, so it must be stable.
  const opts = useMemo(() => visibilityOpts({ sunThreshold, earthMarginDeg }), [sunThreshold, earthMarginDeg])
  const grid = gridState.status === 'ready' ? gridState.data : null
  const state = useGridScores(grid, ephemeris, startMs, endMs, opts, wanted > 0 && missionInCoverage(ephemeris, startMs, durationH), createWorker)
  // `want` is stable (setWanted is), so a progress message does not make every consumer withdraw and re-register.
  const want = useCallback(() => {
    setWanted((n) => n + 1)
    return () => setWanted((n) => n - 1)
  }, [])
  const value = useMemo<WindowScores>(() => ({ state, want }), [state, want])
  return createElement(WindowScoresContext.Provider, { value }, children)
}

/** The shared window scores. `wanted`: this view is showing a window-score layer (nothing is scored when no view is). */
export function useWindowScores(wanted: boolean): GridScoresState {
  const ctx = useContext(WindowScoresContext)
  if (!ctx) throw new Error('useWindowScores must be used inside <GridScoresProvider>')
  const { want } = ctx
  useEffect(() => (wanted ? want() : undefined), [wanted, want])
  return ctx.state
}
