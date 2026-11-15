import { describe, expect, it } from 'vitest'
import { fixtureEphemeris, fixtureOutputs, fixtureSitesFile } from './__fixtures__'
import {
  MAX_ABS_LAT_DEG,
  MOON_RADIUS_KM,
  angularRadiusDeg,
  azEl,
  bodyVectorKm,
  horizonElevAt,
  siteFrame,
  visibleDiskFraction,
} from './geometry'
import type { Ephemeris, Vec3 } from './types'

const H_MS = 3_600_000
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

describe('bodyVectorKm', () => {
  // 3 hourly samples, bodies in [earth, sun] order to check lookup by name, not position.
  const eph: Ephemeris = {
    startUtcMs: Date.UTC(2026, 0, 1),
    stepMs: H_MS,
    count: 3,
    bodies: ['earth', 'sun'],
    // t0: earth (1,2,3) sun (10,20,30); t1: earth (3,2,1) sun (30,20,10); t2: earth (5,5,5) sun (0,0,0)
    positionsKm: Float32Array.from([1, 2, 3, 10, 20, 30, 3, 2, 1, 30, 20, 10, 5, 5, 5, 0, 0, 0]),
  }
  const t0 = eph.startUtcMs

  it('returns the stored sample exactly at sample times, looking bodies up by name', () => {
    expect(bodyVectorKm(eph, 'earth', t0)).toEqual([1, 2, 3])
    expect(bodyVectorKm(eph, 'sun', t0)).toEqual([10, 20, 30])
    expect(bodyVectorKm(eph, 'sun', t0 + H_MS)).toEqual([30, 20, 10])
  })

  it('interpolates linearly within an hour', () => {
    expect(bodyVectorKm(eph, 'earth', t0 + H_MS / 2)).toEqual([2, 2, 2])
    expect(bodyVectorKm(eph, 'sun', t0 + H_MS / 4)).toEqual([15, 20, 25])
  })

  it('is continuous across an hour boundary', () => {
    const before = bodyVectorKm(eph, 'earth', t0 + H_MS - 1)
    const at = bodyVectorKm(eph, 'earth', t0 + H_MS)
    const after = bodyVectorKm(eph, 'earth', t0 + H_MS + 1)
    for (let k = 0; k < 3; k++) {
      expect(before[k]).toBeCloseTo(at[k], 5)
      expect(after[k]).toBeCloseTo(at[k], 5)
    }
    expect(bodyVectorKm(eph, 'earth', t0 + 1.5 * H_MS)).toEqual([4, 3.5, 3])
  })

  it('accepts the last sample time and rejects times outside coverage', () => {
    expect(bodyVectorKm(eph, 'earth', t0 + 2 * H_MS)).toEqual([5, 5, 5])
    expect(() => bodyVectorKm(eph, 'earth', t0 - 1)).toThrow(RangeError)
    expect(() => bodyVectorKm(eph, 'earth', t0 + 2 * H_MS + 1)).toThrow(RangeError)
    expect(() => bodyVectorKm(eph, 'earth', Number.NaN)).toThrow(RangeError)
  })
})

describe('siteFrame', () => {
  it('builds an orthonormal right-handed ENU basis (east × north = up)', () => {
    for (const [lat, lon] of [[-85, 29.2], [-89.5, -137.3], [0, 0], [45, 170]]) {
      const f = siteFrame(lat, lon, 0, 2)
      for (const v of [f.east, f.north, f.up]) expect(Math.hypot(...v)).toBeCloseTo(1, 12)
      expect(dot(f.east, f.north)).toBeCloseTo(0, 12)
      expect(dot(f.east, f.up)).toBeCloseTo(0, 12)
      expect(dot(f.north, f.up)).toBeCloseTo(0, 12)
      cross(f.east, f.north).forEach((c, k) => expect(c).toBeCloseTo(f.up[k], 12))
    }
  })

  it('places the observer at R + surface height + observer height along up', () => {
    const f = siteFrame(-85, 30, 1500, 2)
    expect(Math.hypot(...f.positionKm)).toBeCloseTo(MOON_RADIUS_KM + 1.502, 9)
    f.positionKm.forEach((c, k) => expect(c / Math.hypot(...f.positionKm)).toBeCloseTo(f.up[k], 12))
  })

  it('matches the MOON_ME axes at lat 0, lon 0 (up = +x, east = +y, north = +z)', () => {
    const f = siteFrame(0, 0, 0, 0)
    ;[f.up, f.east, f.north].forEach((v, i) => v.forEach((c, k) => expect(c).toBeCloseTo(i === k ? 1 : 0, 12)))
  })

  it('points north toward increasing latitude, east toward increasing longitude', () => {
    const f = siteFrame(-85, 30, 0, 0)
    const n = siteFrame(-84.99, 30, 0, 0).positionKm
    const e = siteFrame(-85, 30.01, 0, 0).positionKm
    const d = (p: Vec3): Vec3 => [p[0] - f.positionKm[0], p[1] - f.positionKm[1], p[2] - f.positionKm[2]]
    expect(dot(d(n), f.north)).toBeGreaterThan(0)
    expect(dot(d(e), f.east)).toBeGreaterThan(0)
  })

  it('normalizes longitude to −180…180 (east-positive)', () => {
    expect(siteFrame(-85, 200, 0, 0).lonDeg).toBeCloseTo(-160, 12)
    expect(siteFrame(-85, -190, 0, 0).lonDeg).toBeCloseTo(170, 12)
    expect(siteFrame(-85, 180, 0, 0).lonDeg).toBe(180)
    siteFrame(-85, 200, 0, 0).up.forEach((c, k) => expect(c).toBeCloseTo(siteFrame(-85, -160, 0, 0).up[k], 12))
  })

  it('reproduces the T2 fixture frames from site lat/lon/heights', () => {
    for (const site of fixtureSitesFile.sites) {
      const expected = fixtureOutputs[site.id].ctx.frame
      const f = siteFrame(site.latDeg, site.lonDeg, site.surfaceHeightM, 2)
      for (const key of ['positionKm', 'east', 'north', 'up'] as const) {
        f[key].forEach((c, k) => expect(c).toBeCloseTo(expected[key][k], 9))
      }
    }
  })

  it('clamps latitude to ±89.999° so north stays defined at the pole', () => {
    const f = siteFrame(-90, 45, 0, 2)
    expect(f.latDeg).toBe(-MAX_ABS_LAT_DEG)
    expect(f.lonDeg).toBe(45)
    for (const v of [f.east, f.north, f.up]) expect(v.every(Number.isFinite)).toBe(true)
    expect(siteFrame(90, 0, 0, 0).latDeg).toBe(MAX_ABS_LAT_DEG)
  })
})

