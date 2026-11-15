import { describe, expect, it } from 'vitest'
import { fixtureOutputs } from '../../engine/__fixtures__'
import { DAY_MS, isIn, missionTracks } from './tracks'

const { samples, windows } = fixtureOutputs['fixture-plateau']
const t = samples.tUtcMs
const n = t.length

describe('missionTracks', () => {
  it('keeps only samples inside the mission, with the engine positions unchanged', () => {
    const range = { startMs: t[6], endMs: t[n - 7] }
    const tracks = missionTracks(samples, windows, range)
    expect(tracks.sun).toHaveLength(n - 12)
    expect(tracks.earth).toHaveLength(n - 12)
    expect(tracks.sun[0]).toMatchObject({
      tUtcMs: t[6],
      azDeg: samples.sunAzDeg[6],
      elevDeg: samples.sunElevDeg[6],
      horizonDeg: samples.sunHorizonDeg[6],
    })
    expect(tracks.earth.at(-1)).toMatchObject({
      tUtcMs: t[n - 7],
      azDeg: samples.earthAzDeg[n - 7],
      elevDeg: samples.earthElevDeg[n - 7],
      horizonDeg: samples.earthHorizonDeg[n - 7],
    })
  })

  it('marks each point lit / in view by the timeline rule, so the track and the timeline agree', () => {
    const tracks = missionTracks(samples, windows, { startMs: t[0], endMs: t[n - 1] })
    expect(tracks.sun.map((p) => p.visible)).toEqual([...t].map((x) => isIn(windows.sun, x)))
    expect(tracks.earth.map((p) => p.visible)).toEqual([...t].map((x) => isIn(windows.earth, x)))
    // The fixture has both states for the Sun, so the coloring is exercised.
    expect(new Set(tracks.sun.map((p) => p.visible)).size).toBe(2)
  })

  it('puts a day tick on the Sun track at landing and every 24 h after it', () => {
    const range = { startMs: t[0], endMs: t[n - 1] }
    const { sun, dayTicks } = missionTracks(samples, windows, range)
    const days = Math.floor((range.endMs - range.startMs) / DAY_MS)
    expect(dayTicks.map((d) => d.day)).toEqual(Array.from({ length: days + 1 }, (_, k) => k))
    for (const d of dayTicks) {
      const p = sun.find((x) => x.tUtcMs === range.startMs + d.day * DAY_MS)
      expect(p).toBeTruthy()
      expect(d).toEqual({ day: d.day, tUtcMs: p?.tUtcMs, azDeg: p?.azDeg, elevDeg: p?.elevDeg })
    }
  })

  it('isIn: half-open windows, except a window clipped at the range end includes that end', () => {
    const w = { startMs: 10, endMs: 20, clippedStart: false, clippedEnd: false }
    expect([9, 10, 19, 20].map((x) => isIn([w], x))).toEqual([false, true, true, false])
    expect(isIn([{ ...w, clippedEnd: true }], 20)).toBe(true)
  })

  it('puts a day tick that falls between samples on the next sample', () => {
    const range = { startMs: t[0] + 5 * 60_000, endMs: t[n - 1] } // landing 5 min after a sample (10-min steps)
    const { dayTicks } = missionTracks(samples, windows, range)
    expect(dayTicks[0].tUtcMs).toBe(t[1])
    expect(dayTicks[1].tUtcMs).toBe(range.startMs + DAY_MS + 5 * 60_000)
  })
})

