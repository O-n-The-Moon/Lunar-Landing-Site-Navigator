import { describe, expect, it } from 'vitest'
import { brightLimbAngleRad, earthIlluminatedFraction } from './earth-phase'

const AU = 149_600_000
const EARTH = 384_400

describe('earthIlluminatedFraction', () => {
  it('is full when the Moon is between Earth and the Sun (new Moon): the Sun is behind us', () => {
    expect(earthIlluminatedFraction([AU, 0, 0], [-EARTH, 0, 0])).toBeGreaterThan(0.999)
  })

  it('is new when the Earth lies between the Moon and the Sun (full Moon): we see the night side', () => {
    expect(earthIlluminatedFraction([AU, 0, 0], [EARTH, 0, 0])).toBeLessThan(0.001)
  })

  it('is a half disk at quarter phase', () => {
    expect(earthIlluminatedFraction([AU, 0, 0], [0, EARTH, 0])).toBeCloseTo(0.5, 2)
  })
})

describe('brightLimbAngleRad', () => {
  it('points the limb toward the Sun on the sky plane', () => {
    const earth = { azDeg: 100, elevDeg: 2 }
    expect(brightLimbAngleRad({ azDeg: 130, elevDeg: 2 }, earth)).toBeCloseTo(0, 6) // Sun to the right
    expect(brightLimbAngleRad({ azDeg: 70, elevDeg: 2 }, earth)).toBeCloseTo(Math.PI, 6) // to the left
    expect(brightLimbAngleRad({ azDeg: 100, elevDeg: 5 }, earth)).toBeCloseTo(Math.PI / 2, 6) // above
  })

  it('wraps azimuth across north', () => {
    expect(brightLimbAngleRad({ azDeg: 5, elevDeg: 0 }, { azDeg: 355, elevDeg: 0 })).toBeCloseTo(0, 6)
  })
})
