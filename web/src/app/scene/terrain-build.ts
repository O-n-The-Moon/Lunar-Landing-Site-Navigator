// Builds the drawable terrain (position grid, decimated triangle mesh, per-texel normal map) from a height field in
// small steps, so the caller can yield to the browser between them. At 1024² the one-piece build froze the page for
// ~180 ms (review item 14); the steps here are each a few tens of ms. Pure: no React, no DOM, no timers.
import type { TerrainField } from '../terrain-data'
import { buildNormalMap, buildPositionGrid, buildTerrainMesh, type TerrainMeshData } from './terrain-mesh'

export interface BuiltTerrain {
  field: TerrainField
  mesh: TerrainMeshData
  /** RGBA8 normal map, one texel per height sample. */
  normals: { rgba: Uint8Array; nx: number; ny: number }
}

/** Rows of the normal map built per step. */
export const NORMAL_BAND_ROWS = 128

/** A 1024² field is decimated 2:1 for the triangle mesh; the normal map keeps every sample, so the detail shows. */
export const meshStride = (nx: number): number => Math.max(1, Math.round(nx / 512))

/** Runs the build one step per `next()`; the generator's return value is the finished terrain. */
export function* buildTerrainSteps(field: TerrainField): Generator<void, BuiltTerrain, void> {
  const { frame, heightM } = field
  const positions = buildPositionGrid(heightM, frame)
  yield
  const mesh = buildTerrainMesh(positions, frame, meshStride(frame.nx))
  yield
  const rgba = new Uint8Array(frame.nx * frame.ny * 4)
  for (let iy = 0; iy < frame.ny; iy += NORMAL_BAND_ROWS) {
    buildNormalMap(positions, frame.nx, frame.ny, rgba, iy, Math.min(frame.ny, iy + NORMAL_BAND_ROWS))
    yield
  }
  return { field, mesh, normals: { rgba, nx: frame.nx, ny: frame.ny } }
}

/** The whole build at once (tests, and anything that does not care about yielding). */
export function buildTerrain(field: TerrainField): BuiltTerrain {
  const steps = buildTerrainSteps(field)
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
  }
}
