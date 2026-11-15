import { describe, expect, it } from 'vitest'
import { fixtureOutputs, fixtureScenario } from './__fixtures__'
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, siteFrame, visibleDiskFraction } from './geometry'
import { DEFAULT_VISIBILITY_OPTS } from './types'
import type { SiteContext, Vec3, Window } from './types'
import { detectWindows, sampleSite } from './windows'

const MIN_MS = 60_000
const H_MS = 3_600_000
const T0 = Date.UTC(2026, 0, 1)

/**
 * Site on the equator at (0°, 0°) over a flat 0° horizon, so ENU is east = +y, north = +z, up = +x.
 * Hourly ephemeris: the Sun due north at sunElevDeg[k], Earth due east at earthElevDeg[k].
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
  }
}

describe('sampleSite', () => {
  const ctx = syntheticCtx([2, 1, -1, -2], [5, 3, 1, -1])

  it('samples every stepMin over the closed range, 10 min by default', () => {
    const s = sampleSite(ctx, T0, T0 + H_MS)
    expect(s.stepMin).toBe(10)
    expect(Array.from(s.tUtcMs)).toEqual([0, 10, 20, 30, 40, 50, 60].map((m) => T0 + m * MIN_MS))
    expect(s.ctx).toBe(ctx)
  })

  it('ends with endMs when the range is not a whole number of steps', () => {
    const s = sampleSite(ctx, T0, T0 + 25 * MIN_MS, 10)
    expect(Array.from(s.tUtcMs)).toEqual([0, 10, 20, 25].map((m) => T0 + m * MIN_MS))
  })

  it('returns one sample when startMs equals endMs', () => {
    expect(Array.from(sampleSite(ctx, T0 + H_MS, T0 + H_MS).tUtcMs)).toEqual([T0 + H_MS])
  })

  it('fills every series from the geometry functions', () => {
    const s = sampleSite(ctx, T0, T0 + 3 * H_MS, 7)
    for (let i = 0; i < s.tUtcMs.length; i++) {
      const t = s.tUtcMs[i]
      const sun = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'sun', t))
      const earth = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'earth', t))
      const sunH = horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, sun.azDeg)
      expect(s.sunAzDeg[i]).toBe(sun.azDeg)
      expect(s.sunElevDeg[i]).toBe(sun.elevDeg)
      expect(s.sunHorizonDeg[i]).toBe(sunH)
      expect(s.sunFraction[i]).toBe(visibleDiskFraction(sun.elevDeg, sunH, angularRadiusDeg('sun', sun.distKm)))
      expect(s.earthAzDeg[i]).toBe(earth.azDeg)
      expect(s.earthElevDeg[i]).toBe(earth.elevDeg)
      expect(s.earthHorizonDeg[i]).toBe(horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, earth.azDeg))
    }
  })

  it('places the synthetic bodies where they were put (Sun north, Earth east)', () => {
    const s = sampleSite(ctx, T0, T0 + H_MS, 60)
    expect(s.sunAzDeg[0]).toBeCloseTo(0, 4)
    expect(s.sunElevDeg[0]).toBeCloseTo(2, 4)
    expect(s.sunFraction[0]).toBe(1)
    expect(s.earthAzDeg[1]).toBeCloseTo(90, 4)
    expect(s.earthElevDeg[1]).toBeCloseTo(3, 4)
  })

  it('reproduces the fixture samples', () => {
    for (const { ctx: fctx, samples } of Object.values(fixtureOutputs)) {
      const s = sampleSite(fctx, fixtureScenario.startMs, fixtureScenario.endMs, samples.stepMin)
      expect(Array.from(s.tUtcMs)).toEqual(Array.from(samples.tUtcMs))
      for (let i = 0; i < s.tUtcMs.length; i++) {
        expect(s.sunElevDeg[i]).toBeCloseTo(samples.sunElevDeg[i], 4)
        expect(s.sunFraction[i]).toBeCloseTo(samples.sunFraction[i], 4)
        expect(s.earthElevDeg[i]).toBeCloseTo(samples.earthElevDeg[i], 4)
        expect(s.earthHorizonDeg[i]).toBeCloseTo(samples.earthHorizonDeg[i], 4)
      }
    }
  })

  it('rejects a range outside the ephemeris coverage', () => {
    expect(() => sampleSite(ctx, T0 - MIN_MS, T0 + H_MS)).toThrow(RangeError)
    expect(() => sampleSite(ctx, T0, T0 + 3 * H_MS + MIN_MS)).toThrow(RangeError)
  })

  it('rejects an inverted range, a non-positive or NaN step, and NaN times', () => {
    expect(() => sampleSite(ctx, T0 + H_MS, T0)).toThrow(RangeError)
    expect(() => sampleSite(ctx, T0, T0 + H_MS, 0)).toThrow(RangeError)
    expect(() => sampleSite(ctx, T0, T0 + H_MS, -10)).toThrow(RangeError)
    expect(() => sampleSite(ctx, T0, T0 + H_MS, Number.NaN)).toThrow(RangeError)
    expect(() => sampleSite(ctx, Number.NaN, T0 + H_MS)).toThrow(RangeError)
    expect(() => sampleSite(ctx, T0, Number.NaN)).toThrow(RangeError)
  })
})

describe('detectWindows', () => {
  const opts = DEFAULT_VISIBILITY_OPTS
  const sunOnAt = opts.sunThreshold + opts.hysteresis
  const sunOffAt = opts.sunThreshold - opts.hysteresis
  const span = (ctx: SiteContext) => [T0, T0 + (ctx.eph.count - 1) * H_MS] as const

  /** Same count and clipped flags; every start and end within maxDiffMs. */
  function expectSameWindows(actual: Window[], expected: Window[], maxDiffMs: number) {
    expect(actual.map((w) => [w.clippedStart, w.clippedEnd])).toEqual(expected.map((w) => [w.clippedStart, w.clippedEnd]))
    actual.forEach((w, k) => {
      expect(Math.abs(w.startMs - expected[k].startMs)).toBeLessThanOrEqual(maxDiffMs)
      expect(Math.abs(w.endMs - expected[k].endMs)).toBeLessThanOrEqual(maxDiffMs)
    })
  }

  it('does not flicker while the Sun grazes the horizon inside the hysteresis band', () => {
    // ±0.01° around the horizon keeps the fraction near 0.5 ± 0.024: below the 0.5 threshold, above 0.45.
    const ctx = syntheticCtx([1, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01], new Array<number>(8).fill(5))
    const s = sampleSite(ctx, ...span(ctx))
    expect(Math.min(...s.sunFraction)).toBeLessThan(opts.sunThreshold)
    expect(Math.min(...s.sunFraction)).toBeGreaterThan(sunOffAt)

    expect(detectWindows(s, opts).sun).toEqual([{ startMs: T0, endMs: T0 + 7 * H_MS, clippedStart: true, clippedEnd: true }])
    // Without hysteresis the same series toggles at every crossing.
    expect(detectWindows(s, { ...opts, hysteresis: 0 }).sun.length).toBeGreaterThan(1)
  })

  it('does not flicker while Earth grazes the horizon + margin inside its hysteresis band', () => {
    // margin 1°, hysteresis 0.1°: 1.05° / 0.95° stay inside (0.9°, 1.1°).
    const ctx = syntheticCtx(new Array<number>(8).fill(5), [3, 1.05, 0.95, 1.05, 0.95, 1.05, 0.95, 1.05])
    const s = sampleSite(ctx, ...span(ctx))

    expect(detectWindows(s, opts).earth).toEqual([{ startMs: T0, endMs: T0 + 7 * H_MS, clippedStart: true, clippedEnd: true }])
    expect(detectWindows(s, { ...opts, earthHysteresisDeg: 0 }).earth.length).toBeGreaterThan(1)
  })

  it('refines events to within 1 min of brute-force 1-min sampling (synthetic set and rise)', () => {
    const ctx = syntheticCtx([2, 1, -1, -2, -1, 1, 2], [5, 3, 1, -1, 1, 3, 5])
    const refined = detectWindows(sampleSite(ctx, ...span(ctx), 10), opts)
    const brute = detectWindows(sampleSite(ctx, ...span(ctx), 1), opts)
    expect(refined.sun).toHaveLength(2)
    expect(refined.earth).toHaveLength(2)
    expectSameWindows(refined.sun, brute.sun, MIN_MS)
    expectSameWindows(refined.earth, brute.earth, MIN_MS)
    expectSameWindows(refined.both, brute.both, MIN_MS)
  })

  it('refines events to within 1 min of brute-force 1-min sampling (fixture sites)', () => {
    for (const { ctx } of Object.values(fixtureOutputs)) {
      const { startMs, endMs } = fixtureScenario
      const refined = detectWindows(sampleSite(ctx, startMs, endMs, 10), opts)
      const brute = detectWindows(sampleSite(ctx, startMs, endMs, 1), opts)
      expectSameWindows(refined.sun, brute.sun, MIN_MS)
      expectSameWindows(refined.earth, brute.earth, MIN_MS)
      expectSameWindows(refined.both, brute.both, MIN_MS)
    }
  })

  it('places each refined event where the new state already holds', () => {
    const ctx = syntheticCtx([2, 1, -1, -2, -1, 1, 2], [5, 3, 1, -1, 1, 3, 5])
    const w = detectWindows(sampleSite(ctx, ...span(ctx)), opts)
    const at = (t: number) => sampleSite(ctx, t, t)
    const clearance = (t: number) => at(t).earthElevDeg[0] - at(t).earthHorizonDeg[0] - opts.earthMarginDeg

    expect(at(w.sun[0].endMs).sunFraction[0]).toBeLessThanOrEqual(sunOffAt)
    expect(at(w.sun[1].startMs).sunFraction[0]).toBeGreaterThanOrEqual(sunOnAt)
    expect(clearance(w.earth[0].endMs)).toBeLessThanOrEqual(-opts.earthHysteresisDeg)
    expect(clearance(w.earth[1].startMs)).toBeGreaterThanOrEqual(opts.earthHysteresisDeg)
    // Off the 10-min grid: the refinement moved them.
    for (const t of [w.sun[0].endMs, w.sun[1].startMs, w.earth[0].endMs, w.earth[1].startMs]) {
      expect((t - T0) % (10 * MIN_MS)).not.toBe(0)
    }
  })

  it('clips windows at the sampled range edges', () => {
    const ctx = syntheticCtx([2, 1, -1, -2, -1, 1, 2], [5, 3, 1, -1, 1, 3, 5])
    const { sun } = detectWindows(sampleSite(ctx, ...span(ctx)), opts)
    expect(sun[0]).toMatchObject({ startMs: T0, clippedStart: true, clippedEnd: false })
    expect(sun[1]).toMatchObject({ endMs: T0 + 6 * H_MS, clippedStart: false, clippedEnd: true })
  })

  it('seeds the initial state from the hysteresis band midpoint', () => {
    // Sun 0.008° → fraction ≈ 0.52; Earth 1.05° → clearance 0.05°: both inside the band, above the midpoint.
    const above = sampleSite(syntheticCtx([0.008, 0.008], [1.05, 1.05]), T0, T0 + H_MS)
    expect(above.sunFraction[0]).toBeGreaterThan(opts.sunThreshold)
    expect(above.sunFraction[0]).toBeLessThan(sunOnAt)
    const whole = { startMs: T0, endMs: T0 + H_MS, clippedStart: true, clippedEnd: true }
    expect(detectWindows(above, opts)).toEqual({ sun: [whole], earth: [whole], both: [whole] })

    const below = sampleSite(syntheticCtx([-0.008, -0.008], [0.95, 0.95]), T0, T0 + H_MS)
    expect(below.sunFraction[0]).toBeGreaterThan(sunOffAt)
    expect(detectWindows(below, opts)).toEqual({ sun: [], earth: [], both: [] })
  })

  it('intersects Sun and Earth windows into both', () => {
    // Sun: on, sets ~1.5 h, rises ~4.5 h. Earth: off, rises ~1 h, sets ~5 h.
    const ctx = syntheticCtx([2, 1, -1, -2, -1, 1, 2], [-1, 1, 3, 5, 3, 1, -1])
    const { sun, earth, both } = detectWindows(sampleSite(ctx, ...span(ctx)), opts)
    expect(sun).toHaveLength(2)
    expect(earth).toHaveLength(1)
    expect(both).toEqual([
      { startMs: earth[0].startMs, endMs: sun[0].endMs, clippedStart: false, clippedEnd: false },
      { startMs: sun[1].startMs, endMs: earth[0].endMs, clippedStart: false, clippedEnd: false },
    ])
  })

  it('matches the fixture windows to within 2 min (fixtures interpolate linearly instead of bisecting)', () => {
    for (const { ctx, windows } of Object.values(fixtureOutputs)) {
      const w = detectWindows(sampleSite(ctx, fixtureScenario.startMs, fixtureScenario.endMs), opts)
      expectSameWindows(w.sun, windows.sun, 2 * MIN_MS)
      expectSameWindows(w.earth, windows.earth, 2 * MIN_MS)
      expectSameWindows(w.both, windows.both, 2 * MIN_MS)
    }
  })

  it('rejects a negative or NaN hysteresis', () => {
    const s = sampleSite(syntheticCtx([1, 1], [5, 5]), T0, T0 + H_MS)
    expect(() => detectWindows(s, { ...opts, hysteresis: -0.01 })).toThrow(RangeError)
    expect(() => detectWindows(s, { ...opts, earthHysteresisDeg: -0.1 })).toThrow(RangeError)
    expect(() => detectWindows(s, { ...opts, hysteresis: Number.NaN })).toThrow(RangeError)
  })
})
