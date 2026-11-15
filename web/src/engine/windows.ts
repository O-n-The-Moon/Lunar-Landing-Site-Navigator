// Time series and events: sampling, window detection, next events.
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, visibleDiskFraction } from './geometry'
import type { AzEl, DetectedWindows, NextEvents, SiteContext, SiteSamples, VisibilityOpts, Window } from './types'

const MIN_MS = 60_000
const H_MS = 3_600_000

function sunAt(ctx: SiteContext, tUtcMs: number): AzEl & { horizonDeg: number; fraction: number } {
  const sun = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'sun', tUtcMs))
  const horizonDeg = horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, sun.azDeg)
  const fraction = visibleDiskFraction(sun.elevDeg, horizonDeg, angularRadiusDeg('sun', sun.distKm))
  return { ...sun, horizonDeg, fraction }
}

function earthAt(ctx: SiteContext, tUtcMs: number): AzEl & { horizonDeg: number } {
  const earth = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'earth', tUtcMs))
  return { ...earth, horizonDeg: horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, earth.azDeg) }
}

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
  for (let i = 0; i < n; i++) {
    const t = i > whole ? endMs : startMs + i * stepMs
    const sun = sunAt(ctx, t)
    const earth = earthAt(ctx, t)
    s.tUtcMs[i] = t
    s.sunAzDeg[i] = sun.azDeg
    s.sunElevDeg[i] = sun.elevDeg
    s.sunHorizonDeg[i] = sun.horizonDeg
    s.sunFraction[i] = sun.fraction
    s.earthAzDeg[i] = earth.azDeg
    s.earthElevDeg[i] = earth.elevDeg
    s.earthHorizonDeg[i] = earth.horizonDeg
  }
  return s
}

/** Bisects (loMs, hiMs], where `reached` is false at lo and true at hi, down to ≤ 1 min; returns the side where it is true. */
function refine(valueAt: (tUtcMs: number) => number, reached: (v: number) => boolean, loMs: number, hiMs: number): number {
  while (hiMs - loMs > MIN_MS) {
    const mid = Math.floor((loMs + hiMs) / 2)
    if (reached(valueAt(mid))) hiMs = mid
    else loMs = mid
  }
  return hiMs
}

/**
 * Hysteresis on a sampled series: turns on at v ≥ onAt, off at v ≤ offAt; the first sample is on if
 * v[0] ≥ the band midpoint. Each transition is refined between its two samples with `valueAt`.
 */
function windowsFromSeries(
  t: Float64Array,
  v: ArrayLike<number>,
  onAt: number,
  offAt: number,
  valueAt: (tUtcMs: number) => number,
): Window[] {
  const wins: Window[] = []
  let on = v[0] >= (onAt + offAt) / 2
  let startMs = t[0]
  let clippedStart = true
  for (let i = 1; i < t.length; i++) {
    if (!on && v[i] >= onAt) {
      on = true
      startMs = refine(valueAt, (x) => x >= onAt, t[i - 1], t[i])
      clippedStart = false
    } else if (on && v[i] <= offAt) {
      on = false
      const endMs = refine(valueAt, (x) => x <= offAt, t[i - 1], t[i])
      wins.push({ startMs, endMs, clippedStart, clippedEnd: false })
    }
  }
  if (on) wins.push({ startMs, endMs: t[t.length - 1], clippedStart, clippedEnd: true })
  return wins
}

/** Overlaps of two sorted, non-overlapping window lists. An edge is clipped if it comes from a clipped edge. */
function intersect(a: Window[], b: Window[]): Window[] {
  const out: Window[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a[i]
    const y = b[j]
    const startMs = Math.max(x.startMs, y.startMs)
    const endMs = Math.min(x.endMs, y.endMs)
    if (endMs > startMs) {
      out.push({
        startMs,
        endMs,
        clippedStart: (startMs === x.startMs && x.clippedStart) || (startMs === y.startMs && y.clippedStart),
        clippedEnd: (endMs === x.endMs && x.clippedEnd) || (endMs === y.endMs && y.clippedEnd),
      })
    }
    if (x.endMs < y.endMs) i++
    else j++
  }
  return out
}

/**
 * Sunlit / Earth-link / both windows with hysteresis (SPEC-engine → Definitions), events bisected to 1 min
 * using `samples.ctx`. Sunlit: on at fraction ≥ threshold + hysteresis, off at ≤ threshold − hysteresis.
 * Earth link: clearance = elev − horizon − earthMarginDeg; on at ≥ +earthHysteresisDeg, off at ≤ −earthHysteresisDeg.
 * A refined event time is the first time (to 1 min) at which the new state holds.
 */
export function detectWindows(samples: SiteSamples, opts: VisibilityOpts): DetectedWindows {
  const { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg } = opts
  if (!(hysteresis >= 0 && earthHysteresisDeg >= 0)) {
    throw new RangeError(`hysteresis must be ≥ 0, got ${hysteresis} / ${earthHysteresisDeg}°`)
  }
  const { ctx, tUtcMs } = samples
  const earthClearanceDeg = samples.earthElevDeg.map((e, i) => e - samples.earthHorizonDeg[i] - earthMarginDeg)
  const sun = windowsFromSeries(tUtcMs, samples.sunFraction, sunThreshold + hysteresis, sunThreshold - hysteresis, (t) =>
    sunAt(ctx, t).fraction,
  )
  const earth = windowsFromSeries(tUtcMs, earthClearanceDeg, earthHysteresisDeg, -earthHysteresisDeg, (t) => {
    const e = earthAt(ctx, t)
    return e.elevDeg - e.horizonDeg - earthMarginDeg
  })
  return { sun, earth, both: intersect(sun, earth) }
}

/**
 * Hours from `tUtcMs` to the next sunset, sunrise, Earthset and Earthrise strictly after it (null if none in range).
 * Clipped window edges are range limits, not events.
 */
export function nextEvents(windows: DetectedWindows, tUtcMs: number): NextEvents {
  if (!Number.isFinite(tUtcMs)) throw new RangeError(`tUtcMs must be finite, got ${tUtcMs}`)
  const inH = (ms: number | undefined) => (ms === undefined ? null : (ms - tUtcMs) / H_MS)
  const nextEnd = (ws: Window[]) => ws.find((w) => !w.clippedEnd && w.endMs > tUtcMs)?.endMs
  const nextStart = (ws: Window[]) => ws.find((w) => !w.clippedStart && w.startMs > tUtcMs)?.startMs
  return {
    sunsetInH: inH(nextEnd(windows.sun)),
    sunriseInH: inH(nextStart(windows.sun)),
    earthsetInH: inH(nextEnd(windows.earth)),
    earthriseInH: inH(nextStart(windows.earth)),
  }
}
