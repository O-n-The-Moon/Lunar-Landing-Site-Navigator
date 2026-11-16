import { describe, expect, it } from 'vitest'
import { NO_DATA, colorizeRaster, grayFromRgba, rampCssGradient, rampRgb, rasterValueAt } from './pgda-raster'

// 4 × 4 raster, 2 km cells, origin (−4, −4): x, y ∈ [−4, 4). Pixel (column ix, row ny − 1 − iy): the top PNG row is the highest y.
const geom = { originKm: [-4, -4] as const, cellKm: 2, nx: 4, ny: 4 }
// rows listed top → bottom (y from +4 down to −4)
const values = Uint8Array.from([
  /* y ∈ [ 2,  4) */ 10, 11, 12, 13,
  /* y ∈ [ 0,  2) */ 20, 21, 22, 23,
  /* y ∈ [−2,  0) */ 30, 31, 32, NO_DATA,
  /* y ∈ [−4, −2) */ 40, 41, 42, 43,
])

describe('rasterValueAt', () => {
  it('reads the cell under a map position, with the top row at the highest y', () => {
    expect(rasterValueAt(values, geom, -3, 3)).toBe(10) // top-left
    expect(rasterValueAt(values, geom, 3, 3)).toBe(13) // top-right
    expect(rasterValueAt(values, geom, 1, 1)).toBe(22) // x ∈ [0,2), y ∈ [0,2)
    expect(rasterValueAt(values, geom, -3, -3)).toBe(40) // bottom-left
  })

  it('treats values above 100 like no data, in the readout and in the picture', () => {
    const odd = Uint8Array.from([101, 200, 50, 0])
    const g = { originKm: [0, 0] as const, cellKm: 1, nx: 2, ny: 2 }
    expect(rasterValueAt(odd, g, 0.5, 1.5)).toBeNull() // 101
    expect(rasterValueAt(odd, g, 1.5, 1.5)).toBeNull() // 200
    expect(rasterValueAt(odd, g, 0.5, 0.5)).toBe(50)
    expect(rasterValueAt(odd, g, 1.5, 0.5)).toBe(0) // 0 % is a value, not "no data"
    const rgba = colorizeRaster(odd, 'sun')
    expect([rgba[3], rgba[7], rgba[11], rgba[15]]).toEqual([0, 0, 255, 255])
  })

  it('returns null for no-data cells and for positions outside the raster', () => {
    expect(rasterValueAt(values, geom, 3, -1)).toBeNull()
    expect(rasterValueAt(values, geom, 4.01, 0)).toBeNull()
    expect(rasterValueAt(values, geom, -4.01, 0)).toBeNull()
    expect(rasterValueAt(values, geom, 0, 4)).toBeNull() // the upper edge is exclusive, like grid cells
  })
})

describe('rampRgb / colorizeRaster', () => {
  it('maps 0 % and 100 % to the two ends of the ramp and clamps outside 0–100', () => {
    expect(rampRgb('sun', 0)).toEqual(rampRgb('sun', -5))
    expect(rampRgb('sun', 100)).toEqual(rampRgb('sun', 250 - 150))
    expect(rampRgb('sun', 0)).not.toEqual(rampRgb('sun', 100))
  })

  it('is monotonic in brightness so a higher percentage never looks darker', () => {
    const lum = (p: number) => {
      const [r, g, b] = rampRgb('earth', p)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (let p = 1; p <= 100; p++) expect(lum(p)).toBeGreaterThanOrEqual(lum(p - 1))
  })

  it('uses different hues for Sun and Earth', () => {
    expect(rampRgb('sun', 100)).not.toEqual(rampRgb('earth', 100))
  })

  it('colors a raster as RGBA and leaves no-data pixels transparent', () => {
    const rgba = colorizeRaster(values, 'sun')
    expect(rgba).toHaveLength(values.length * 4)
    const px = (i: number) => Array.from(rgba.slice(i * 4, i * 4 + 4))
    expect(px(0)).toEqual([...rampRgb('sun', 10), 255])
    expect(px(11)[3]).toBe(0)
  })
})

describe('rampCssGradient', () => {
  it('is a CSS linear-gradient from 0 % to 100 % built from the same ramp', () => {
    const css = rampCssGradient('earth')
    expect(css).toMatch(/^linear-gradient\(to right, /)
    const [r, g, b] = rampRgb('earth', 100)
    expect(css).toContain(`rgb(${r}, ${g}, ${b}) 100%`)
  })
})

describe('grayFromRgba', () => {
  it('takes the red channel of each RGBA pixel (the PNGs are 8-bit grayscale, so R = G = B = value)', () => {
    const rgba = Uint8ClampedArray.from([10, 10, 10, 255, 255, 255, 255, 255, 0, 0, 0, 255])
    expect(Array.from(grayFromRgba(rgba))).toEqual([10, 255, 0])
  })
})
