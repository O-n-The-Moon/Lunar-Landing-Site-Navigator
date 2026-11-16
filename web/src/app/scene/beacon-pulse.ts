// Beacon pulse: when a site's state changes (Sun or Earth link gained or lost), a translucent shell grows from the
// beacon and fades, so the change is seen even while the eye is elsewhere. Pure timing; ops-scene draws it.

export const PULSE_MS = 800
const MAX_SCALE = 4.5
const START_OPACITY = 0.7

/** Shell scale (× the beacon's radius) and opacity `elapsedMs` after the change; null before it and once it is over. */
export function pulseAt(elapsedMs: number): { scale: number; opacity: number } | null {
  if (elapsedMs < 0 || elapsedMs >= PULSE_MS) return null
  const k = elapsedMs / PULSE_MS
  const out = 1 - (1 - k) * (1 - k) // ease-out: fast at first, settles
  return { scale: 1 + (MAX_SCALE - 1) * out, opacity: START_OPACITY * (1 - k) }
}
