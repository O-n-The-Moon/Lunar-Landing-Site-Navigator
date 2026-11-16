import { describe, expect, it } from 'vitest'
import { missionTracks, type MissionTracks } from './tracks'
import { surfaceTrack } from './bodies'

const H = 3_600_000
const tracks: MissionTracks = {
  sun: [0, 12, 24, 36, 48].map((h, i) => ({ tUtcMs: h * H, azDeg: 10 * i, elevDeg: i - 2, horizonDeg: 0, visible: i % 2 === 0 })),
  earth: [0, 12, 24, 36, 48].map((h, i) => ({ tUtcMs: h * H, azDeg: 100 + i, elevDeg: 5, horizonDeg: 1, visible: true })),
  dayTicks: [
    { day: 0, tUtcMs: 0, azDeg: 0, elevDeg: -2 },
    { day: 1, tUtcMs: 24 * H, azDeg: 20, elevDeg: 0 },
    { day: 2, tUtcMs: 48 * H, azDeg: 40, elevDeg: 2 },
  ],
}

describe('surfaceTrack', () => {
  it('keeps the engine samples and the timeline rule (visible → on)', () => {
    const sun = surfaceTrack(tracks, 'sun')
    expect(sun.map((p) => [p.azDeg, p.elevDeg, p.on])).toEqual([
      [0, -2, true],
      [10, -1, false],
      [20, 0, true],
      [30, 1, false],
      [40, 2, true],
    ])
  })

  it('marks day ticks on the sample at 24 h, 48 h …, never at landing, for both bodies', () => {
    expect(surfaceTrack(tracks, 'sun').map((p) => p.dayTick)).toEqual([null, null, 1, null, 2])
    expect(surfaceTrack(tracks, 'earth').map((p) => p.dayTick)).toEqual([null, null, 1, null, 2])
  })

  it('works on real missionTracks output, one point per sample in range', () => {
    const samples = {
      tUtcMs: Float64Array.from([0, H, 2 * H, 3 * H]),
      sunAzDeg: Float64Array.from([1, 2, 3, 4]),
      sunElevDeg: Float64Array.from([0, 0, 0, 0]),
      sunHorizonDeg: Float64Array.from([0, 0, 0, 0]),
      earthAzDeg: Float64Array.from([5, 6, 7, 8]),
      earthElevDeg: Float64Array.from([0, 0, 0, 0]),
      earthHorizonDeg: Float64Array.from([0, 0, 0, 0]),
    }
    const t = missionTracks(samples as never, { sun: [{ startMs: 0, endMs: 2 * H, clippedStart: false, clippedEnd: false }], earth: [] } as never, { startMs: 0, endMs: 2 * H })
    expect(surfaceTrack(t, 'sun')).toHaveLength(3)
    expect(surfaceTrack(t, 'sun').map((p) => p.on)).toEqual([true, true, false])
    expect(surfaceTrack(t, 'earth').every((p) => !p.on)).toBe(true)
  })
})
