// Sun / Earth positions for a site, shared by the 2D horizon panorama, the 3D Terrain compass and the Surface view.
// Positions come from the engine; lit / in-view state comes from the same windows the timeline draws (`isIn`), so
// every view agrees with the timeline.
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, type Body, type SiteContext, type Window } from '../../engine'
import type { PanoramaBody } from './horizon-panorama'
import { isIn } from './tracks'

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
