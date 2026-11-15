// Mission metrics and slip deltas. Implemented by T12.
import type { EventDelta, MetricDelta, MissionMetrics, SiteContext, VisibilityOpts } from './types'
import { notImplemented } from './types'

/** Metrics over [landingMs, landingMs + durationH]. */
export function missionMetrics(ctx: SiteContext, landingMs: number, durationH: number, opts: VisibilityOpts): MissionMetrics {
  return notImplemented('missionMetrics', ctx, landingMs, durationH, opts)
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
