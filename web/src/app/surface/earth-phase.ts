// Earth as seen from the Moon: how much of its disk is lit and which way the bright limb points. Pure math on
// MOON_ME vectors (km) from `bodyVectorKm`, plus the sky-plane angle of the bright limb for drawing.
import type { Vec3 } from '../../engine'

const DEG = Math.PI / 180

/**
 * Illuminated fraction (0 = new, 1 = full Earth) of Earth's disk seen from the Moon's centre: the phase angle α is
 * the angle at Earth between the directions to the Sun and to the Moon; fraction = (1 + cos α) / 2. At new Moon the
 * Sun is behind the Moon as seen from Earth, so Earth looks full from the Moon.
 */
export function earthIlluminatedFraction(sunKm: Vec3, earthKm: Vec3): number {
  const toSun: Vec3 = [sunKm[0] - earthKm[0], sunKm[1] - earthKm[1], sunKm[2] - earthKm[2]]
  const toMoon: Vec3 = [-earthKm[0], -earthKm[1], -earthKm[2]]
  const dot = toSun[0] * toMoon[0] + toSun[1] * toMoon[1] + toSun[2] * toMoon[2]
  const cos = dot / (Math.hypot(...toSun) * Math.hypot(...toMoon))
  return (1 + Math.max(-1, Math.min(1, cos))) / 2
}

/**
 * Angle (radians, counter-clockwise from +x = to the right, +y = up) of the direction from Earth to the Sun on the
 * sky plane, i.e. where the bright limb sits on the disk. Azimuth differences are scaled by cos(elevation) and wrapped.
 */
export function brightLimbAngleRad(sun: { azDeg: number; elevDeg: number }, earth: { azDeg: number; elevDeg: number }): number {
  let dAz = sun.azDeg - earth.azDeg
  dAz -= 360 * Math.round(dAz / 360)
  const east = dAz * Math.cos(earth.elevDeg * DEG)
  const up = sun.elevDeg - earth.elevDeg
  return Math.atan2(up, east)
}
