import { describe, expect, it } from 'vitest'
import ephemerisBin from '../../public/data/ephemeris.bin?inline'
import ephemerisJson from '../../public/data/ephemeris.json'
import sitesJson from '../../public/data/sites.json'
import golden from '../../../shared/fixtures/golden.json'
import { siteContext } from './geometry'
import { loadEphemeris, parseSites } from './loaders'
import { detectWindows, sampleSite } from './windows'
import type { EphemerisManifest, SiteContext, VisibilityOpts } from './types'

/** SPEC.md → Success Criteria: az/el ≤ 1e-3°, Sun fraction ≤ 1e-3. */
const ANGLE_TOL_DEG = 1e-3
const FRACTION_TOL = 1e-3

type GoldenCase = (typeof golden.cases)[number]

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Signed azimuth difference in [−180, 180), so 359.9995° vs 0.0003° counts as −0.0008°. */
function azDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

describe('engine golden parity (shared/fixtures/golden.json cases)', () => {
  const eph = loadEphemeris(ephemerisJson as EphemerisManifest, dataUrlToArrayBuffer(ephemerisBin))
  const sitesFile = parseSites(sitesJson)
  const { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg } = golden.opts
  const opts: VisibilityOpts = { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg }
  const ctxCache = new Map<string, SiteContext>()

  function ctxFor(c: GoldenCase): SiteContext {
    const key = `${c.siteId}@${c.observerHeightM}`
    let ctx = ctxCache.get(key)
    if (!ctx) {
      const site = sitesFile.sites.find((s) => s.id === c.siteId)
      if (!site) throw new Error(`golden site ${c.siteId} is not in sites.json`)
      // Cases carry their own height (2 or 10 m); golden.opts.observerHeightM is only the scenario default.
      ctx = siteContext(eph, site, sitesFile.azStepDeg, c.observerHeightM)
      ctxCache.set(key, ctx)
    }
    return ctx
  }

  it('covers every site, both heights, partly hidden Sun disks and the 0°/360° horizon bin', () => {
    const cases = golden.cases
    expect(cases.length).toBeGreaterThan(0)
    expect(new Set(cases.map((c) => c.siteId))).toEqual(new Set(sitesFile.sites.map((s) => s.id)))
    expect(new Set(cases.map((c) => c.observerHeightM))).toEqual(new Set(sitesFile.heightsM))
    expect(cases.some((c) => c.sunFraction > 0 && c.sunFraction < 1)).toBe(true)
    expect(cases.some((c) => c.earthVisible) && cases.some((c) => !c.earthVisible)).toBe(true)
    // horizonElevAt interpolates between the last bin and bin 0 here.
    const lastBinDeg = 360 - sitesFile.azStepDeg
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
      // earthVisible. The generator drops cases within 1e-4° of the margin, far more than Earth moves in 1 ms.
      const { earth } = detectWindows(samples, opts)
      expect(earth.length > 0 && earth[0].startMs === c.tUtcMs, 'earthVisible').toBe(c.earthVisible)
    },
  )

  it('wraps azimuth differences across 0°/360°', () => {
    expect(azDiffDeg(359.9995, 0.0003)).toBeCloseTo(-0.0008, 12)
    expect(azDiffDeg(0.0003, 359.9995)).toBeCloseTo(0.0008, 12)
    expect(azDiffDeg(10, 10)).toBe(0)
  })
})
