import { describe, expect, it } from 'vitest'
import { fixtureOutputs, fixtureScenario } from './__fixtures__'
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, siteFrame, visibleDiskFraction } from './geometry'
import type { SiteContext, Vec3 } from './types'
import { sampleSite } from './windows'

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
