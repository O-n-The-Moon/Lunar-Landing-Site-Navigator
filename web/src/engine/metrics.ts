// Mission metrics and slip deltas (SPEC-engine → Definitions).
import type { EventDelta, MetricDelta, MissionMetrics, SiteContext, VisibilityOpts, Window } from './types'
import { detectWindows, sampleSite } from './windows'

const MIN_MS = 60_000
const H_MS = 3_600_000
const STEP_MIN = 10
/** Sampling starts up to this long before landing, so the hysteresis state at landing comes from history, not the seed. */
const PRE_ROLL_H = 24

/** Time on, longest off run and first on→off transition of one state, clipped to the half-open [landingMs, endMs). */
function stateStats(wins: Window[], landingMs: number, endMs: number) {
  let onMs = 0
  let longestGapMs = 0
  let prevEndMs = landingMs
  let firstOffMs: number | null = null
  for (const w of wins) {
    const startMs = Math.max(w.startMs, landingMs)
    const stopMs = Math.min(w.endMs, endMs)
    if (stopMs <= startMs) continue
    onMs += stopMs - startMs
    longestGapMs = Math.max(longestGapMs, startMs - prevEndMs)
    prevEndMs = stopMs
    // A transition exactly at endMs is outside the half-open mission.
    if (firstOffMs === null && !w.clippedEnd && w.endMs < endMs) firstOffMs = w.endMs
  }
  return { onMs, longestGapMs: Math.max(longestGapMs, endMs - prevEndMs), firstOffMs }
}

/**
 * Metrics over the half-open mission [landingMs, landingMs + durationH): % of the mission sunlit / Earth link /
 * both, longest off-periods (including ones cut by the mission ends), hours to the first sunset / Earthset, and
 * the time-weighted mean Sun visible fraction. Samples every 10 min from up to 24 h before landing.
 * Throws RangeError for durationH ≤ 0 or a mission outside the ephemeris coverage (via sampleSite).
 */
export function missionMetrics(ctx: SiteContext, landingMs: number, durationH: number, opts: VisibilityOpts): MissionMetrics {
  const endMs = landingMs + durationH * H_MS
  // Checked on endMs: a tiny positive durationH can round back to landingMs.
  if (!(Number.isFinite(durationH) && endMs > landingMs)) throw new RangeError(`durationH must be positive, got ${durationH}`)
  const stepMs = STEP_MIN * MIN_MS
  const preSteps = Math.max(0, Math.min((PRE_ROLL_H * 60) / STEP_MIN, Math.floor((landingMs - ctx.eph.startUtcMs) / stepMs)))
  const samples = sampleSite(ctx, landingMs - preSteps * stepMs, endMs, STEP_MIN)
  const windows = detectWindows(samples, opts)
  const durationMs = endMs - landingMs
  const pct = (ms: number) => (100 * ms) / durationMs
  const inH = (ms: number | null) => (ms === null ? null : (ms - landingMs) / H_MS)
  const sun = stateStats(windows.sun, landingMs, endMs)
  const earth = stateStats(windows.earth, landingMs, endMs)
  const both = stateStats(windows.both, landingMs, endMs)

  // Trapezoids weighted by the actual spacing: the last interval is shorter when the mission is off-step.
  const { tUtcMs, sunFraction } = samples
  let fractionMs = 0
  for (let i = preSteps + 1; i < tUtcMs.length; i++) {
    fractionMs += ((sunFraction[i - 1] + sunFraction[i]) / 2) * (tUtcMs[i] - tUtcMs[i - 1])
  }

  return {
    landingMs,
    durationH,
    sunlitPct: pct(sun.onMs),
    earthPct: pct(earth.onMs),
    bothPct: pct(both.onMs),
    longestSunGapH: sun.longestGapMs / H_MS,
    longestEarthGapH: earth.longestGapMs / H_MS,
    firstSunsetH: inH(sun.firstOffMs),
    firstEarthsetH: inH(earth.firstOffMs),
    meanSunFraction: fractionMs / durationMs,
  }
}

function eventDelta(a: number | null, b: number | null): EventDelta {
  if (a === null || b === null) {
    return { deltaH: null, change: a === b ? 'none' : a === null ? 'appeared' : 'disappeared' }
  }
  const deltaH = b - a
  return { deltaH, change: deltaH === 0 ? 'none' : 'shifted' }
}

/** `b − a` per metric: a = unslipped baseline, b = slipped. */
export function diffMetrics(a: MissionMetrics, b: MissionMetrics): MetricDelta {
  return {
    sunlitPct: b.sunlitPct - a.sunlitPct,
    earthPct: b.earthPct - a.earthPct,
    bothPct: b.bothPct - a.bothPct,
    longestSunGapH: b.longestSunGapH - a.longestSunGapH,
    longestEarthGapH: b.longestEarthGapH - a.longestEarthGapH,
    firstSunsetH: eventDelta(a.firstSunsetH, b.firstSunsetH),
    firstEarthsetH: eventDelta(a.firstEarthsetH, b.firstEarthsetH),
    meanSunFraction: b.meanSunFraction - a.meanSunFraction,
  }
}
