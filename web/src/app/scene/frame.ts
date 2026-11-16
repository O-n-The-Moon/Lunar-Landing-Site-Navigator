// Where a raster sits on the polar-stereographic map plane, plus the projection helpers the 3D scene modules use.
// A thin adapter over `map/projection` (whose functions take a sphere radius): the scene passes one `MapFrame` around
// instead of five loose numbers. Display math only; visibility physics stays in the engine.
import { kmToLatLon as kmToLatLonR, latLonToKm as latLonToKmR, ringRadiusKm } from '../map/projection'

export interface MapFrame {
  originKm: readonly [number, number]
  cellKm: number
  nx: number
  ny: number
  sphereRadiusKm: number
}

/** The frame of anything shaped like `grid.json` / `terrain-display.json` (extra manifest fields are ignored). */
export const frameOf = ({ originKm, cellKm, nx, ny, sphereRadiusKm }: MapFrame): MapFrame => ({
  originKm: [originKm[0], originKm[1]],
  cellKm,
  nx,
  ny,
  sphereRadiusKm,
})

/** Polar-stereographic radius of a latitude circle, km. */
export const rhoKm = (f: Pick<MapFrame, 'sphereRadiusKm'>, latDeg: number): number => ringRadiusKm(f.sphereRadiusKm, latDeg)

export const latLonToKm = (f: Pick<MapFrame, 'sphereRadiusKm'>, latDeg: number, lonDeg: number) =>
  latLonToKmR(f.sphereRadiusKm, latDeg, lonDeg)

export const kmToLatLon = (f: Pick<MapFrame, 'sphereRadiusKm'>, xKm: number, yKm: number) => kmToLatLonR(f.sphereRadiusKm, xKm, yKm)

/** Cell under a km point, or null outside the grid. Row-major index `iy · nx + ix` (iy = 0 is the lowest y). */
export function cellAt(f: MapFrame, xKm: number, yKm: number): { ix: number; iy: number; index: number } | null {
  const ix = Math.floor((xKm - f.originKm[0]) / f.cellKm)
  const iy = Math.floor((yKm - f.originKm[1]) / f.cellKm)
  if (ix < 0 || iy < 0 || ix >= f.nx || iy >= f.ny) return null
  return { ix, iy, index: iy * f.nx + ix }
}
