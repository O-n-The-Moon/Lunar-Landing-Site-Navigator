import { describe, expect, it } from 'vitest'
import ephemerisBin from '../../public/data/ephemeris.bin?inline'
import ephemerisJson from '../../public/data/ephemeris.json'
import sitesJson from '../../public/data/sites.json'
import golden from '../../../shared/fixtures/golden.json'
import { angularRadiusDeg, siteContext, siteFrame, visibleDiskFraction } from './geometry'
import { loadEphemeris, parseSites } from './loaders'
import { diffMetrics, missionMetrics } from './metrics'
import { DEFAULT_VISIBILITY_OPTS } from './types'
import type { EphemerisManifest, MissionMetrics, SiteContext, Vec3, VisibilityOpts } from './types'

const MIN_MS = 60_000
const H_MS = 3_600_000
const T0 = Date.UTC(2026, 0, 1)
/** Events are refined to 1 min; allow one more for the slightly nonlinear angle between hourly ephemeris points. */
const EVENT_TOL_H = 2 / 60

/**
 * Site on the equator at (0°, 0°) over a flat 0° horizon, so ENU is east = +y, north = +z, up = +x.
 * Hourly ephemeris from T0: the Sun due north at sunElevDeg[k], Earth due east at earthElevDeg[k].
 */
function syntheticCtx(sunElevDeg: number[], earthElevDeg: number[]): SiteContext {
  const frame = siteFrame(0, 0, 0, 0)
  const at = (distKm: number, elevDeg: number, dir: Vec3): number[] => {
    const e = (elevDeg * Math.PI) / 180
    return [0, 1, 2].map((k) => frame.positionKm[k] + distKm * (Math.cos(e) * dir[k] + Math.sin(e) * frame.up[k]))
  }
  const positions: number[] = []
  for (let k = 0; k < sunElevDeg.length; k++) {
    positions.push(...at(149_600_000, sunElevDeg[k], frame.north), ...at(384_400, earthElevDeg[k], frame.east))
  }
  return {
    eph: { startUtcMs: T0, stepMs: H_MS, count: sunElevDeg.length, bodies: ['sun', 'earth'], positionsKm: Float32Array.from(positions) },
    frame,
    horizonMaskDeg: new Array<number>(360).fill(0),
    azStepDeg: 1,
    observerHeightM: 0,
  }
}

