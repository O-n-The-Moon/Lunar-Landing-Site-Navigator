// Geometry for the Surface (first-person) view: the real terrain skyline from a site's horizon mask, drawn as a ribbon
// around the observer, plus fainter ridge layers in front for depth. Angles are true in azimuth and exaggerated ×5 in
// elevation (as in the 2D panorama; labelled in the view). The layers are always BELOW the real silhouette, so the
// skyline you see is the true one and a body behind it is hidden by the real mask.
import type { Vec3 } from '../../engine'

/** Vertical exaggeration of the Surface view (matches the 2D panorama's scale ratio). */
export const SURFACE_EXAGGERATION = 5

const DEG = Math.PI / 180

/** Unit sky direction: azimuth clockwise from north, elevation up. North is −Z, east is +X, up is +Y. */
export function skyDirection(azDeg: number, elevDeg: number): Vec3 {
  const az = azDeg * DEG
  const el = elevDeg * DEG
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]
}

export interface RibbonData {
  positions: Float32Array
  indices: Uint32Array
  /** Elevation (deg, already exaggerated) of the ribbon's top edge at each azimuth bin, 0 … n (bin n repeats bin 0). */
  topElevDeg: Float64Array
}

export interface RibbonOptions {
  maskDeg: ArrayLike<number>
  azStepDeg: number
  radius: number
  /** Lower the top edge by this many (exaggerated) degrees; > 0 for the in-front layers. */
  dropDeg?: number
  /** Moving-average half-width in bins for the layers (0 = the true profile). */
  smoothBins?: number
  exaggeration?: number
  /** Bottom edge, exaggerated degrees. */
  bottomDeg?: number
}

/** A closed ribbon of quads around the observer; the top edge is `exaggeration × mask` (minus `dropDeg`). */
export function buildSkylineRibbon(o: RibbonOptions): RibbonData {
  const { maskDeg, azStepDeg, radius } = o
  const n = maskDeg.length
  if (!(Math.abs(n * azStepDeg - 360) <= 1e-9)) throw new RangeError(`mask of ${n} bins at ${azStepDeg}° does not cover 360°`)
  const ex = o.exaggeration ?? SURFACE_EXAGGERATION
  const drop = o.dropDeg ?? 0
  const smooth = o.smoothBins ?? 0
  const bottom = o.bottomDeg ?? -45
  const top = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    let v = maskDeg[i]
    if (smooth > 0) {
      let sum = 0
      for (let k = -smooth; k <= smooth; k++) sum += maskDeg[(((i + k) % n) + n) % n]
      // Never above the true profile, so a layer can't poke out over the real silhouette.
      v = Math.min(v, sum / (2 * smooth + 1))
    }
    top[i] = ex * v - drop
  }
  top[n] = top[0]
  const positions = new Float32Array((n + 1) * 2 * 3)
  for (let i = 0; i <= n; i++) {
    const az = i * azStepDeg
    const t = skyDirection(az, top[i])
    const b = skyDirection(az, bottom)
    positions.set([t[0] * radius, t[1] * radius, t[2] * radius], i * 6)
    positions.set([b[0] * radius, b[1] * radius, b[2] * radius], i * 6 + 3)
  }
  const indices = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const t0 = i * 2
    const b0 = t0 + 1
    const t1 = t0 + 2
    const b1 = t0 + 3
    // Seen from the inside (observer at the origin), the outward-facing side is the back; wind for that.
    indices.set([t0, t1, b0, t1, b1, b0], i * 6)
  }
  return { positions, indices, topElevDeg: top }
}
