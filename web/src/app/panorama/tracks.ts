// Sun and Earth sky tracks over the mission, for the panorama (SPEC-app P0-5).
// Positions are the engine's samples; lit / in view comes from the same windows and rule the timeline draws,
// so a track and the timeline always agree. No physics here.
import type { DetectedWindows, SiteSamples, Window } from '../../engine'

export const DAY_MS = 86_400_000

export interface TrackPoint {
  tUtcMs: number
  azDeg: number
  elevDeg: number
  /** Terrain horizon elevation at this azimuth. */
  horizonDeg: number
  /** Sun lit / Earth in view at this time, by the timeline's rule. */
  visible: boolean
}

/** A point on the Sun track `day` × 24 h after landing (day 0 = landing). */
export interface DayTick {
  day: number
  tUtcMs: number
  azDeg: number
  elevDeg: number
}

export interface MissionTracks {
  sun: TrackPoint[]
  earth: TrackPoint[]
  dayTicks: DayTick[]
}

/** The timeline's rule: half-open [start, end), except a window clipped at the range end includes that end. */
export const isIn = (ws: readonly Window[], t: number) =>
  ws.some((w) => w.startMs <= t && (t < w.endMs || (w.clippedEnd && t === w.endMs)))

/**
 * The samples inside the closed mission range [startMs, endMs], as Sun / Earth tracks, plus day ticks on the Sun
 * track at landing and every 24 h after it (at the first sample at or after each tick time).
 */
export function missionTracks(
  samples: SiteSamples,
  windows: DetectedWindows,
  range: { startMs: number; endMs: number },
): MissionTracks {
  const sun: TrackPoint[] = []
  const earth: TrackPoint[] = []
  for (let i = 0; i < samples.tUtcMs.length; i++) {
    const tUtcMs = samples.tUtcMs[i]
    if (tUtcMs < range.startMs || tUtcMs > range.endMs) continue
    sun.push({
      tUtcMs,
      azDeg: samples.sunAzDeg[i],
      elevDeg: samples.sunElevDeg[i],
      horizonDeg: samples.sunHorizonDeg[i],
      visible: isIn(windows.sun, tUtcMs),
    })
    earth.push({
      tUtcMs,
      azDeg: samples.earthAzDeg[i],
      elevDeg: samples.earthElevDeg[i],
      horizonDeg: samples.earthHorizonDeg[i],
      visible: isIn(windows.earth, tUtcMs),
    })
  }

  const dayTicks: DayTick[] = []
  let j = 0
  for (let day = 0; range.startMs + day * DAY_MS <= range.endMs; day++) {
    const tickMs = range.startMs + day * DAY_MS
    while (j < sun.length && sun[j].tUtcMs < tickMs) j++
    if (j === sun.length) break
    const p = sun[j]
    dayTicks.push({ day, tUtcMs: p.tUtcMs, azDeg: p.azDeg, elevDeg: p.elevDeg })
  }
  return { sun, earth, dayTicks }
}
