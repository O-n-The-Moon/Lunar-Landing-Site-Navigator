import { describe, expect, it } from 'vitest'
import { gridExtentKm, kmToLatLon, latLonToKm, ringRadiusKm } from './projection'

const R = 1737.4

describe('latLonToKm (south polar stereographic, x = ρ sin lon, y = ρ cos lon)', () => {
  it('puts the pole at the origin', () => {
    const { xKm, yKm } = latLonToKm(R, -90, 0)
    expect(xKm).toBeCloseTo(0, 9)
    expect(yKm).toBeCloseTo(0, 9)
  })

  it('puts lon 0 on +y and lon 90°E on +x', () => {
    const rho = ringRadiusKm(R, -85)
    const north = latLonToKm(R, -85, 0)
    const east = latLonToKm(R, -85, 90)
    expect(north.xKm).toBeCloseTo(0, 9)
    expect(north.yKm).toBeCloseTo(rho, 9)
    expect(east.xKm).toBeCloseTo(rho, 9)
    expect(east.yKm).toBeCloseTo(0, 9)
  })

  it('ring radius is ρ = 2R·tan(colat/2): 85°S is ≈ 152 km, 88°S ≈ 60.7 km on a 1737.4 km sphere', () => {
    expect(ringRadiusKm(R, -85)).toBeCloseTo(2 * R * Math.tan((5 * Math.PI) / 360), 9)
    expect(ringRadiusKm(R, -85)).toBeGreaterThan(151)
    expect(ringRadiusKm(R, -85)).toBeLessThan(153)
    expect(ringRadiusKm(R, -88)).toBeCloseTo(60.7, 0)
  })
})

describe('kmToLatLon (inverse)', () => {
  it('round-trips lat/lon across the polar cap, including the ±180° seam', () => {
    for (const lat of [-89.9, -88, -85.5, -84.2]) {
      for (const lon of [-180, -135, -90, -45, -0.5, 0, 30.4, 90, 179.9]) {
        const { xKm, yKm } = latLonToKm(R, lat, lon)
        const back = kmToLatLon(R, xKm, yKm)
        expect(back.latDeg).toBeCloseTo(lat, 8)
        // ±180 are the same meridian
        const dLon = Math.abs(((back.lonDeg - lon + 540) % 360) - 180)
        expect(dLon).toBeLessThan(1e-7)
      }
    }
  })

  it('returns lon 0 at the pole itself and lon in −180…180', () => {
    expect(kmToLatLon(R, 0, 0)).toEqual({ latDeg: -90, lonDeg: 0 })
    const { lonDeg } = kmToLatLon(R, -50, -50)
    expect(lonDeg).toBeGreaterThanOrEqual(-180)
    expect(lonDeg).toBeLessThanOrEqual(180)
    expect(lonDeg).toBeCloseTo(-135, 9)
  })
})

describe('gridExtentKm', () => {
  it('is the box from originKm to originKm + n·cellKm', () => {
    expect(gridExtentKm({ originKm: [-182, -182], cellKm: 2, nx: 182, ny: 182 })).toEqual({
      minXKm: -182,
      maxXKm: 182,
      minYKm: -182,
      maxYKm: 182,
    })
  })
})
