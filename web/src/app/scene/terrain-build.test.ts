import { describe, expect, it } from 'vitest'
import type { TerrainField } from '../terrain-data'
import { NORMAL_BAND_ROWS, buildTerrain, buildTerrainSteps, meshStride } from './terrain-build'
import { buildNormalMap, buildPositionGrid, buildTerrainMesh } from './terrain-mesh'

/** A small bumpy field around the south pole, 40 km wide. */
function field(n: number): TerrainField {
  const heightM = new Int16Array(n * n)
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) heightM[iy * n + ix] = Math.round(300 * Math.sin(ix / 3) * Math.cos(iy / 4))
  return { frame: { originKm: [-20, -20], cellKm: 40 / n, nx: n, ny: n, sphereRadiusKm: 1737.4 }, heightM, source: 'display' }
}

describe('buildTerrain steps', () => {
  it('builds the same mesh and normal map as the one-piece functions', () => {
    const f = field(40)
    const built = buildTerrain(f)
    const positions = buildPositionGrid(f.heightM, f.frame)
    expect(built.normals.rgba).toEqual(buildNormalMap(positions, 40, 40))
    expect(built.mesh).toEqual(buildTerrainMesh(positions, f.frame, meshStride(40)))
    expect(built.field).toBe(f)
  })

  it('banded normal rows are identical to a whole-map build, including across band edges', () => {
    const n = NORMAL_BAND_ROWS + 20 // two bands
    const f = field(n)
    const positions = buildPositionGrid(f.heightM, f.frame)
    expect(buildTerrain(f).normals.rgba).toEqual(buildNormalMap(positions, n, n))
  })

  it('yields between stages, so no single step is the whole build', () => {
    const n = NORMAL_BAND_ROWS * 2 + 1 // 3 bands
    const steps = buildTerrainSteps(field(n))
    let yields = 0
    for (;;) {
      const r = steps.next()
      if (r.done) break
      yields++
    }
    expect(yields).toBe(2 + 3) // positions, mesh, then one per band
  })

  it('decimates a 1024² field 2:1 and leaves a 2 km grid alone', () => {
    expect(meshStride(1024)).toBe(2)
    expect(meshStride(182)).toBe(1)
  })
})
