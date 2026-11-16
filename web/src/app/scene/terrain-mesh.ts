// Terrain mesh data for the 3D view, built from a height field (display only: shading, never visibility).
// Pipeline: heights → world position grid (on the sphere, vertically exaggerated) → a decimated triangle mesh plus a
// per-texel normal map computed from the full-resolution positions, so the 80 m detail shows even on a coarser mesh.
import { kmToLatLon, rhoKm, type MapFrame } from './frame'
import { surfaceWorld } from './world'

/** Vertical exaggeration of the terrain (labelled in the view). */
export const TERRAIN_EXAGGERATION = 3
/** The terrain fades to black between these latitudes, so the square's corners never show. */
export const FADE_START_LAT_DEG = -84.8
export const FADE_END_LAT_DEG = -84

/** World position (km) of every height sample's cell centre: `ny × nx × 3`, same order as the heights. */
export function buildPositionGrid(heightM: Int16Array, frame: MapFrame, exaggeration = TERRAIN_EXAGGERATION): Float32Array {
  const { nx, ny, cellKm, originKm } = frame
  if (heightM.length !== nx * ny) throw new RangeError(`expected ${nx * ny} heights, got ${heightM.length}`)
  const out = new Float32Array(nx * ny * 3)
  for (let iy = 0; iy < ny; iy++) {
    const yKm = originKm[1] + (iy + 0.5) * cellKm
    for (let ix = 0; ix < nx; ix++) {
      const { latDeg, lonDeg } = kmToLatLon(frame, originKm[0] + (ix + 0.5) * cellKm, yKm)
      const i = iy * nx + ix
      const p = surfaceWorld(latDeg, lonDeg, (heightM[i] / 1000) * exaggeration, frame.sphereRadiusKm)
      out[i * 3] = p[0]
      out[i * 3 + 1] = p[1]
      out[i * 3 + 2] = p[2]
    }
  }
  return out
}

export interface TerrainMeshData {
  positions: Float32Array
  /** Texture coordinates of the map square (v = 0 at the lowest y), matching the normal and overlay textures. */
  uvs: Float32Array
  /** 1 inside, 0 at the fade edge. */
  fade: Float32Array
  indices: Uint32Array
  cols: number
  rows: number
}

/** Sample indices 0, stride, 2·stride, … and always the last one. */
function sampleIndices(n: number, stride: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i += stride) out.push(i)
  if (out[out.length - 1] !== n - 1) out.push(n - 1)
  return out
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A triangle mesh over every `stride`-th sample of the position grid (counter-clockwise seen from +Y). */
export function buildTerrainMesh(positionGrid: Float32Array, frame: MapFrame, stride: number): TerrainMeshData {
  const { nx, ny, cellKm, originKm } = frame
  if (!(Number.isInteger(stride) && stride >= 1)) throw new RangeError(`stride must be a positive integer, got ${stride}`)
  if (positionGrid.length !== nx * ny * 3) throw new RangeError('position grid does not match the frame')
  const xs = sampleIndices(nx, stride)
  const ys = sampleIndices(ny, stride)
  const cols = xs.length
  const rows = ys.length
  const positions = new Float32Array(cols * rows * 3)
  const uvs = new Float32Array(cols * rows * 2)
  const fade = new Float32Array(cols * rows)
  const rStart = rhoKm(frame, FADE_START_LAT_DEG)
  const rEnd = rhoKm(frame, FADE_END_LAT_DEG)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = j * cols + i
      const src = (ys[j] * nx + xs[i]) * 3
      positions.set(positionGrid.subarray(src, src + 3), v * 3)
      uvs[v * 2] = (xs[i] + 0.5) / nx
      uvs[v * 2 + 1] = (ys[j] + 0.5) / ny
      const xKm = originKm[0] + (xs[i] + 0.5) * cellKm
      const yKm = originKm[1] + (ys[j] + 0.5) * cellKm
      fade[v] = 1 - smoothstep(rStart, rEnd, Math.hypot(xKm, yKm))
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6)
  let k = 0
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i // lower-left in map terms; +x right, +y (iy) is −Z in the world
      const b = a + 1
      const c = a + cols
      const d = c + 1
      // World X right, world −Z up the map: (a, b, c) winds counter-clockwise seen from +Y.
      indices.set([a, b, c, b, d, c], k)
      k += 6
    }
  }
  return { positions, uvs, fade, indices, cols, rows }
}

/**
 * World-space normals of the displaced surface, one RGBA8 texel per height sample (`n · 0.5 + 0.5`, alpha 255),
 * from central differences of the position grid (one-sided at the edges). Same texel order as the heights.
 */
export function buildNormalMap(positionGrid: Float32Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(nx * ny * 4)
  const at = (ix: number, iy: number, k: number) => positionGrid[(iy * nx + ix) * 3 + k]
  for (let iy = 0; iy < ny; iy++) {
    const y0 = Math.max(0, iy - 1)
    const y1 = Math.min(ny - 1, iy + 1)
    for (let ix = 0; ix < nx; ix++) {
      const x0 = Math.max(0, ix - 1)
      const x1 = Math.min(nx - 1, ix + 1)
      const tx = [at(x1, iy, 0) - at(x0, iy, 0), at(x1, iy, 1) - at(x0, iy, 1), at(x1, iy, 2) - at(x0, iy, 2)]
      const ty = [at(ix, y1, 0) - at(ix, y0, 0), at(ix, y1, 1) - at(ix, y0, 1), at(ix, y1, 2) - at(ix, y0, 2)]
      // +ix is +X and +iy is −Z, so tx × ty points up (+Y).
      let nxv = tx[1] * ty[2] - tx[2] * ty[1]
      let nyv = tx[2] * ty[0] - tx[0] * ty[2]
      let nzv = tx[0] * ty[1] - tx[1] * ty[0]
      const len = Math.hypot(nxv, nyv, nzv) || 1
      nxv /= len
      nyv /= len
      nzv /= len
      const o = (iy * nx + ix) * 4
      out[o] = Math.round((nxv * 0.5 + 0.5) * 255)
      out[o + 1] = Math.round((nyv * 0.5 + 0.5) * 255)
      out[o + 2] = Math.round((nzv * 0.5 + 0.5) * 255)
      out[o + 3] = 255
    }
  }
  return out
}

/** Height (m) at a fractional cell coordinate (cell i's centre is at i), bilinear and clamped to the field. */
export function sampleHeightM(heightM: Int16Array, nx: number, ny: number, fx: number, fy: number): number {
  const x = Math.min(nx - 1, Math.max(0, fx))
  const y = Math.min(ny - 1, Math.max(0, fy))
  const x0 = Math.min(nx - 2, Math.floor(x))
  const y0 = Math.min(ny - 2, Math.floor(y))
  const tx = nx > 1 ? x - x0 : 0
  const ty = ny > 1 ? y - y0 : 0
  const x1 = nx > 1 ? x0 + 1 : x0
  const y1 = ny > 1 ? y0 + 1 : y0
  const top = heightM[y0 * nx + x0] * (1 - tx) + heightM[y0 * nx + x1] * tx
  const bottom = heightM[y1 * nx + x0] * (1 - tx) + heightM[y1 * nx + x1] * tx
  return top * (1 - ty) + bottom * ty
}
