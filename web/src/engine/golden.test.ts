import { describe, expect, it } from 'vitest'
import ephemerisBin from '../../public/data/ephemeris.bin?inline'
import ephemerisJson from '../../public/data/ephemeris.json'
import sitesJson from '../../public/data/sites.json'
import golden from '../../../shared/fixtures/golden.json'
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, siteContext, visibleDiskFraction } from './geometry'
import { loadEphemeris, parseSites } from './loaders'
import type { AzEl, Body, EphemerisManifest, SiteContext } from './types'

/** SPEC.md → Success Criteria: az/el ≤ 1e-3°, Sun fraction ≤ 1e-3. */
const ANGLE_TOL_DEG = 1e-3
const FRACTION_TOL = 1e-3
/** Extra (not in the spec): both sides read the same float32 ephemeris.bin, so distances agree to rounding. */
const DIST_REL_TOL = 1e-7

type GoldenCase = (typeof golden.cases)[number]

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Signed azimuth difference in (−180, 180], so 359.9995° vs 0.0003° counts as 0.0008°. */
function azDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

describe('engine golden parity (shared/fixtures/golden.json cases)', () => {
  const eph = loadEphemeris(ephemerisJson as EphemerisManifest, dataUrlToArrayBuffer(ephemerisBin))
  const sitesFile = parseSites(sitesJson)
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

  function look(ctx: SiteContext, body: Body, tUtcMs: number): AzEl & { horizonDeg: number } {
    const ae = azEl(ctx.frame, bodyVectorKm(ctx.eph, body, tUtcMs))
    return { ...ae, horizonDeg: horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, ae.azDeg) }
  }

  it('covers every site, both heights, and partly hidden Sun disks', () => {
    const cases = golden.cases
    expect(cases.length).toBeGreaterThan(0)
    expect(new Set(cases.map((c) => c.siteId))).toEqual(new Set(sitesFile.sites.map((s) => s.id)))
    expect(new Set(cases.map((c) => c.observerHeightM))).toEqual(new Set(sitesFile.heightsM))
    expect(cases.some((c) => c.sunFraction > 0 && c.sunFraction < 1)).toBe(true)
    expect(cases.some((c) => c.earthVisible) && cases.some((c) => !c.earthVisible)).toBe(true)
  })

  it.each(golden.cases.map((c) => [`${c.siteId} h=${c.observerHeightM} t=${new Date(c.tUtcMs).toISOString()}`, c] as const))(
    '%s',
    (_, c) => {
      const ctx = ctxFor(c)
      const sun = look(ctx, 'sun', c.tUtcMs)
      const earth = look(ctx, 'earth', c.tUtcMs)

      expect(Math.abs(azDiffDeg(sun.azDeg, c.sunAzDeg)), 'sunAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(sun.elevDeg - c.sunElevDeg), 'sunElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(sun.horizonDeg - c.sunHorizonDeg), 'sunHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(azDiffDeg(earth.azDeg, c.earthAzDeg)), 'earthAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(earth.elevDeg - c.earthElevDeg), 'earthElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(earth.horizonDeg - c.earthHorizonDeg), 'earthHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)

      const sunFraction = visibleDiskFraction(sun.elevDeg, sun.horizonDeg, angularRadiusDeg('sun', sun.distKm))
      expect(Math.abs(sunFraction - c.sunFraction), 'sunFraction').toBeLessThanOrEqual(FRACTION_TOL)
      // Instantaneous test with no hysteresis; the generator drops cases within 1e-4° of the margin.
      expect(earth.elevDeg - earth.horizonDeg >= golden.opts.earthMarginDeg, 'earthVisible').toBe(c.earthVisible)

      expect(Math.abs(sun.distKm / c.sunDistKm - 1), 'sunDistKm (extra)').toBeLessThanOrEqual(DIST_REL_TOL)
      expect(Math.abs(earth.distKm / c.earthDistKm - 1), 'earthDistKm (extra)').toBeLessThanOrEqual(DIST_REL_TOL)
    },
  )

  it('wraps azimuth differences across 0°/360°', () => {
    expect(azDiffDeg(359.9995, 0.0003)).toBeCloseTo(-0.0008, 12)
    expect(azDiffDeg(0.0003, 359.9995)).toBeCloseTo(0.0008, 12)
    expect(azDiffDeg(10, 10)).toBe(0)
  })
})
