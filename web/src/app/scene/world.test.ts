import { describe, expect, it } from 'vitest'
import { MOON_RADIUS_KM } from '../../engine'
import { directionToWorld, moonToWorld, surfaceWorld, worldToLatLon } from './world'

describe('world coordinates', () => {
  it('puts the pole at the origin with +Y up', () => {
    const [x, y, z] = surfaceWorld(-90, 0, 0)
    expect(Math.hypot(x, y, z)).toBeLessThan(1e-9)
    expect(surfaceWorld(-90, 0, 2)[1]).toBeCloseTo(2, 9) // 2 km of terrain is 2 km up
  })

  it('maps 0°E to −Z and 90°E to +X, as on the 2D polar map', () => {
    const [x0, , z0] = surfaceWorld(-85, 0, 0)
    expect(x0).toBeCloseTo(0, 9)
    expect(z0).toBeLessThan(-100)
    const [x90, , z90] = surfaceWorld(-85, 90, 0)
    expect(x90).toBeGreaterThan(100)
    expect(z90).toBeCloseTo(0, 9)
    expect(surfaceWorld(-85, 180, 0)[2]).toBeGreaterThan(100)
    expect(surfaceWorld(-85, -90, 0)[0]).toBeLessThan(-100)
  })

  it('lets the sphere fall away from the pole (≈ R(1 − cos colat))', () => {
    const colat = 5 * (Math.PI / 180)
    expect(surfaceWorld(-85, 30, 0)[1]).toBeCloseTo(-MOON_RADIUS_KM * (1 - Math.cos(colat)), 6)
  })

  it('round-trips latitude and longitude', () => {
    for (const [lat, lon] of [
      [-89.3, 45],
      [-86, -120],
      [-84.2, 179],
    ]) {
      const back = worldToLatLon(surfaceWorld(lat, lon, 1.5))
      expect(back.latDeg).toBeCloseTo(lat, 9)
      expect(back.lonDeg).toBeCloseTo(lon, 9)
    }
  })

  it('maps directions without the origin shift and normalizes them', () => {
    const [x, y, z] = directionToWorld([3, 0, 0]) // +X MOON_ME is 0°E: −Z in the world
    expect([x, y, z]).toEqual([0, -0, -1])
    const sun = directionToWorld([1e8, -2e7, -1e6])
    expect(Math.hypot(...sun)).toBeCloseTo(1, 12)
  })

  it('moonToWorld agrees with surfaceWorld', () => {
    const lat = (-87 * Math.PI) / 180
    const lon = (20 * Math.PI) / 180
    const r = MOON_RADIUS_KM + 0.5
    const a = moonToWorld([r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)])
    const b = surfaceWorld(-87, 20, 0.5)
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 9)
  })
})