describe('azEl', () => {
  const site = siteFrame(0, 0, 0, 0) // position (R, 0, 0); east +y, north +z, up +x
  const far = 1e6

  it('measures azimuth clockwise from north: N 0°, E 90°, S 180°, W 270°', () => {
    expect(azEl(site, add(site.positionKm, [0, 0, far])).azDeg).toBeCloseTo(0, 9)
    expect(azEl(site, add(site.positionKm, [0, far, 0])).azDeg).toBeCloseTo(90, 9)
    expect(azEl(site, add(site.positionKm, [0, 0, -far])).azDeg).toBeCloseTo(180, 9)
    expect(azEl(site, add(site.positionKm, [0, -far, 0])).azDeg).toBeCloseTo(270, 9)
  })

  it('returns azimuth in [0, 360)', () => {
    const justWestOfNorth = azEl(site, add(site.positionKm, [0, -1, far])).azDeg
    expect(justWestOfNorth).toBeGreaterThan(359.99)
    expect(justWestOfNorth).toBeLessThan(360)
  })

  it('returns +0, never −0, for a body due north', () => {
    // A frame whose east components are all −0 makes v·east = −0, and atan2(−0, n) = −0.
    const negZeroEast = { ...site, east: [-0, -0, -0] as const }
    expect(azEl(negZeroEast, add(site.positionKm, [0, 0, far])).azDeg).toBe(0)
  })

  it('measures elevation above the local horizontal, with topocentric distance', () => {
    const zenith = azEl(site, add(site.positionKm, [far, 0, 0]))
    expect(zenith.elevDeg).toBeCloseTo(90, 9)
    expect(zenith.distKm).toBeCloseTo(far, 6)
    const up45 = azEl(site, add(site.positionKm, [far, far, 0]))
    expect(up45.elevDeg).toBeCloseTo(45, 9)
    expect(up45.azDeg).toBeCloseTo(90, 9)
    expect(azEl(site, add(site.positionKm, [-far, 0, far])).elevDeg).toBeCloseTo(-45, 9)
  })

  it('is topocentric: uses body − site, not the Moon-center direction', () => {
    // A body straight "north" of the Moon's center sits slightly below this site's horizon.
    const { elevDeg, distKm } = azEl(site, [0, 0, far])
    expect(elevDeg).toBeCloseTo((-Math.atan(MOON_RADIUS_KM / far) * 180) / Math.PI, 9)
    expect(distKm).toBeCloseTo(Math.hypot(MOON_RADIUS_KM, far), 6)
  })

  it('reproduces the T2 fixture samples (same conventions, independent code)', () => {
    for (const { ctx, samples } of Object.values(fixtureOutputs)) {
      for (const i of [0, 7, 100, samples.tUtcMs.length - 1]) {
        const t = samples.tUtcMs[i]
        const sun = azEl(ctx.frame, bodyVectorKm(fixtureEphemeris, 'sun', t))
        const earth = azEl(ctx.frame, bodyVectorKm(fixtureEphemeris, 'earth', t))
        expect(sun.azDeg).toBeCloseTo(samples.sunAzDeg[i], 5)
        expect(sun.elevDeg).toBeCloseTo(samples.sunElevDeg[i], 5)
        expect(earth.azDeg).toBeCloseTo(samples.earthAzDeg[i], 5)
        expect(earth.elevDeg).toBeCloseTo(samples.earthElevDeg[i], 5)
      }
    }
  })
})

