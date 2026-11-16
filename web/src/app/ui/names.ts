// Display helpers for site names and times in the 3D views and the deck. Catalog names carry a parenthesised
// region, e.g. "Haworth (Artemis III region)": labels show the short name large and the region small.

export interface SplitName {
  short: string
  /** The parenthesised suffix, or null. "Artemis III region" is shortened to "Artemis III". */
  region: string | null
}

export function splitSiteName(name: string): SplitName {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name)
  if (!m) return { short: name, region: null }
  return { short: m[1], region: m[2].replace(/\s+region$/i, '') }
}

/** A, B, C… for scenario order. */
export const siteLetter = (index: number) => String.fromCharCode(65 + index)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "20 Feb", UTC. */
export function formatDayShort(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "14:00", UTC. */
export function formatClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16)
}

const HOUR_MS = 3_600_000

/** Mission elapsed time as `L+3d 04h` (negative clamps to L+0d 00h). */
export function formatElapsed(ms: number): string {
  const totalH = Math.max(0, Math.floor(ms / HOUR_MS))
  return `L+${Math.floor(totalH / 24)}d ${String(totalH % 24).padStart(2, '0')}h`
}

/** Top-bar mission clock: `L+2d 00h · 18 Mar 2026 00:00 UTC`. */
export function formatMissionClock(cursorMs: number, missionStartMs: number): string {
  const year = new Date(cursorMs).getUTCFullYear()
  return `${formatElapsed(cursorMs - missionStartMs)} · ${formatDayShort(cursorMs)} ${year} ${formatClock(cursorMs)} UTC`
}
