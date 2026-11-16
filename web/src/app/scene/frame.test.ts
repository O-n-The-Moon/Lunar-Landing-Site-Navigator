import { describe, expect, it } from 'vitest'
import { kmToLatLon as mapKmToLatLon, latLonToKm as mapLatLonToKm, ringRadiusKm } from '../map/projection'
import { cellAt, frameOf, kmToLatLon, latLonToKm, rhoKm, type MapFrame } from './frame'

const frame: MapFrame = { originKm: [-182, -182], cellKm: 2, nx: 182, ny: 182, sphereRadiusKm: 1737.4 }

describe('frame projection helpers', () => {
  it("agree with the map's own projection functions", () => {
    expect(rhoKm(frame, -85)).toBe(ringRadiusKm(1737.4, -85))
    expect(latLonToKm(frame, -87, 30)).toEqual(mapLatLonToKm(1737.4, -87, 30))
    expect(kmToLatLon(frame, 12, -40)).toEqual(mapKmToLatLon(1737.4, 12, -40))
  })

  it('round-trip lat/lon', () => {
    const { xKm, yKm } = latLonToKm(frame, -86.2, -120)
    const back = kmToLatLon(frame, xKm, yKm)
    expect(back.latDeg).toBeCloseTo(-86.2, 9)
    expect(back.lonDeg).toBeCloseTo(-120, 9)
  })
})

describe('frameOf', () => {
  it('keeps only the geometry of a manifest-like object', () => {
    const f = frameOf({ ...frame, azBins: 360, dtype: 'uint8' } as MapFrame)
    expect(Object.keys(f).sort()).toEqual(['cellKm', 'nx', 'ny', 'originKm', 'sphereRadiusKm'])
    expect(f).toEqual(frame)
  })
})

describe('cellAt', () => {
  it('finds the cell under a point with iy = 0 at the lowest y', () => {
    expect(cellAt(frame, -181, -181)).toEqual({ ix: 0, iy: 0, index: 0 })
    expect(cellAt(frame, 1, 3)).toEqual({ ix: 91, iy: 92, index: 92 * 182 + 91 })
  })

  it('returns null outside the square (the upper edge is exclusive)', () => {
    expect(cellAt(frame, -182.01, 0)).toBeNull()
    expect(cellAt(frame, 182, 0)).toBeNull()
    expect(cellAt(frame, 0, 182)).toBeNull()
  })
})
