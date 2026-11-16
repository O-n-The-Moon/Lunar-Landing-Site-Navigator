// One row per scenario site in the bottom deck (SPEC-app → Layout): Sun / Earth / Both % of the slipped mission (the
// same `missionMetrics` the Details table shows), the Sun's change from the baseline, what the Sun does at the cursor,
// and a mini band of the mission. No physics here: every value is the engine's.
import type { Window } from '../../engine'
import { eventTexts } from '../timeline/timeline-strip'
import { splitSiteName, siteLetter } from '../ui/names'
import { useScenario, missionEndMs, slippedLandingMs } from '../state'
import { useScenarioResults, type SiteResult } from '../use-scenario-results'

const MINUS = '−'

/** Whole percent: the deck is a glance, the Details table keeps the decimals. */
export const formatPct = (v: number) => `${Math.round(v)} %`

/** Whole points, rounding half away from zero (so +47.5 and −47.5 mirror each other). */
const roundPoints = (v: number) => Math.sign(v) * Math.round(Math.abs(v))

/** Signed whole percentage points (U+2212 minus); a change that rounds to zero is "±0". */
export function formatPoints(v: number): string {
  const r = roundPoints(v)
  return r === 0 ? '±0' : `${r > 0 ? '+' : MINUS}${Math.abs(r)}`
}

/** The parts of `windows` inside [startMs, endMs], as fractions 0…1 of that range, for the mini band. */
export function bandSegments(windows: readonly Window[], startMs: number, endMs: number): { from: number; to: number }[] {
  const span = endMs - startMs
  return windows
    .filter((w) => w.endMs > startMs && w.startMs < endMs)
    .map((w) => ({ from: (Math.max(w.startMs, startMs) - startMs) / span, to: (Math.min(w.endMs, endMs) - startMs) / span }))
}

const BAND_W = 1000

function MiniBand({ result, startMs, endMs }: { result: SiteResult; startMs: number; endMs: number }) {
  const { windows } = result.slipped
  const rows = [
    { key: 'sun', color: 'var(--sun)', wins: windows.sun },
    { key: 'earth', color: 'var(--earth)', wins: windows.earth },
  ] as const
  return (
    <svg className="srow-band" viewBox={`0 0 ${BAND_W} 22`} preserveAspectRatio="none" role="img" aria-label={`${result.site.name}: Sun and Earth-link windows over the mission`}>
      {rows.map((r, i) => (
        <g key={r.key} transform={`translate(0 ${i * 12})`}>
          <rect width={BAND_W} height={10} fill="var(--surface-3)" />
          {bandSegments(r.wins, startMs, endMs).map((s) => (
            <rect key={s.from} data-band={r.key} x={s.from * BAND_W} width={Math.max(1, (s.to - s.from) * BAND_W)} height={10} fill={r.color} />
          ))}
        </g>
      ))}
    </svg>
  )
}

function Metric({ label, tone, children, delta }: { label: string; tone?: 'sun' | 'earth' | 'both'; children: string; delta?: number }) {
  return (
    <span className={`metric${tone ? ` metric-${tone}` : ''}`}>
      <small>{label}</small>
      <span className="num">{children}</span>
      {delta !== undefined && (
        <span className={`num metric-delta ${roundPoints(delta) < 0 ? 'is-worse' : roundPoints(delta) > 0 ? 'is-better' : ''}`} title="Change from the baseline landing, in percentage points">
          {formatPoints(delta)}
        </span>
      )}
    </span>
  )
}

export function SiteRows() {
  const scenario = useScenario()
  const results = useScenarioResults()
  const { cursorMs } = scenario
  const startMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)
  if (results.siteIds.length === 0) return <p className="hint deck-empty">Add a site to see its numbers.</p>

  return (
    <ul className="deck-sites" aria-label="Site numbers">
      {results.siteIds.map((id, i) => {
        const r = results.sites.find((x) => x.site.id === id)
        const name = splitSiteName(r?.site.name ?? results.unavailable.find((u) => u.id === id)?.name ?? id)
        const head = (
          <span className="srow-id">
            <span className="site-letter" aria-hidden="true">
              {siteLetter(i)}
            </span>
            <span className="srow-name">
              <span className="srow-short">{name.short}</span>
              {name.region && <small>{name.region}</small>}
            </span>
          </span>
        )
        if (!r) {
          const reason = results.unavailable.find((u) => u.id === id)?.reason
          return (
            <li key={id} className="srow is-unavailable">
              {head}
              <span className="hint warn srow-reason">{reason}</span>
            </li>
          )
        }
        const m = r.slipped.metrics
        return (
          <li key={id} className="srow">
            {head}
            <Metric label="Sun" tone="sun" delta={r.delta?.sunlitPct}>
              {formatPct(m.sunlitPct)}
            </Metric>
            <Metric label="Earth" tone="earth">
              {formatPct(m.earthPct)}
            </Metric>
            <Metric label="Both" tone="both">{formatPct(m.bothPct)}</Metric>
            <span className="metric srow-event">
              <small>Sun at cursor</small>
              <span className="num">{eventTexts(r.slipped.windows, cursorMs).sunText}</span>
            </span>
            <MiniBand result={r} startMs={startMs} endMs={endMs} />
          </li>
        )
      })}
    </ul>
  )
}
