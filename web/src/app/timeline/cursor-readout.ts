// Per-site numbers at the cursor time (SPEC-app P0-4, SPEC-engine "sunElevDeg at cursor"). Evaluated at the exact
// cursor time with the same engine calls the panorama uses, so the two views agree; no physics lives here.
import { azEl, bodyVectorKm, horizonElevAt, type SiteContext } from '../../engine'

export interface CursorReadout {
  /** Geometric Sun elevation above the local horizontal. */
  sunElevDeg: number
  /** Sun elevation minus the terrain horizon at the Sun's azimuth; negative = Sun centre is behind terrain. */
  sunClearanceDeg: number
}

/** Throws the engine's RangeError for a time outside the ephemeris or a mask that doesn't cover 360°. */
export function cursorReadout(ctx: SiteContext, tUtcMs: number): CursorReadout {
  const { azDeg, elevDeg } = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'sun', tUtcMs))
  return { sunElevDeg: elevDeg, sunClearanceDeg: elevDeg - horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, azDeg) }
}
