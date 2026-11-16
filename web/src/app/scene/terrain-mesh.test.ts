import { describe, expect, it } from 'vitest'
import type { MapFrame } from './frame'
import { buildNormalMap, buildPositionGrid, buildTerrainMesh, sampleHeightM } from './terrain-mesh'

const frame = (n: number, cellKm: number): MapFrame => ({
  originKm: [(-n * cellKm) / 2, (-n * cellKm) / 2],
  cellKm,
  nx: n,
  ny: n,
  sphereRadiusKm: 1737.4,
})

const flat = (n: number) => new Int16Array(n * n)
const decode = (b: number) => (b / 255) * 2 - 1

describe('buildPositionGrid', () => {
  it('rejects a height array of the wrong size', () => {
    expect(() => buildPositionGrid(new Int16Array(5), frame(4, 2))).toThrow(RangeError)
  })

  it('puts cells at their map position (x = east, −z = north on the map) and lets the sphere fall away', () => {
    const f = frame(8, 20) // ±80 km
    const g = buildPositionGrid(flat(8), f)
    const p = (ix: number, iy: number) => Array.from(g.subarray((iy * 8 + ix) * 3, (iy * 8 + ix) * 3 + 3))
    expect(p(7, 3)[0]).toBeGreaterThan(p(0, 3)[0]) // +ix → +X
    expect(p(3, 7)[2]).toBeLessThan(p(3, 0)[2]) // +iy → −Z
    expect(p(0, 0)[1]).toBeLessThan(p(3, 3)[1]) // farther from the pole is lower
    expect(p(3, 3)[1]).toBeGreaterThan(-0.5) // near the pole
  })

  it('exaggerates heights vertically', () => {
    const f = frame(4, 2)
    const h = new Int16Array(16).fill(1000)
    const lo = buildPositionGrid(h, f, 1)
    const hi = buildPositionGrid(h, f, 3)
    expect(hi[1] - lo[1]).toBeCloseTo(2, 3) // +1 km extra at ×3 vs ×1, near the pole
  })
})

describe('buildTerrainMesh', () => {
  const f = frame(9, 2)
  const grid = buildPositionGrid(flat(9), f)

  it('samples every stride-th cell and always the last one', () => {
    const m = buildTerrainMesh(grid, f, 4) // indices 0, 4, 8
    expect([m.cols, m.rows]).toEqual([3, 3])
    const m3 = buildTerrainMesh(grid, f, 3) // 0, 3, 6, 8
    expect([m3.cols, m3.rows]).toEqual([4, 4])
    expect(m3.positions).toHaveLength(16 * 3)
    expect(m3.indices).toHaveLength(9 * 6)
  })

  it('gives texture coordinates of the cell centres (v = 0 at the lowest y)', () => {
    const m = buildTerrainMesh(grid, f, 4)
    expect(m.uvs[0]).toBeCloseTo(0.5 / 9, 6)
    expect(m.uvs[1]).toBeCloseTo(0.5 / 9, 6)
    const last = (m.cols * m.rows - 1) * 2
    expect(m.uvs[last]).toBeCloseTo(8.5 / 9, 6)
    expect(m.uvs[last + 1]).toBeCloseTo(8.5 / 9, 6)
  })

  it('winds triangles counter-clockwise seen from above (+Y)', () => {
    const m = buildTerrainMesh(grid, f, 4)
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => Array.from(m.positions.subarray(m.indices[t + k] * 3, m.indices[t + k] * 3 + 3)))
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const normalY = e1[2] * e2[0] - e1[0] * e2[2]
      expect(normalY).toBeGreaterThan(0)
    }
  })

  it('fades to 0 at the corners of the square and stays 1 near the pole', () => {
    const big = frame(32, 11.375) // the real ±182 km square, coarse
    const m = buildTerrainMesh(buildPositionGrid(new Int16Array(32 * 32), big), big, 1)
    expect(m.fade[0]).toBe(0) // corner
    const centre = (16 * 32 + 16) * 1
    expect(m.fade[centre]).toBe(1)
    expect(Math.min(...m.fade)).toBe(0)
  })

  it('rejects a bad stride or a mismatched grid', () => {
    expect(() => buildTerrainMesh(grid, f, 0)).toThrow(RangeError)
    expect(() => buildTerrainMesh(grid, frame(4, 2), 1)).toThrow(RangeError)
  })
})

describe('buildNormalMap', () => {
  it('points up on flat terrain near the pole and tilts away from the pole with distance (sphere curvature)', () => {
    const f = frame(16, 20) // ±160 km
    const g = buildPositionGrid(flat(16), f)
    const nm = buildNormalMap(g, 16, 16)
    const n = (ix: number, iy: number) => [0, 1, 2].map((k) => decode(nm[(iy * 16 + ix) * 4 + k]))
    const near = n(7, 7)
    expect(near[1]).toBeGreaterThan(0.999)
    const east = n(15, 8) // far to +X: the surface normal leans toward +X (outward)
    expect(east[0]).toBeGreaterThan(0.05)
    expect(east[1]).toBeGreaterThan(0.95)
    expect(nm[3]).toBe(255)
  })

  it('shades a slope: a ramp rising with +ix tilts the normal toward −X', () => {
    const f = frame(8, 1)
    const h = new Int16Array(64)
    for (let iy = 0; iy < 8; iy++) for (let ix = 0; ix < 8; ix++) h[iy * 8 + ix] = ix * 500 // 0.5 km per 1 km cell
    const nm = buildNormalMap(buildPositionGrid(h, f, 1), 8, 8)
    const o = (3 * 8 + 4) * 4
    expect(decode(nm[o])).toBeLessThan(-0.3)
    expect(decode(nm[o + 1])).toBeGreaterThan(0.6)
    expect(Math.abs(decode(nm[o + 2]))).toBeLessThan(0.05)
  })

  it('has unit-length normals', () => {
    const f = frame(8, 5)
    const h = Int16Array.from({ length: 64 }, (_, i) => (i * 37) % 300)
    const nm = buildNormalMap(buildPositionGrid(h, f), 8, 8)
    for (let t = 0; t < 64; t++) {
      const len = Math.hypot(decode(nm[t * 4]), decode(nm[t * 4 + 1]), decode(nm[t * 4 + 2]))
      expect(len).toBeGreaterThan(0.98)
      expect(len).toBeLessThan(1.02)
    }
  })
})

describe('sampleHeightM', () => {
  const h = Int16Array.from([0, 100, 200, 300])
  it('interpolates bilinearly between cell centres and clamps outside', () => {
    expect(sampleHeightM(h, 2, 2, 0, 0)).toBe(0)
    expect(sampleHeightM(h, 2, 2, 0.5, 0)).toBe(50)
    expect(sampleHeightM(h, 2, 2, 0.5, 0.5)).toBe(150)
    expect(sampleHeightM(h, 2, 2, 5, 5)).toBe(300)
    expect(sampleHeightM(h, 2, 2, -3, -3)).toBe(0)
  })
})
