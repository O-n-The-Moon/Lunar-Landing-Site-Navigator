import { describe, expect, it } from 'vitest'
import golden from '../../../shared/fixtures/golden.json'
import { realSiteContext, realSitesFile } from './__fixtures__/real-data'
import { detectWindows, sampleSite } from './windows'
import type { SiteContext, VisibilityOpts } from './types'

/** SPEC.md → Success Criteria: az/el ≤ 1e-3°, Sun fraction ≤ 1e-3. */
const ANGLE_TOL_DEG = 1e-3
const FRACTION_TOL = 1e-3

type GoldenCase = (typeof golden.cases)[number]

/** Signed azimuth difference in [−180, 180), so 359.9995° vs 0.0003° counts as −0.0008°. */
function azDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

describe('engine golden parity (shared/fixtures/golden.json cases)', () => {
  const { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg } = golden.opts
  const opts: VisibilityOpts = { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg }
  const ctxCache = new Map<string, SiteContext>()

  function ctxFor(c: GoldenCase): SiteContext {
    const key = `${c.siteId}@${c.observerHeightM}`
    let ctx = ctxCache.get(key)
    if (!ctx) {
      // Cases carry their own height (2 or 10 m); golden.opts.observerHeightM is only the scenario default.
      ctx = realSiteContext(c.siteId, c.observerHeightM)
      ctxCache.set(key, ctx)
    }
    return ctx
  }

  it('covers every site, both heights, partly hidden Sun disks and the 0°/360° horizon bin', () => {
    const cases = golden.cases
    expect(cases.length).toBeGreaterThan(0)
    expect(new Set(cases.map((c) => c.siteId))).toEqual(new Set(realSitesFile.sites.map((s) => s.id)))
    expect(new Set(cases.map((c) => c.observerHeightM))).toEqual(new Set(realSitesFile.heightsM))
    expect(cases.some((c) => c.sunFraction > 0 && c.sunFraction < 1)).toBe(true)
    expect(cases.some((c) => c.earthVisible) && cases.some((c) => !c.earthVisible)).toBe(true)
    // horizonElevAt interpolates between the last bin and bin 0 here.
    const lastBinDeg = 360 - realSitesFile.azStepDeg
    expect(cases.some((c) => c.sunAzDeg >= lastBinDeg || c.earthAzDeg >= lastBinDeg)).toBe(true)
  })

  it.each(golden.cases.map((c) => [`${c.siteId} h=${c.observerHeightM} t=${new Date(c.tUtcMs).toISOString()}`, c] as const))(
    '%s',
    (_, c) => {
      // Sample 0 is at tUtcMs exactly; the 1 ms second sample gives detectWindows a range to report on.
      const samples = sampleSite(ctxFor(c), c.tUtcMs, c.tUtcMs + 1)

      expect(Math.abs(azDiffDeg(samples.sunAzDeg[0], c.sunAzDeg)), 'sunAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunElevDeg[0] - c.sunElevDeg), 'sunElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunHorizonDeg[0] - c.sunHorizonDeg), 'sunHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunFraction[0] - c.sunFraction), 'sunFraction').toBeLessThanOrEqual(FRACTION_TOL)
      expect(Math.abs(azDiffDeg(samples.earthAzDeg[0], c.earthAzDeg)), 'earthAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.earthElevDeg[0] - c.earthElevDeg), 'earthElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.earthHorizonDeg[0] - c.earthHorizonDeg), 'earthHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)

      // With no prior state, the engine starts the link on at clearance ≥ 0 (no hysteresis), which is golden's
      // earthVisible. Sample 0 alone decides: a turn-on at the 1 ms sample would start at t + 1, not clipped at t.
      const { earth } = detectWindows(samples, opts)
      expect(earth[0]?.startMs === c.tUtcMs && earth[0].clippedStart, 'earthVisible').toBe(c.earthVisible)
    },
  )

  it('wraps azimuth differences across 0°/360°', () => {
    expect(azDiffDeg(359.9995, 0.0003)).toBeCloseTo(-0.0008, 12)
    expect(azDiffDeg(0.0003, 359.9995)).toBeCloseTo(0.0008, 12)
    expect(azDiffDeg(10, 10)).toBe(0)
  })
})
