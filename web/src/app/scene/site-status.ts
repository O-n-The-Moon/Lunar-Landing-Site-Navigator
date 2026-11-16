// What a site's beacon says at the cursor: is the Sun up (power) and is Earth up (direct-to-Earth comms)?
// Both flags come from the same windows the timeline draws, so beacons, timeline and panorama always agree.
import { isIn } from '../panorama/tracks'
import type { SiteRun } from '../use-scenario-results'

export type SiteSignal = 'both' | 'sun' | 'earth' | 'none'

export interface SignalMeta {
  /** Plain-language state (never colour alone). */
  label: string
  /** Beacon colour (CSS hex). */
  color: string
  /** Short state words for the beacon label (no mission-decision wording: the engine only says what is visible). */
  short: string
}

export const SIGNAL_META: Record<SiteSignal, SignalMeta> = {
  both: { label: 'Power and comms', color: '#34d399', short: 'SUN + EARTH' },
  sun: { label: 'Power only', color: '#f6b73c', short: 'SUN ONLY' },
  earth: { label: 'Comms only', color: '#4ea8ff', short: 'EARTH ONLY' },
  none: { label: 'No power, no comms', color: '#ff6b6b', short: 'NO SUN, NO EARTH' },
}

export function siteSignal(sunUp: boolean, earthUp: boolean): SiteSignal {
  return sunUp ? (earthUp ? 'both' : 'sun') : earthUp ? 'earth' : 'none'
}

/** The signal at `tUtcMs` for one site's (slipped) run. */
export function signalAt(run: Pick<SiteRun, 'windows'>, tUtcMs: number): { signal: SiteSignal; sunUp: boolean; earthUp: boolean } {
  const sunUp = isIn(run.windows.sun, tUtcMs)
  const earthUp = isIn(run.windows.earth, tUtcMs)
  return { signal: siteSignal(sunUp, earthUp), sunUp, earthUp }
}
