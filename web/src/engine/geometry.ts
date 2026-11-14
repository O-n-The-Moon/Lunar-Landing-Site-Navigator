// Geometry: body vectors, site frames, az/el, horizon lookup, disk visibility. Implemented by T8.
import type { AzEl, Body, Ephemeris, SiteFrame, Vec3 } from './types'
import { notImplemented } from './types'

export const MOON_RADIUS_KM = 1737.4
export const SUN_RADIUS_KM = 695_700
export const EARTH_RADIUS_KM = 6_371
/** Azimuth "north" is undefined at exactly −90°. */
export const MAX_ABS_LAT_DEG = 89.999

/** Body position relative to the Moon's center (MOON_ME, km), linearly interpolated between hourly samples. */
export function bodyVectorKm(eph: Ephemeris, body: Body, tUtcMs: number): Vec3 {
  return notImplemented('bodyVectorKm', eph, body, tUtcMs)
}

/** Observer position (sphere + surface height + observer height) and local ENU basis. Latitude is clamped to ±89.999°. */
export function siteFrame(latDeg: number, lonDeg: number, surfaceHeightM: number, observerHeightM: number): SiteFrame {
  return notImplemented('siteFrame', latDeg, lonDeg, surfaceHeightM, observerHeightM)
}

/** Topocentric az/el of a body: direction = body − site. */
export function azEl(site: SiteFrame, bodyVecKm: Vec3): AzEl {
  return notImplemented('azEl', site, bodyVecKm)
}

/** Terrain horizon elevation at an azimuth, linear between bins, wrapping at 360°. */
export function horizonElevAt(maskDeg: ArrayLike<number>, azStepDeg: number, azDeg: number): number {
  return notImplemented('horizonElevAt', maskDeg, azStepDeg, azDeg)
}

/** Apparent angular radius of the Sun or Earth at a distance. */
export function angularRadiusDeg(body: Body, distKm: number): number {
  return notImplemented('angularRadiusDeg', body, distKm)
}

/** Fraction (0–1) of a disk above a horizon line, by the circular-segment formula. */
export function visibleDiskFraction(centerElevDeg: number, horizonElevDeg: number, radiusDeg: number): number {
  return notImplemented('visibleDiskFraction', centerElevDeg, horizonElevDeg, radiusDeg)
}
