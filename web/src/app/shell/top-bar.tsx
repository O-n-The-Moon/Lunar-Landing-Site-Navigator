// Console top bar (SPEC-app → Layout): brand, view tabs, mission clock, data-source chip.
// Rendered before the data loads too (brand + status only), so the page never jumps when the console appears.
import type { ReactNode } from 'react'
import { useCoreDataState } from '../data'
import { slippedLandingMs, useScenario } from '../state'
import { formatMissionClock } from '../ui/names'

/** `start`: before the brand (narrow-screen menu). `children`: the view tabs. `end`: before the data chip (clock). */
export function TopBar({ start, children, end }: { start?: ReactNode; children?: ReactNode; end?: ReactNode }) {
  const { core, kind, fallbackReason } = useCoreDataState()
  return (
    <header className="topbar">
      {start}
      <h1 className="brand">Lunar Landing Site Navigator</h1>
      {children}
      <span className="topbar-spacer" />
      {end}
      {kind === 'fixtures' ? (
        <p className="chip chip-warn data-chip" title={fallbackReason ?? undefined}>
          Synthetic fixture data, not real lunar data
          {fallbackReason && <span className="muted"> ({fallbackReason})</span>}
        </p>
      ) : (
        core.status === 'ready' && (
          <p className="chip data-chip" title="Terrain horizons from the LOLA DEM; Sun and Earth positions from the SPICE ephemeris">
            LOLA terrain · SPICE ephemeris
          </p>
        )
      )}
    </header>
  )
}

/** Mission elapsed time and UTC at the shared time cursor. */
export function MissionClock() {
  const scenario = useScenario()
  const { cursorMs } = scenario
  return (
    <time className="mission-clock num" dateTime={new Date(cursorMs).toISOString()} title="Time cursor: mission elapsed time and UTC">
      {formatMissionClock(cursorMs, slippedLandingMs(scenario))}
    </time>
  )
}