describe('missionMetrics', () => {
  // Hours 0–12. Sun: sets at ~4.5 h, rises at ~6.5 h (elevation crosses 0° mid-hour).
  // Earth link (margin 1°, ±0.1°): clearance 4° → −1° over hour 7–8, off at −0.1° → 7.82 h;
  // −1° → 4° over hour 9–10, on at +0.1° → 9.22 h.
  const ctx = syntheticCtx([5, 5, 5, 5, 5, -5, -5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 5, 5, 5])
  const opts = DEFAULT_VISIBILITY_OPTS

  it('echoes the landing time and duration', () => {
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 8, opts)
    expect(m.landingMs).toBe(T0 + 2 * H_MS)
    expect(m.durationH).toBe(8)
  })

  it('reports % of the mission in each state', () => {
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 8, opts)
    expect(Math.abs(m.sunlitPct - 75)).toBeLessThan((100 * EVENT_TOL_H) / 8)
    expect(Math.abs(m.earthPct - (100 * 6.6) / 8)).toBeLessThan((100 * EVENT_TOL_H) / 8)
    expect(Math.abs(m.bothPct - (100 * 4.6) / 8)).toBeLessThan((100 * 2 * EVENT_TOL_H) / 8)
  })

  it('reports first on→off transitions as hours from landing', () => {
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 8, opts)
    expect(Math.abs((m.firstSunsetH ?? NaN) - 2.5)).toBeLessThan(EVENT_TOL_H)
    expect(Math.abs((m.firstEarthsetH ?? NaN) - 5.82)).toBeLessThan(EVENT_TOL_H)
  })

  it('reports the longest off-period', () => {
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 8, opts)
    expect(Math.abs(m.longestSunGapH - 2)).toBeLessThan(2 * EVENT_TOL_H)
    expect(Math.abs(m.longestEarthGapH - 1.4)).toBeLessThan(2 * EVENT_TOL_H)
  })

  it('reports the time-weighted mean visible fraction', () => {
    // SPEC-engine → Testing: fraction ≤ 1e-3.
    expect(Math.abs(missionMetrics(ctx, T0 + 2 * H_MS, 8, opts).meanSunFraction - 0.75)).toBeLessThanOrEqual(1e-3)
  })

  it('weights a short last interval by its actual length', () => {
    // 2 h 5 min, Sun fully up throughout: the last sample interval is 5 min, not 10.
    expect(missionMetrics(ctx, T0 + 2 * H_MS, 2 + 5 / 60, opts).meanSunFraction).toBeCloseTo(1, 12)
  })

  it('handles a landing off the 10-min grid of the ephemeris start', () => {
    // 25 min after the coverage start: the lead-in must stop at whole steps inside the coverage.
    const m = missionMetrics(ctx, T0 + 25 * MIN_MS, 5, opts)
    expect(Math.abs((m.firstSunsetH ?? NaN) - (4.5 - 25 / 60))).toBeLessThan(EVENT_TOL_H)
  })

  it('clips a gap at landing and ignores a sunset before landing', () => {
    // Landing at 5 h, Sun already down until ~6.5 h, then up to the end at 9 h.
    const m = missionMetrics(ctx, T0 + 5 * H_MS, 4, opts)
    expect(m.firstSunsetH).toBeNull()
    expect(Math.abs(m.longestSunGapH - 1.5)).toBeLessThan(EVENT_TOL_H)
    expect(Math.abs(m.sunlitPct - (100 * 2.5) / 4)).toBeLessThan((100 * EVENT_TOL_H) / 4)
  })

  it('clips a gap at the mission end', () => {
    // Mission 2–8.5 h: the Earth gap starts at ~7.82 h and is cut at 8.5 h.
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 6.5, opts)
    expect(Math.abs(m.longestEarthGapH - 0.68)).toBeLessThan(EVENT_TOL_H)
    expect(Math.abs((m.firstEarthsetH ?? NaN) - 5.82)).toBeLessThan(EVENT_TOL_H)
  })

  it('reports no event and no gap when nothing sets during the mission', () => {
    const m = missionMetrics(ctx, T0 + 2 * H_MS, 2, opts)
    expect(m.firstSunsetH).toBeNull()
    expect(m.firstEarthsetH).toBeNull()
    expect(m.longestSunGapH).toBe(0)
    expect(m.longestEarthGapH).toBe(0)
    expect(m.sunlitPct).toBe(100)
    expect(m.earthPct).toBe(100)
    expect(m.bothPct).toBe(100)
    expect(m.meanSunFraction).toBeCloseTo(1, 12)
  })

  it('takes the state at landing from before landing, not from the hysteresis seed', () => {
    // Sun high until 2 h, then held just below center: inside the hysteresis band and below its midpoint.
    // Landing 40 h after the Sun enters the band, so the lead-in must be > 40 h (real polar data has in-band runs of
    // ~35 h; the lead-in is 48 h).
    const lowDeg = -0.01
    const f = visibleDiskFraction(lowDeg, 0, angularRadiusDeg('sun', 149_600_000))
    expect(f).toBeGreaterThan(0.45)
    expect(f).toBeLessThan(0.5)
    const held = syntheticCtx([5, 5, 5, ...new Array<number>(45).fill(lowDeg)], new Array<number>(48).fill(5))
    const m = missionMetrics(held, T0 + 43 * H_MS, 4, opts)
    expect(m.sunlitPct).toBe(100)
    expect(m.firstSunsetH).toBeNull()
  })

  describe('with a sunset refined to exactly 4 h', () => {
    // Hour 4 sits 1e-4° below the off level, so the crossing falls in the last bisection step and refines to 4 h.
    const radiusDeg = angularRadiusDeg('sun', 149_600_000)
    let lo = -radiusDeg
    let hi = 0
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      if (visibleDiskFraction(mid, 0, radiusDeg) < 0.45) lo = mid
      else hi = mid
    }
    const sunset = syntheticCtx([5, 5, 5, 5, hi - 1e-4, -5, -5, -5, -5], new Array<number>(9).fill(5))

    it('does not count a sunset exactly at the mission end', () => {
      const m = missionMetrics(sunset, T0 + 2 * H_MS, 2, opts)
      expect(m.firstSunsetH).toBeNull()
      expect(m.sunlitPct).toBe(100)
    })

    it('counts it when the mission runs past it', () => {
      expect(missionMetrics(sunset, T0 + 2 * H_MS, 2 + 10 / 60, opts).firstSunsetH).toBe(2)
    })

    it('does not count a sunset exactly at landing', () => {
      const m = missionMetrics(sunset, T0 + 4 * H_MS, 2, opts)
      expect(m.firstSunsetH).toBeNull()
      expect(m.sunlitPct).toBe(0)
      expect(m.longestSunGapH).toBe(2)
    })
  })

  it('works when landing is at the start of the ephemeris coverage', () => {
    const m = missionMetrics(ctx, T0, 12, opts)
    expect(Math.abs(m.longestSunGapH - 2)).toBeLessThan(2 * EVENT_TOL_H)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for durationH = %s', (durationH) => {
    expect(() => missionMetrics(ctx, T0 + 2 * H_MS, durationH, opts)).toThrow(RangeError)
  })

  it('throws RangeError for a duration too small to move the end time', () => {
    expect(T0 + 2 * H_MS + 1e-12 * H_MS).toBe(T0 + 2 * H_MS)
    expect(() => missionMetrics(ctx, T0 + 2 * H_MS, 1e-12, opts)).toThrow(RangeError)
  })

  it('throws RangeError when the mission runs past the ephemeris coverage', () => {
    expect(() => missionMetrics(ctx, T0 + 10 * H_MS, 3, opts)).toThrow(RangeError)
  })

  it('throws RangeError when landing is before the ephemeris coverage', () => {
    expect(() => missionMetrics(ctx, T0 - H_MS, 2, opts)).toThrow(RangeError)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError naming landingMs for landingMs = %s', (landingMs) => {
    expect(() => missionMetrics(ctx, landingMs, 2, opts)).toThrow(/landingMs/)
  })
})

