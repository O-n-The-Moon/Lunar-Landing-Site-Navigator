// 3D world coordinates for the terrain scene (display math only; visibility physics stays in the engine).
// Units are km. The pole is the origin and +Y is "up" out of the pole: world = (Ym, −Zm − R, −Xm) for a MOON_ME
// position (Xm, Ym, Zm). So 90°E is +X, 0°E is −Z (the top of the 2D polar map seen from above) and the sphere falls
// away below the pole, as it really does (≈ 9.5 km at 182 km), which is as large as the relief.
import { MOON_RADIUS_KM, type Vec3 } from '../../engine'

const DEG = Math.PI / 180

/** MOON_ME position (km) → world position. */
export function moonToWorld(p: Vec3, radiusKm = MOON_RADIUS_KM): Vec3 {
  return [p[1], -p[2] - radiusKm, -p[0]]
}

/** MOON_ME direction → world direction (no origin shift), normalized. */
export function directionToWorld(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[1] / n, -v[2] / n, -v[0] / n]
}

/** World position of a surface point: on the sphere of radius R + `heightKm` along its radial. */
export function surfaceWorld(latDeg: number, lonDeg: number, heightKm: number, radiusKm = MOON_RADIUS_KM): Vec3 {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const r = radiusKm + heightKm
  return moonToWorld([r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)], radiusKm)
}

/** Inverse of `surfaceWorld` for the latitude/longitude (the height is not needed to find the radial). */
export function worldToLatLon(p: Vec3, radiusKm = MOON_RADIUS_KM): { latDeg: number; lonDeg: number } {
  const x = -p[2]
  const y = p[0]
  const z = -(p[1] + radiusKm)
  return { latDeg: Math.atan2(z, Math.hypot(x, y)) / DEG, lonDeg: Math.atan2(y, x) / DEG }
}
