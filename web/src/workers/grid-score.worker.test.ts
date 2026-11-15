import { describe, expect, it } from 'vitest'
import { fixtureEphemeris, fixtureGrid } from '../engine/__fixtures__'
import { scoreGrid } from '../engine/grid'
import { DEFAULT_VISIBILITY_OPTS } from '../engine/types'
import type { Grid } from '../engine/types'
import { createGridScoreHandler, type GridWorkerResponse } from './grid-score.worker'

const H_MS = 3_600_000
const T0 = fixtureEphemeris.startUtcMs

/** Handler wired to an in-memory outbox instead of a real worker scope. */
function setup() {
  const sent: { msg: GridWorkerResponse; transfer: Transferable[] }[] = []
  const handle = createGridScoreHandler((msg, transfer = []) => sent.push({ msg, transfer }))
  return { handle, sent, messages: () => sent.map((s) => s.msg) }
}

describe('grid-score worker handler', () => {
  it('scores after init: progress events, then the same scores as scoreGrid', () => {
    const { handle, messages } = setup()
    handle({ type: 'init', grid: fixtureGrid, eph: fixtureEphemeris })
    handle({ type: 'score', requestId: 7, startMs: T0, endMs: T0 + 24 * H_MS, opts: DEFAULT_VISIBILITY_OPTS })

    const out = messages()
    const progress = out.filter((m) => m.type === 'progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((m) => m.requestId === 7)).toBe(true)
    expect(progress.at(-1)).toMatchObject({ fraction: 1 })

    const last = out.at(-1)
    expect(last?.type).toBe('result')
    if (last?.type !== 'result') return
    expect(last.requestId).toBe(7)
    expect(last.elapsedMs).toBeGreaterThanOrEqual(0)
    const want = scoreGrid(fixtureGrid, fixtureEphemeris, T0, T0 + 24 * H_MS, DEFAULT_VISIBILITY_OPTS)
    expect(last.scores).toEqual(want)
  })

  it('transfers the three score buffers with the result', () => {
    const { handle, sent } = setup()
    handle({ type: 'init', grid: fixtureGrid, eph: fixtureEphemeris })
    handle({ type: 'score', requestId: 1, startMs: T0, endMs: T0 + H_MS, opts: DEFAULT_VISIBILITY_OPTS })
    const result = sent.find((s) => s.msg.type === 'result')
    if (result?.msg.type !== 'result') throw new Error('no result')
    const { sunPct, earthPct, bothPct } = result.msg.scores
    expect(result.transfer).toEqual([sunPct.buffer, earthPct.buffer, bothPct.buffer])
  })

  it('throttles progress to ~50 events on a grid with many rows, still ending at 1', () => {
    // 1 × 200 column of flat-horizon cells (code 50 = 0°) through the pole.
    const ny = 200
    const tallGrid: Grid = {
      manifest: { ...fixtureGrid.manifest, nx: 1, ny, originKm: [-1, -ny] },
      horizonsU8: new Uint8Array(ny * 360).fill(50),
      surfaceHeightM: new Int16Array(ny),
    }
    const { handle, messages } = setup()
    handle({ type: 'init', grid: tallGrid, eph: fixtureEphemeris })
    handle({ type: 'score', requestId: 2, startMs: T0, endMs: T0 + H_MS, opts: DEFAULT_VISIBILITY_OPTS })
    const fractions = messages().flatMap((m) => (m.type === 'progress' ? [m.fraction] : []))
    expect(fractions.length).toBeGreaterThan(10)
    expect(fractions.length).toBeLessThanOrEqual(51)
    expect(fractions.at(-1)).toBe(1)
    fractions.forEach((f, i) => i > 0 && expect(f).toBeGreaterThan(fractions[i - 1]))
  })

  it('answers a score request before init with an error for that request', () => {
    const { handle, messages } = setup()
    handle({ type: 'score', requestId: 3, startMs: T0, endMs: T0 + H_MS, opts: DEFAULT_VISIBILITY_OPTS })
    expect(messages()).toEqual([{ type: 'error', requestId: 3, message: expect.stringMatching(/init/) }])
  })

  it('turns an engine RangeError into an error message for that request', () => {
    const { handle, messages } = setup()
    handle({ type: 'init', grid: fixtureGrid, eph: fixtureEphemeris })
    handle({ type: 'score', requestId: 4, startMs: T0 + H_MS, endMs: T0, opts: DEFAULT_VISIBILITY_OPTS })
    expect(messages().at(-1)).toEqual({ type: 'error', requestId: 4, message: expect.stringMatching(/range/) })
  })

  it('rejects an unknown message type without a request id', () => {
    const { handle, messages } = setup()
    handle({ type: 'nope' } as never)
    expect(messages()).toEqual([{ type: 'error', requestId: null, message: expect.stringMatching(/nope/) }])
  })
})
