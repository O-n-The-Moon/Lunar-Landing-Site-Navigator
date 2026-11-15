// Time series and events: sampling, window detection, next events.
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, visibleDiskFraction } from './geometry'
import type { DetectedWindows, NextEvents, SiteContext, SiteSamples, VisibilityOpts } from './types'
import { notImplemented } from './types'

const MIN_MS = 60_000

/**
 * Sun/Earth az/el, horizon and Sun visible fraction every `stepMin` minutes over the closed range [startMs, endMs].
 * Samples sit at startMs + i·step; endMs is added as the last sample when it is not on the step.
 * Throws RangeError for an inverted range, a step that isn't positive, or times outside the ephemeris coverage.
 */
export function sampleSite(ctx: SiteContext, startMs: number, endMs: number, stepMin = 10): SiteSamples {
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs)) {
    throw new RangeError(`invalid sample range [${startMs}, ${endMs}]`)
  }
  if (!(Number.isFinite(stepMin) && stepMin > 0)) throw new RangeError(`stepMin must be positive, got ${stepMin}`)
  const stepMs = stepMin * MIN_MS
  const whole = Math.floor((endMs - startMs) / stepMs)
  const n = whole + 1 + (startMs + whole * stepMs < endMs ? 1 : 0)
  const s: SiteSamples = {
    ctx,
    stepMin,
    tUtcMs: new Float64Array(n),
    sunAzDeg: new Float64Array(n),
    sunElevDeg: new Float64Array(n),
    sunHorizonDeg: new Float64Array(n),
    sunFraction: new Float64Array(n),
    earthAzDeg: new Float64Array(n),
    earthElevDeg: new Float64Array(n),
    earthHorizonDeg: new Float64Array(n),
  }
  const { eph, frame, horizonMaskDeg, azStepDeg } = ctx
  for (let i = 0; i < n; i++) {
    const t = i > whole ? endMs : startMs + i * stepMs
    const sun = azEl(frame, bodyVectorKm(eph, 'sun', t))
    const earth = azEl(frame, bodyVectorKm(eph, 'earth', t))
    const sunH = horizonElevAt(horizonMaskDeg, azStepDeg, sun.azDeg)
    s.tUtcMs[i] = t
    s.sunAzDeg[i] = sun.azDeg
    s.sunElevDeg[i] = sun.elevDeg
    s.sunHorizonDeg[i] = sunH
    s.sunFraction[i] = visibleDiskFraction(sun.elevDeg, sunH, angularRadiusDeg('sun', sun.distKm))
    s.earthAzDeg[i] = earth.azDeg
    s.earthElevDeg[i] = earth.elevDeg
    s.earthHorizonDeg[i] = horizonElevAt(horizonMaskDeg, azStepDeg, earth.azDeg)
  }
  return s
}

/** Sunlit / Earth-link / both windows with hysteresis; events refined to 1 min. */
export function detectWindows(samples: SiteSamples, opts: VisibilityOpts): DetectedWindows {
  return notImplemented('detectWindows', samples, opts)
}

/** Hours from `tUtcMs` to the next sunset, sunrise, Earthset and Earthrise (null if none in range). */
export function nextEvents(windows: DetectedWindows, tUtcMs: number): NextEvents {
  return notImplemented('nextEvents', windows, tUtcMs)
}
