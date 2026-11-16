import { describe, expect, it } from 'vitest'
import { rampColor, rampCss, rampRgb, type RampName } from './colormaps'
import { rampCssGradient, rampRgb as pgdaRampRgb } from './pgda-raster'

const RAMPS: RampName[] = ['sun', 'earth', 'both']
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('rampRgb', () => {
  it('returns null for NaN (no data) and a colour for every real percent', () => {
    for (const ramp of RAMPS) {
      expect(rampRgb(ramp, NaN)).toBeNull()
      expect(rampRgb(ramp, 0)).not.toBeNull()
    }
  })

  it('clamps outside 0–100', () => {
    for (const ramp of RAMPS) {
      expect(rampRgb(ramp, -20)).toEqual(rampRgb(ramp, 0))
      expect(rampRgb(ramp, 180)).toEqual(rampRgb(ramp, 100))
    }
  })

  it('gets lighter with the value, and the three ramps differ', () => {
    for (const ramp of RAMPS) {
      const lumas = [0, 25, 50, 75, 100].map((p) => luma(rampColor(ramp, p)))
      for (let i = 1; i < lumas.length; i++) expect(lumas[i]).toBeGreaterThan(lumas[i - 1])
    }
    expect(rampColor('sun', 100)).not.toEqual(rampColor('earth', 100))
    expect(rampColor('both', 100)).not.toEqual(rampColor('earth', 100))
    expect(rampColor('both', 100)).not.toEqual(rampColor('sun', 100))
  })

  it('is the one ramp the 2D map uses (no second sun/earth palette)', () => {
    for (const ramp of ['sun', 'earth'] as const) {
      for (const p of [0, 13, 50, 77, 100]) expect(pgdaRampRgb(ramp, p)).toEqual(rampColor(ramp, p))
      expect(rampCssGradient(ramp)).toBe(rampCss(ramp))
    }
  })
})
