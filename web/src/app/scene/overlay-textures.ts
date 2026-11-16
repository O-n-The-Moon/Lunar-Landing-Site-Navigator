// Pixel data for the textures draped on the terrain: the live-shadow (Sun fraction) texture and the colour overlays
// (window scores, PGDA averages). Pure functions over grid-order arrays (`iy · nx + ix`, iy = 0 = lowest y); the
// scene uploads them as DataTextures with flipY = false so v = 0 is the lowest y.
import { rampRgb, type RampName } from '../map/colormaps'
import type { MapFrame } from './frame'

/** RGBA8 of a percent layer (0–100) with the map's colour ramp; NaN → fully transparent. */
export function percentToRgba(values: ArrayLike<number>, ramp: RampName, alpha = 255): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const rgb = rampRgb(ramp, values[i])
    if (!rgb) continue // transparent
    out[i * 4] = rgb[0]
    out[i * 4 + 1] = rgb[1]
    out[i * 4 + 2] = rgb[2]
    out[i * 4 + 3] = alpha
  }
  return out
}

/** RGBA8 of the visible Sun fraction (0–1): red = fraction · 255, alpha 255. NaN (no data) reads as shadow. */
export function illuminationToRgba(frac: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(frac.length * 4)
  for (let i = 0; i < frac.length; i++) {
    const f = frac[i]
    out[i * 4] = Number.isNaN(f) ? 0 : Math.round(Math.min(1, Math.max(0, f)) * 255)
    out[i * 4 + 3] = 255
  }
  return out
}

/** True when two frames cover the same map square (an overlay may only be draped on the terrain then). */
export function sameSquare(a: Pick<MapFrame, 'originKm' | 'cellKm' | 'nx' | 'ny'>, b: Pick<MapFrame, 'originKm' | 'cellKm' | 'nx' | 'ny'>): boolean {
  const tol = 1e-6
  return (
    Math.abs(a.originKm[0] - b.originKm[0]) < tol &&
    Math.abs(a.originKm[1] - b.originKm[1]) < tol &&
    Math.abs(a.nx * a.cellKm - b.nx * b.cellKm) < tol &&
    Math.abs(a.ny * a.cellKm - b.ny * b.cellKm) < tol
  )
}