describe('horizonElevAt', () => {
  const mask = [0, 1, 2, 3] // azStepDeg 90: bins at 0, 90, 180, 270

  it('returns bin values at bin azimuths', () => {
    expect(horizonElevAt(mask, 90, 0)).toBe(0)
    expect(horizonElevAt(mask, 90, 180)).toBe(2)
  })

  it('interpolates linearly between bins', () => {
    expect(horizonElevAt(mask, 90, 45)).toBeCloseTo(0.5, 12)
    expect(horizonElevAt(mask, 90, 225)).toBeCloseTo(2.5, 12)
  })

  it('wraps between the last bin and 0° (359.75° on a 0.5° mask)', () => {
    const m = Array.from({ length: 720 }, (_, i) => (i === 719 ? 4 : i === 0 ? 2 : 0))
    expect(horizonElevAt(m, 0.5, 359.75)).toBeCloseTo(3, 12)
    expect(horizonElevAt(m, 0.5, 360)).toBeCloseTo(2, 12)
    expect(horizonElevAt(mask, 90, 315)).toBeCloseTo(1.5, 12)
  })

  it('normalizes azimuths outside [0, 360)', () => {
    expect(horizonElevAt(mask, 90, -45)).toBeCloseTo(1.5, 12)
    expect(horizonElevAt(mask, 90, 405)).toBeCloseTo(0.5, 12)
  })

  it('works on typed arrays', () => {
    expect(horizonElevAt(Float32Array.from(mask), 90, 135)).toBeCloseTo(1.5, 6)
  })

  it('rejects a mask that does not cover 360° at the given step', () => {
    expect(() => horizonElevAt([0, 1, 2], 90, 300)).toThrow(RangeError)
    expect(() => horizonElevAt(mask, 0.5, 10)).toThrow(RangeError)
  })
})

describe('angularRadiusDeg', () => {
  it('gives the Sun ~0.2665° at 1 AU and Earth ~0.950° at 384,400 km', () => {
    expect(angularRadiusDeg('sun', 149_597_870.7)).toBeCloseTo(0.26646, 4)
    expect(angularRadiusDeg('earth', 384_400)).toBeCloseTo(0.94963, 4)
  })

  it('uses asin(R/d): exact for a known ratio', () => {
    expect(angularRadiusDeg('earth', 6_371 * 2)).toBeCloseTo(30, 9)
  })

  it('returns NaN for a distance not outside the body (impossible geometry)', () => {
    expect(angularRadiusDeg('earth', 6_371)).toBeNaN()
    expect(angularRadiusDeg('sun', 0)).toBeNaN()
    expect(angularRadiusDeg('sun', -5)).toBeNaN()
    expect(angularRadiusDeg('sun', Number.NaN)).toBeNaN()
  })
})

describe('visibleDiskFraction', () => {
  const r = 0.27

  it('is 0, 0.5 and 1 at d = −1, 0, 1 (center one radius below, on, one radius above the horizon)', () => {
    expect(visibleDiskFraction(2 - r, 2, r)).toBeCloseTo(0, 12)
    expect(visibleDiskFraction(2, 2, r)).toBeCloseTo(0.5, 12)
    expect(visibleDiskFraction(2 + r, 2, r)).toBeCloseTo(1, 12)
  })

  it('clamps beyond one radius', () => {
    expect(visibleDiskFraction(-5, 2, r)).toBe(0)
    expect(visibleDiskFraction(9, 2, r)).toBe(1)
  })

  it('matches the circular-segment formula at d = 0.5', () => {
    const expected = 1 - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI
    expect(visibleDiskFraction(1 + r / 2, 1, r)).toBeCloseTo(expected, 12)
  })

  it('is symmetric: f(d) + f(−d) = 1, and increases with d', () => {
    let prev = -1
    for (let d = -1; d <= 1.0001; d += 0.125) {
      const f = visibleDiskFraction(d * r, 0, r)
      expect(f + visibleDiskFraction(-d * r, 0, r)).toBeCloseTo(1, 12)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
  })

  it('treats a zero radius as a point: visible iff the center is at or above the horizon', () => {
    expect(visibleDiskFraction(1, 1, 0)).toBe(1)
    expect(visibleDiskFraction(0.999, 1, 0)).toBe(0)
  })

  it('propagates bad input as NaN instead of silently using a point', () => {
    expect(visibleDiskFraction(1, 0, Number.NaN)).toBeNaN()
    expect(visibleDiskFraction(1, 0, -0.27)).toBeNaN()
    expect(visibleDiskFraction(Number.NaN, 0, 0.27)).toBeNaN()
  })
})
