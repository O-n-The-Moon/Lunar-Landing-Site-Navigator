import { describe, expect, it } from 'vitest'
import { rampRgb } from '../map/colormaps'
import { illuminationToRgba, percentToRgba, sameSquare } from './overlay-textures'

describe('percentToRgba', () => {
  it('uses the shared colour ramp and makes NaN transparent', () => {
    const px = percentToRgba([0, 50, 100, NaN], 'sun')
    expect(px).toHaveLength(16)
    expect(Array.from(px.slice(4, 8))).toEqual([...(rampRgb('sun', 50) ?? []), 255])
    expect(Array.from(px.slice(8, 12))).toEqual([...(rampRgb('sun', 100) ?? []), 255])
    expect(Array.from(px.slice(12, 16))).toEqual([0, 0, 0, 0])
  })

  it('applies the requested alpha to data pixels only', () => {
    const px = percentToRgba([10, NaN], 'earth', 180)
    expect(px[3]).toBe(180)
    expect(px[7]).toBe(0)
  })
})

describe('illuminationToRgba', () => {
  it('encodes the Sun fraction in red, clamps, and reads NaN as shadow', () => {
    const px = illuminationToRgba(Float32Array.from([0, 0.5, 1, 1.2, -0.1, NaN]))
    expect(Array.from(px).filter((_, i) => i % 4 === 0)).toEqual([0, 128, 255, 255, 0, 0])
    expect(Array.from(px).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255, 255, 255])
  })
})

describe('sameSquare', () => {
  const a = { originKm: [-182, -182] as const, cellKm: 2, nx: 182, ny: 182 }
  it('accepts the same extent at a different resolution and rejects a shifted or smaller one', () => {
    expect(sameSquare(a, { originKm: [-182, -182], cellKm: 364 / 1024, nx: 1024, ny: 1024 })).toBe(true)
    expect(sameSquare(a, { originKm: [-180, -182], cellKm: 2, nx: 182, ny: 182 })).toBe(false)
    expect(sameSquare(a, { originKm: [-182, -182], cellKm: 2, nx: 100, ny: 182 })).toBe(false)
  })
})
