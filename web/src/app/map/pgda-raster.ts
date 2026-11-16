// PGDA v0 layer helpers (SPEC-app P0-6): value lookup under a map position and the color ramp. Pure: no DOM.
// Raster layout (pgda-layers.json): 8-bit grayscale, value = percent (0–100), 255 = no data; pixel (column ix, row ny − 1 − iy),
// so the top PNG row is the highest y and the left column the lowest x.
import { rampColor, rampCss, type RampName } from './colormaps'
import type { GridExtentInput } from './projection'

export const NO_DATA = 255
/** A valid cell value is a whole percent, 0–100; 255 (no data) and anything else is not drawn or read out. */
const isPercent = (v: number) => v >= 0 && v <= 100

export type PgdaLayer = 'sun' | 'earth'

/** Percent under a map position (km), or null outside the raster or on a no-data cell. */
export function rasterValueAt(values: ArrayLike<number>, geom: GridExtentInput, xKm: number, yKm: number): number | null {
  const { originKm, cellKm, nx, ny } = geom
  const ix = Math.floor((xKm - originKm[0]) / cellKm)
  const iy = Math.floor((yKm - originKm[1]) / cellKm)
  if (!(ix >= 0 && ix < nx && iy >= 0 && iy < ny)) return null
  const v = values[(ny - 1 - iy) * nx + ix]
  return v === undefined || !isPercent(v) ? null : v
}

/** Color of a percentage (clamped to 0–100) on the layer's ramp (the shared ramps in `colormaps.ts`). */
export const rampRgb = (layer: RampName, pct: number): [number, number, number] => rampColor(layer, pct)

/** RGBA pixels (same order as `values`) for a canvas ImageData; no-data pixels are fully transparent. */
export function colorizeRaster(values: ArrayLike<number>, layer: RampName): Uint8ClampedArray<ArrayBuffer> {
  const lut = Array.from({ length: 101 }, (_, p) => rampRgb(layer, p))
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!isPercent(v)) continue // stays 0,0,0,0
    const [r, g, b] = lut[v]
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  }
  return out
}

/** CSS gradient of the ramp, for the legend bar. */
export const rampCssGradient = (layer: RampName): string => rampCss(layer)

/** Grayscale values from canvas RGBA pixels (the PGDA PNGs are 8-bit grayscale, so the red channel is the value). */
export function grayFromRgba(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]
  return out
}

/**
 * A PGDA layer's values in grid order (`iy · nx + ix`, iy = 0 is the lowest y) as Float32, NaN where there is no valid
 * value. The decoded PNG is in PNG row order (grid row `iy` is PNG row `ny − 1 − iy`, see the top of this file), so the
 * rows are flipped here: the 3D overlays and the window-score layers share the grid order.
 */
export function pgdaToGridOrder(values: ArrayLike<number>, nx: number, ny: number): Float32Array {
  if (values.length !== nx * ny) throw new RangeError(`expected ${nx * ny} values (${nx} × ${ny}), got ${values.length}`)
  const out = new Float32Array(nx * ny)
  for (let iy = 0; iy < ny; iy++) {
    const row = (ny - 1 - iy) * nx
    for (let ix = 0; ix < nx; ix++) {
      const v = values[row + ix]
      out[iy * nx + ix] = isPercent(v) ? v : NaN
    }
  }
  return out
}