function metrics(overrides: Partial<MissionMetrics> = {}): MissionMetrics {
  return {
    landingMs: T0,
    durationH: 336,
    sunlitPct: 80,
    earthPct: 60,
    bothPct: 50,
    longestSunGapH: 40,
    longestEarthGapH: 100,
    firstSunsetH: 200,
    firstEarthsetH: 150,
    meanSunFraction: 0.75,
    ...overrides,
  }
}

describe('diffMetrics', () => {
  it('returns slipped − baseline for every numeric metric', () => {
    const a = metrics()
    const b = metrics({ sunlitPct: 70, earthPct: 65, bothPct: 40, longestSunGapH: 55, longestEarthGapH: 90, meanSunFraction: 0.6 })
    const d = diffMetrics(a, b)
    expect(d.sunlitPct).toBeCloseTo(-10, 12)
    expect(d.earthPct).toBeCloseTo(5, 12)
    expect(d.bothPct).toBeCloseTo(-10, 12)
    expect(d.longestSunGapH).toBeCloseTo(15, 12)
    expect(d.longestEarthGapH).toBeCloseTo(-10, 12)
    expect(d.meanSunFraction).toBeCloseTo(-0.15, 12)
  })

  it('marks a first event that moves as shifted, with deltaH = b − a', () => {
    const d = diffMetrics(metrics({ firstSunsetH: 200 }), metrics({ firstSunsetH: 176.5 }))
    expect(d.firstSunsetH).toEqual({ deltaH: -23.5, change: 'shifted' })
  })

  it('marks an equal first event as none with deltaH 0', () => {
    expect(diffMetrics(metrics(), metrics()).firstEarthsetH).toEqual({ deltaH: 0, change: 'none' })
  })

  it('marks an event that only the slipped mission has as appeared', () => {
    const d = diffMetrics(metrics({ firstSunsetH: null }), metrics({ firstSunsetH: 12 }))
    expect(d.firstSunsetH).toEqual({ deltaH: null, change: 'appeared' })
  })

  it('marks an event that only the baseline has as disappeared', () => {
    const d = diffMetrics(metrics({ firstEarthsetH: 12 }), metrics({ firstEarthsetH: null }))
    expect(d.firstEarthsetH).toEqual({ deltaH: null, change: 'disappeared' })
  })

  it('marks an event that neither mission has as none', () => {
    const d = diffMetrics(metrics({ firstSunsetH: null }), metrics({ firstSunsetH: null }))
    expect(d.firstSunsetH).toEqual({ deltaH: null, change: 'none' })
  })
})

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

