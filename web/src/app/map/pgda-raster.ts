// PGDA v0 layer helpers (SPEC-app P0-6): value lookup under a map position and the color ramp. Pure: no DOM.
// Raster layout (pgda-layers.json): 8-bit grayscale, value = percent (0–100), 255 = no data; pixel (column ix, row ny − 1 − iy),
// so the top PNG row is the highest y and the left column the lowest x.
import type { GridExtentInput } from './projection'

export const NO_DATA = 255
export type PgdaLayer = 'sun' | 'earth'

/** Percent under a map position (km), or null outside the raster or on a no-data cell. */
export function rasterValueAt(values: ArrayLike<number>, geom: GridExtentInput, xKm: number, yKm: number): number | null {
  const { originKm, cellKm, nx, ny } = geom
  const ix = Math.floor((xKm - originKm[0]) / cellKm)
  const iy = Math.floor((yKm - originKm[1]) / cellKm)
  if (!(ix >= 0 && ix < nx && iy >= 0 && iy < ny)) return null
  const v = values[(ny - 1 - iy) * nx + ix]
  return v === undefined || v === NO_DATA ? null : v
}

type Rgb = readonly [number, number, number]
// Dark at 0 % to bright at 100 %, so "more light / more Earth" reads as brighter. Different hues tell the layers apart.
const RAMP_STOPS: Record<PgdaLayer, readonly Rgb[]> = {
  sun: [
    [20, 24, 34],
    [124, 72, 22],
    [255, 214, 102],
  ],
  earth: [
    [20, 24, 34],
    [18, 92, 142],
    [130, 224, 255],
  ],
}

/** Color of a percentage (clamped to 0–100) on the layer's ramp. */
export function rampRgb(layer: PgdaLayer, pct: number): [number, number, number] {
  const stops = RAMP_STOPS[layer]
  const t = Math.min(1, Math.max(0, pct / 100)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  const a = stops[i]
  const b = stops[i + 1]
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
}

/** RGBA pixels (same order as `values`) for a canvas ImageData; no-data pixels are fully transparent. */
export function colorizeRaster(values: ArrayLike<number>, layer: PgdaLayer): Uint8ClampedArray {
  const lut = Array.from({ length: 101 }, (_, p) => rampRgb(layer, p))
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === NO_DATA) continue // stays 0,0,0,0
    const [r, g, b] = lut[Math.min(100, v)]
    out.set([r, g, b, 255], i * 4)
  }
  return out
}

/** CSS gradient of the ramp, for the legend bar. */
export function rampCssGradient(layer: PgdaLayer): string {
  const stops = RAMP_STOPS[layer].map((_, i, all) => {
    const pct = (i / (all.length - 1)) * 100
    const [r, g, b] = rampRgb(layer, pct)
    return `rgb(${r}, ${g}, ${b}) ${pct}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

/** Grayscale values from canvas RGBA pixels (the PGDA PNGs are 8-bit grayscale, so the red channel is the value). */
export function grayFromRgba(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]
  return out
}
