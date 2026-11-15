import { describe, expect, it } from 'vitest'
import { timeScale } from './scales'

const H_MS = 3_600_000
const T0 = Date.UTC(2026, 2, 1)

describe('timeScale', () => {
  const s = timeScale({ startMs: T0, endMs: T0 + 24 * H_MS }, { x0: 10, x1: 490 })

  it('maps the mission range onto the pixel range linearly', () => {
    expect(s.x(T0)).toBe(10)
    expect(s.x(T0 + 24 * H_MS)).toBe(490)
    expect(s.x(T0 + 6 * H_MS)).toBe(130)
  })

  it('does not clamp x(), so callers can clip windows that overhang the range', () => {
    expect(s.x(T0 - 12 * H_MS)).toBe(-230)
  })

  it('inverts x() and clamps the inverse to the range (cursor dragging)', () => {
    expect(s.t(130)).toBe(T0 + 6 * H_MS)
    expect(s.t(-50)).toBe(T0)
    expect(s.t(9999)).toBe(T0 + 24 * H_MS)
  })

  it('rejects an empty or reversed range', () => {
    expect(() => timeScale({ startMs: T0, endMs: T0 }, { x0: 0, x1: 100 })).toThrow(RangeError)
    expect(() => timeScale({ startMs: T0, endMs: T0 + H_MS }, { x0: 100, x1: 100 })).toThrow(RangeError)
  })
})