describe('missionMetrics golden parity (shared/fixtures/golden.json scenarios)', () => {
  const eph = loadEphemeris(ephemerisJson as EphemerisManifest, dataUrlToArrayBuffer(ephemerisBin))
  const sitesFile = parseSites(sitesJson)
  const { observerHeightM, ...visibility } = golden.opts
  const opts: VisibilityOpts = visibility
  /** SPEC-engine → Testing: scenario totals ≤ 10 min. */
  const TOTAL_TOL_H = 10 / 60

  it.each(golden.scenarios.map((sc) => [sc.id, sc] as const))('%s', (_, sc) => {
    const site = sitesFile.sites.find((s) => s.id === sc.siteId)
    if (!site) throw new Error(`site ${sc.siteId} not in sites.json`)
    expect(sc.observerHeightM).toBe(observerHeightM)
    const m = missionMetrics(siteContext(eph, site, sitesFile.azStepDeg, observerHeightM), sc.landingUtcMs, sc.durationH, opts)
    const t = sc.totals
    const pctTol = (100 * TOTAL_TOL_H) / sc.durationH
    expect(Math.abs(m.sunlitPct - t.sunlitPct)).toBeLessThanOrEqual(pctTol)
    expect(Math.abs(m.earthPct - t.earthPct)).toBeLessThanOrEqual(pctTol)
    expect(Math.abs(m.bothPct - t.bothPct)).toBeLessThanOrEqual(pctTol)
    expect(Math.abs(m.longestSunGapH - t.longestSunGapH)).toBeLessThanOrEqual(TOTAL_TOL_H)
    expect(Math.abs(m.longestEarthGapH - t.longestEarthGapH)).toBeLessThanOrEqual(TOTAL_TOL_H)
    for (const [ours, ref] of [
      [m.firstSunsetH, t.firstSunsetH],
      [m.firstEarthsetH, t.firstEarthsetH],
    ] as const) {
      // golden.json notes: events agree to about 1 min each.
      if (ref === null) expect(ours).toBeNull()
      else expect(Math.abs((ours ?? NaN) - ref)).toBeLessThanOrEqual(EVENT_TOL_H)
    }
    // SPEC-engine → Testing: fraction ≤ 1e-3.
    expect(Math.abs(m.meanSunFraction - t.meanSunFraction)).toBeLessThanOrEqual(1e-3)
  })

  it('takes ≤ 5 ms per site for a 30-day mission (SPEC-engine → Performance)', () => {
    const sc = golden.scenarios[0]
    const site = sitesFile.sites.find((s) => s.id === sc.siteId)
    if (!site) throw new Error(`site ${sc.siteId} not in sites.json`)
    const ctx = siteContext(eph, site, sitesFile.azStepDeg, observerHeightM)
    for (let i = 0; i < 5; i++) missionMetrics(ctx, sc.landingUtcMs, 30 * 24, opts)
    const runsMs: number[] = []
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now()
      missionMetrics(ctx, sc.landingUtcMs, 30 * 24, opts)
      runsMs.push(performance.now() - t0)
    }
    runsMs.sort((a, b) => a - b)
    expect(runsMs[10]).toBeLessThanOrEqual(5)
  })
})
