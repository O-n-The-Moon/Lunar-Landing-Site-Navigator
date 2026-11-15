// Grid scoring off the main thread (SPEC-app P0-6, SPEC.md success criterion 6). Wraps the engine's scoreGrid.
//
// Protocol: post `init` once with the loaded grid + ephemeris (structured-cloned, ~13 MB), then one `score` per
// window. Each `score` answers with `progress` events (fraction of rows done, ≤ ~50 per request) and then exactly one
// `result` or `error` carrying the same `requestId`. Requests run in order and can't be interrupted: to drop stale
// work, ignore older requestIds (or terminate the worker and init a new one).
//
// From the app: new Worker(new URL('../workers/grid-score.worker.ts', import.meta.url), { type: 'module' })
import { scoreGrid } from '../engine'
import type { Ephemeris, Grid, GridScores, VisibilityOpts } from '../engine'

export type GridWorkerRequest =
  | { type: 'init'; grid: Grid; eph: Ephemeris }
  | { type: 'score'; requestId: number; startMs: number; endMs: number; opts: VisibilityOpts }

export type GridWorkerResponse =
  | { type: 'progress'; requestId: number; fraction: number }
  /** The score arrays' buffers are transferred, not copied. */
  | { type: 'result'; requestId: number; scores: GridScores; elapsedMs: number }
  /** `requestId` is null when the message itself was not a valid request. */
  | { type: 'error'; requestId: number | null; message: string }

export type PostGridWorkerResponse = (msg: GridWorkerResponse, transfer?: Transferable[]) => void

/** Minimum progress step between two progress events. */
const PROGRESS_STEP = 0.02

/** The worker's message handler, separate from the worker scope so it can be tested directly. */
export function createGridScoreHandler(post: PostGridWorkerResponse): (msg: GridWorkerRequest) => void {
  let data: { grid: Grid; eph: Ephemeris } | null = null

  function score(requestId: number, startMs: number, endMs: number, opts: VisibilityOpts): void {
    if (!data) {
      post({ type: 'error', requestId, message: 'grid worker: send init (grid + ephemeris) before score' })
      return
    }
    let lastPosted = 0
    const t0 = performance.now()
    try {
      const scores = scoreGrid(data.grid, data.eph, startMs, endMs, opts, (fraction) => {
        if (fraction - lastPosted < PROGRESS_STEP && fraction < 1) return
        lastPosted = fraction
        post({ type: 'progress', requestId, fraction })
      })
      const elapsedMs = performance.now() - t0
      post({ type: 'result', requestId, scores, elapsedMs }, [scores.sunPct.buffer, scores.earthPct.buffer, scores.bothPct.buffer])
    } catch (e) {
      post({ type: 'error', requestId, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (msg) => {
    switch (msg.type) {
      case 'init':
        data = { grid: msg.grid, eph: msg.eph }
        return
      case 'score':
        score(msg.requestId, msg.startMs, msg.endMs, msg.opts)
        return
      default:
        post({ type: 'error', requestId: null, message: `grid worker: unknown message type ${String((msg as { type?: unknown }).type)}` })
    }
  }
}

/** The parts of DedicatedWorkerGlobalScope used here (the app's TS lib is DOM, not WebWorker). */
interface WorkerScope {
  postMessage(msg: GridWorkerResponse, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent<GridWorkerRequest>) => void): void
}

// Only attach inside a worker: tests import this module in jsdom, where `window` exists.
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  const scope = self as unknown as WorkerScope
  const handle = createGridScoreHandler((msg, transfer = []) => scope.postMessage(msg, transfer))
  scope.addEventListener('message', (e) => handle(e.data))
}
