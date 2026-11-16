import { describe, expect, it } from 'vitest'
import { buildSkylineRibbon, skyDirection, SURFACE_EXAGGERATION } from './horizon-ring'

const mask = (n: number, f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i))

describe('skyDirection', () => {
  it('puts north at −Z, east at +X, south at +Z and up at +Y', () => {
    const near = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12))
    near(skyDirection(0, 0), [0, 0, -1])
    near(skyDirection(90, 0), [1, 0, 0])
    near(skyDirection(180, 0), [0, 0, 1])
    near(skyDirection(270, 0), [-1, 0, 0])
    near(skyDirection(123, 90), [0, 1, 0])
  })
})

describe('buildSkylineRibbon', () => {
  const m = mask(360, (i) => 1 + Math.sin((i * Math.PI) / 30) * 0.8) // 0.2…1.8° ridge line, 1° bins

  it('rejects a mask that does not cover 360°', () => {
    expect(() => buildSkylineRibbon({ maskDeg: mask(100, () => 0), azStepDeg: 1, radius: 10 })).toThrow(RangeError)
  })

  it('draws the top edge at exactly ×5 the mask elevation, bin by bin, and closes the loop', () => {
    const r = buildSkylineRibbon({ maskDeg: m, azStepDeg: 1, radius: 100 })
    expect(r.topElevDeg).toHaveLength(361)
    for (let i = 0; i < 360; i++) expect(r.topElevDeg[i]).toBeCloseTo(SURFACE_EXAGGERATION * m[i], 12)
    expect(r.topElevDeg[360]).toBe(r.topElevDeg[0])
    expect(r.positions).toHaveLength(361 * 2 * 3)
    expect(r.indices).toHaveLength(360 * 6)
  })

  it('places vertices at the right azimuth and elevation on the sphere of the given radius', () => {
    const r = buildSkylineRibbon({ maskDeg: mask(360, () => 2), azStepDeg: 1, radius: 50 })
    const top90 = Array.from(r.positions.subarray(90 * 6, 90 * 6 + 3)) // az 90° = east
    expect(Math.hypot(...top90)).toBeCloseTo(50, 4)
    expect(top90[0]).toBeGreaterThan(49)
    expect(top90[1]).toBeCloseTo(50 * Math.sin(10 * (Math.PI / 180)), 4) // 2° × 5
    expect(top90[2]).toBeCloseTo(0, 3)
  })

  it('keeps every in-front layer strictly below the true silhouette', () => {
    const real = buildSkylineRibbon({ maskDeg: m, azStepDeg: 1, radius: 100 })
    for (const [drop, smooth] of [
      [1.5, 0],
      [3, 4],
      [5, 12],
    ]) {
      const layer = buildSkylineRibbon({ maskDeg: m, azStepDeg: 1, radius: 60, dropDeg: drop, smoothBins: smooth })
      for (let i = 0; i <= 360; i++) expect(layer.topElevDeg[i]).toBeLessThan(real.topElevDeg[i])
    }
  })

  it('works for the 0.5° curated-site masks (720 bins)', () => {
    const r = buildSkylineRibbon({ maskDeg: mask(720, (i) => (i % 40) / 40), azStepDeg: 0.5, radius: 100 })
    expect(r.indices).toHaveLength(720 * 6)
  })
})
