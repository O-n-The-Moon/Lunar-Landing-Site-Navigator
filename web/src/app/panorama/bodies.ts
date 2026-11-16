// Sun / Earth positions for a site, shared by the 2D horizon panorama, the 3D Terrain compass and the Surface view.
// Positions come from the engine; lit / in-view state comes from the same windows the timeline draws (`isIn`), so
// every view agrees with the timeline.
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, type Body, type SiteContext, type Window } from '../../engine'
import type { PanoramaBody } from './horizon-panorama'
import { isIn, type MissionTracks } from './tracks'

/** One body at `tUtcMs`; `visible` is the timeline's rule at that time. Throws RangeError outside the ephemeris. */
export function bodyAt(ctx: SiteContext, body: Body, tUtcMs: number, windows: Window[]): PanoramaBody {
  const { azDeg, elevDeg, distKm } = azEl(ctx.frame, bodyVectorKm(ctx.eph, body, tUtcMs))
  return {
    azDeg,
    elevDeg,
    horizonDeg: horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, azDeg),
    radiusDeg: angularRadiusDeg(body, distKm),
    visible: isIn(windows, tUtcMs),
  }
}

/** One point of a body's mission path as the Surface view draws it. */
export interface SurfaceTrackPoint {
  azDeg: number
  elevDeg: number
  /** Lit / in view by the timeline's rule. */
  on: boolean
  /** Day number (1, 2, …) on the sample that sits `day` × 24 h after landing; null elsewhere. Landing itself is not marked. */
  dayTick: number | null
}

/** The Surface view's track for one body, from `missionTracks` output (the same samples and rule as the 2D panorama). */
export function surfaceTrack(tracks: MissionTracks, body: Body): SurfaceTrackPoint[] {
  const dayAt = new Map(tracks.dayTicks.filter((d) => d.day > 0).map((d) => [d.tUtcMs, d.day]))
  return tracks[body].map((p) => ({ azDeg: p.azDeg, elevDeg: p.elevDeg, on: p.visible, dayTick: dayAt.get(p.tUtcMs) ?? null }))
}
