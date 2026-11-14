// Mission metrics and slip deltas. Implemented by T12.
import type { MetricDelta, MissionMetrics, SiteContext, VisibilityOpts } from './types'
import { notImplemented } from './types'

/** Metrics over [landingMs, landingMs + durationH]. */
export function missionMetrics(ctx: SiteContext, landingMs: number, durationH: number, opts: VisibilityOpts): MissionMetrics {
  return notImplemented('missionMetrics', ctx, landingMs, durationH, opts)
}

/** `b − a` per metric: a = unslipped baseline, b = slipped. */
export function diffMetrics(a: MissionMetrics, b: MissionMetrics): MetricDelta {
  return notImplemented('diffMetrics', a, b)
}
