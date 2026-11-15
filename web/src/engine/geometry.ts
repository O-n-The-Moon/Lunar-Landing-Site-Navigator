// Geometry: body vectors, site frames, az/el, horizon lookup, disk visibility.
import type { AzEl, Body, Ephemeris, SiteFrame, Vec3 } from './types'

export const MOON_RADIUS_KM = 1737.4
export const SUN_RADIUS_KM = 695_700
export const EARTH_RADIUS_KM = 6_371
/** Azimuth "north" is undefined at exactly −90°. */
export const MAX_ABS_LAT_DEG = 89.999

const DEG = Math.PI / 180

/** Body position relative to the Moon's center (MOON_ME, km), linearly interpolated between hourly samples. Throws RangeError outside coverage. */
export function bodyVectorKm(eph: Ephemeris, body: Body, tUtcMs: number): Vec3 {
  const x = (tUtcMs - eph.startUtcMs) / eph.stepMs
  if (!(x >= 0 && x <= eph.count - 1)) {
    throw new RangeError(`tUtcMs ${tUtcMs} is outside the ephemeris coverage`)
  }
  const b = eph.bodies.indexOf(body)
  if (b < 0) throw new RangeError(`body ${body} is not in the ephemeris`)
  const stride = eph.bodies.length * 3
  // At the last sample, interpolate from the previous one with f = 1 (count ≥ 2 by contract).
  const i = Math.max(0, Math.min(Math.floor(x), eph.count - 2))
  const f = x - i
  const p = eph.positionsKm
  const o0 = i * stride + b * 3
  const o1 = eph.count > 1 ? o0 + stride : o0
  return [p[o0] + (p[o1] - p[o0]) * f, p[o0 + 1] + (p[o1 + 1] - p[o0 + 1]) * f, p[o0 + 2] + (p[o1 + 2] - p[o0 + 2]) * f]
}

/** Observer position (sphere + surface height + observer height) and local ENU basis. Latitude is clamped to ±89.999°. */
export function siteFrame(latDeg: number, lonDeg: number, surfaceHeightM: number, observerHeightM: number): SiteFrame {
  const lat = Math.max(-MAX_ABS_LAT_DEG, Math.min(MAX_ABS_LAT_DEG, latDeg))
  const [sinLat, cosLat] = [Math.sin(lat * DEG), Math.cos(lat * DEG)]
  const [sinLon, cosLon] = [Math.sin(lonDeg * DEG), Math.cos(lonDeg * DEG)]
  const rKm = MOON_RADIUS_KM + (surfaceHeightM + observerHeightM) / 1000
  const up: Vec3 = [cosLat * cosLon, cosLat * sinLon, sinLat]
  return {
    latDeg: lat,
    lonDeg,
    positionKm: [up[0] * rKm, up[1] * rKm, up[2] * rKm],
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up,
  }
}

/** Topocentric az/el of a body: direction = body − site. Azimuth clockwise from north in [0, 360). */
export function azEl(site: SiteFrame, bodyVecKm: Vec3): AzEl {
  const v0 = bodyVecKm[0] - site.positionKm[0]
  const v1 = bodyVecKm[1] - site.positionKm[1]
  const v2 = bodyVecKm[2] - site.positionKm[2]
  const e = v0 * site.east[0] + v1 * site.east[1] + v2 * site.east[2]
  const n = v0 * site.north[0] + v1 * site.north[1] + v2 * site.north[2]
  const u = v0 * site.up[0] + v1 * site.up[1] + v2 * site.up[2]
  const horiz = Math.hypot(e, n)
  let azDeg = Math.atan2(e, n) / DEG
  if (azDeg < 0) azDeg += 360
  if (azDeg >= 360) azDeg -= 360
  return { azDeg, elevDeg: Math.atan2(u, horiz) / DEG, distKm: Math.hypot(horiz, u) }
}

/** Terrain horizon elevation at an azimuth, linear between bins, wrapping at 360°. */
export function horizonElevAt(maskDeg: ArrayLike<number>, azStepDeg: number, azDeg: number): number {
  const n = maskDeg.length
  const x = ((((azDeg % 360) + 360) % 360) / azStepDeg) % n
  const i0 = Math.floor(x)
  const f = x - i0
  const i1 = i0 + 1 === n ? 0 : i0 + 1
  return maskDeg[i0] + (maskDeg[i1] - maskDeg[i0]) * f
}

/** Apparent angular radius of the Sun or Earth at a distance: asin(R / d). */
export function angularRadiusDeg(body: Body, distKm: number): number {
  const rKm = body === 'sun' ? SUN_RADIUS_KM : EARTH_RADIUS_KM
  return Math.asin(Math.min(1, rKm / distKm)) / DEG
}

/**
 * Fraction (0–1) of a disk above a horizon line, by the circular-segment formula:
 * d = (center − horizon) / radius, clamped to [−1, 1]; f = 1 − (acos d − d·√(1 − d²)) / π.
 * Radius 0 is a point (1 if the center is at or above the horizon, else 0).
 */
export function visibleDiskFraction(centerElevDeg: number, horizonElevDeg: number, radiusDeg: number): number {
  const diff = centerElevDeg - horizonElevDeg
  if (!(radiusDeg > 0)) return diff >= 0 ? 1 : 0
  const d = Math.max(-1, Math.min(1, diff / radiusDeg))
  if (d === 1) return 1
  if (d === -1) return 0
  return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI
}
