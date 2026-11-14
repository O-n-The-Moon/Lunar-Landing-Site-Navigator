// Time series and events: sampling, window detection, next events. Implemented by T11.
import type { DetectedWindows, NextEvents, SiteContext, SiteSamples, VisibilityOpts } from './types'
import { notImplemented } from './types'

/** Sun/Earth az/el, horizon and Sun visible fraction every `stepMin` minutes over [startMs, endMs]. */
export function sampleSite(ctx: SiteContext, startMs: number, endMs: number, stepMin = 10): SiteSamples {
  return notImplemented('sampleSite', ctx, startMs, endMs, stepMin)
}

/** Sunlit / Earth-link / both windows with hysteresis; events refined to 1 min. */
export function detectWindows(samples: SiteSamples, opts: VisibilityOpts): DetectedWindows {
  return notImplemented('detectWindows', samples, opts)
}

/** Hours from `tUtcMs` to the next sunset, sunrise, Earthset and Earthrise (null if none in range). */
export function nextEvents(windows: DetectedWindows, tUtcMs: number): NextEvents {
  return notImplemented('nextEvents', windows, tUtcMs)
}
