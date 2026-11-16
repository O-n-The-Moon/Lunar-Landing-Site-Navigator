// South polar stereographic projection for the opportunity map (SPEC-app P0-6). Same convention as the grid and the
// PGDA layers: x = ρ sin(lon), y = ρ cos(lon), ρ = 2R·tan(colatitude / 2), pole at the origin, km on a sphere of radius R.
// Pure functions: no React, no DOM. Degrees at the API, radians inside.

const DEG = Math.PI / 180

/** Distance from the pole of a latitude ring, km. */
export const ringRadiusKm = (sphereRadiusKm: number, latDeg: number): number =>
  2 * sphereRadiusKm * Math.tan(((90 + latDeg) * DEG) / 2)

/** Map position (km from the pole) of a planetocentric lat/lon (east-positive). */
export function latLonToKm(sphereRadiusKm: number, latDeg: number, lonDeg: number): { xKm: number; yKm: number } {
  const rhoKm = ringRadiusKm(sphereRadiusKm, latDeg)
  return { xKm: rhoKm * Math.sin(lonDeg * DEG), yKm: rhoKm * Math.cos(lonDeg * DEG) }
}

/** Inverse of {@link latLonToKm}. Longitude is returned in −180…180 (0 at the pole, where it is undefined). */
export function kmToLatLon(sphereRadiusKm: number, xKm: number, yKm: number): { latDeg: number; lonDeg: number } {
  const rhoKm = Math.hypot(xKm, yKm)
  if (rhoKm === 0) return { latDeg: -90, lonDeg: 0 }
  const colatRad = 2 * Math.atan(rhoKm / (2 * sphereRadiusKm))
  return { latDeg: -90 + colatRad / DEG, lonDeg: Math.atan2(xKm, yKm) / DEG }
}

export interface GridExtentInput {
  originKm: readonly [number, number]
  cellKm: number
  nx: number
  ny: number
}

/** Bounding box of a raster laid out like the grid / PGDA layers, in map km. */
export function gridExtentKm({ originKm, cellKm, nx, ny }: GridExtentInput) {
  return {
    minXKm: originKm[0],
    maxXKm: originKm[0] + nx * cellKm,
    minYKm: originKm[1],
    maxYKm: originKm[1] + ny * cellKm,
  }
}

/** Moon reference sphere (AGENTS.md → Conventions), the radius the PGDA layers and the grid are projected with. */
export const MOON_RADIUS_KM = 1737.4
