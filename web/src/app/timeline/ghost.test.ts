import { describe, expect, it } from 'vitest'
import type { DetectedWindows } from '../../engine'
import { shiftWindows } from './ghost'

const H_MS = 3_600_000
const windows: DetectedWindows = {
  sun: [{ startMs: 10 * H_MS, endMs: 20 * H_MS, clippedStart: true, clippedEnd: false }],
  earth: [{ startMs: 0, endMs: 5 * H_MS, clippedStart: false, clippedEnd: true }],
  both: [],
}

describe('shiftWindows', () => {
  it('moves every window edge by the offset and keeps the clip flags', () => {
    const shifted = shiftWindows(windows, 3 * H_MS)
    expect(shifted.sun).toEqual([{ startMs: 13 * H_MS, endMs: 23 * H_MS, clippedStart: true, clippedEnd: false }])
    expect(shifted.earth).toEqual([{ startMs: 3 * H_MS, endMs: 8 * H_MS, clippedStart: false, clippedEnd: true }])
    expect(shifted.both).toEqual([])
  })

  it('shifts backwards for a negative offset and leaves the input untouched', () => {
    const shifted = shiftWindows(windows, -2 * H_MS)
    expect(shifted.sun[0].startMs).toBe(8 * H_MS)
    expect(windows.sun[0].startMs).toBe(10 * H_MS)
  })
})
