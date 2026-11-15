// Metric cards (SPEC-app P0-3): one column per site, slipped-mission values with a Δ vs. the unslipped baseline.
import type { MetricDelta, MissionMetrics } from '../../engine'
import { formatUtc } from '../controls/date-controls'
import { formatSlipH } from '../controls/slip-slider'
import {
  formatLatDeg,
  formatLonDeg,
  type ResolvedSite,
  type ScenarioResults,
  type SiteResult,
  type UnavailableSite,
} from '../use-scenario-results'
import './metric-cards.css'

/** Slopes above this are flagged (SPEC-app P0-3). */
export const STEEP_SLOPE_DEG = 10

type Tone = 'better' | 'worse' | 'neutral'
interface DeltaView {
  text: string
  tone: Tone
}

interface MetricRow {
  label: string
  value: (m: MissionMetrics) => string
  /** a = baseline, b = slipped, d = diffMetrics(a, b). */
  delta: (d: MetricDelta, a: MissionMetrics, b: MissionMetrics) => DeltaView
}

const MINUS = '−'
const pct = (v: number) => `${v.toFixed(1)} %`
const hours = (v: number) => `${v.toFixed(1)} h`

/** Signed Δ at display precision; one that rounds to zero is neutral. `higherIsBetter` sets the color. */
function numDelta(v: number, digits: number, unit: string, higherIsBetter: boolean): DeltaView {
  const abs = Math.abs(v).toFixed(digits)
  if (Number(abs) === 0) return { text: `±${abs}${unit}`, tone: 'neutral' }
  const up = v > 0
  return { text: `${up ? '+' : MINUS}${abs}${unit}`, tone: up === higherIsBetter ? 'better' : 'worse' }
}

/**
 * A "first sunset / Earthset" outcome. The engine's null means "no on→off transition", which covers both a body
 * that never comes up and one that never sets, so the on-time percentage tells them apart.
 */
type EventState = { kind: 'never-up' } | { kind: 'sets'; h: number } | { kind: 'never-sets' }
const eventState = (onPct: number, firstOffH: number | null): EventState =>
  onPct === 0 ? { kind: 'never-up' } : firstOffH === null ? { kind: 'never-sets' } : { kind: 'sets', h: firstOffH }
/** Worst to best: never up, sets (later is better), never sets. */
const EVENT_RANK = { 'never-up': 0, sets: 1, 'never-sets': 2 } as const

interface EventWords {
  neverUp: string
  nowUp: string
  neverSets: string
}
const SUN_WORDS: EventWords = { neverUp: 'Never sunlit', nowUp: 'now sunlit', neverSets: 'No sunset' }
const EARTH_WORDS: EventWords = { neverUp: 'Never in view', nowUp: 'now in view', neverSets: 'No Earthset' }

function eventValue(s: EventState, w: EventWords): string {
  return s.kind === 'sets' ? hours(s.h) : s.kind === 'never-up' ? w.neverUp : w.neverSets
}

function eventDelta(a: EventState, b: EventState, w: EventWords): DeltaView {
  if (a.kind === 'sets' && b.kind === 'sets') return numDelta(b.h - a.h, 1, ' h', true)
  if (a.kind === b.kind) return { text: 'no change', tone: 'neutral' }
  const tone = EVENT_RANK[b.kind] > EVENT_RANK[a.kind] ? 'better' : 'worse'
  const text =
    b.kind === 'never-up' ? w.neverUp.toLowerCase() : b.kind === 'never-sets' ? 'no longer sets' : a.kind === 'never-up' ? w.nowUp : 'now sets'
  return { text, tone }
}

const sunEvent = (m: MissionMetrics) => eventState(m.sunlitPct, m.firstSunsetH)
const earthEvent = (m: MissionMetrics) => eventState(m.earthPct, m.firstEarthsetH)

const ROWS: MetricRow[] = [
  { label: 'Sunlit', value: (m) => pct(m.sunlitPct), delta: (d) => numDelta(d.sunlitPct, 1, ' pp', true) },
  { label: 'Earth link', value: (m) => pct(m.earthPct), delta: (d) => numDelta(d.earthPct, 1, ' pp', true) },
  { label: 'Both (Sun + Earth)', value: (m) => pct(m.bothPct), delta: (d) => numDelta(d.bothPct, 1, ' pp', true) },
  { label: 'Longest Sun gap', value: (m) => hours(m.longestSunGapH), delta: (d) => numDelta(d.longestSunGapH, 1, ' h', false) },
  {
    label: 'Longest Earth gap',
    value: (m) => hours(m.longestEarthGapH),
    delta: (d) => numDelta(d.longestEarthGapH, 1, ' h', false),
  },
  {
    label: 'First sunset after landing',
    value: (m) => eventValue(sunEvent(m), SUN_WORDS),
    delta: (_d, a, b) => eventDelta(sunEvent(a), sunEvent(b), SUN_WORDS),
  },
  {
    label: 'First Earthset after landing',
    value: (m) => eventValue(earthEvent(m), EARTH_WORDS),
    delta: (_d, a, b) => eventDelta(earthEvent(a), earthEvent(b), EARTH_WORDS),
  },
  {
    label: 'Mean Sun fraction',
    value: (m) => m.meanSunFraction.toFixed(2),
    delta: (d) => numDelta(d.meanSunFraction, 2, '', true),
  },
]

function Delta({ view }: { view: DeltaView }) {
  return (
    <span className={`delta ${view.tone}`}>
      {view.text}
      {view.tone !== 'neutral' && <span className="visually-hidden"> ({view.tone} than baseline)</span>}
    </span>
  )
}

function Slope({ slopeDeg }: { slopeDeg: number | null }) {
  if (slopeDeg === null) return <span title="Custom sites have no slope (grid terrain only)">—</span>
  if (slopeDeg <= STEEP_SLOPE_DEG) return <>{slopeDeg.toFixed(1)}°</>
  return (
    <span className="steep">
      {slopeDeg.toFixed(1)}° <span className="steep-tag">over {STEEP_SLOPE_DEG}°</span>
    </span>
  )
}

function SiteHeader({ site }: { site: ResolvedSite }) {
  return (
    <th scope="col">
      <span className="metric-site-name">{site.name}</span>
      <span className="num muted">
        {formatLatDeg(site.latDeg)} {formatLonDeg(site.lonDeg)}
      </span>
      <span className="num muted">
        observer {site.observerHeightM} m{site.snapDistKm !== null && ` · snapped ${site.snapDistKm.toFixed(1)} km`}
      </span>
    </th>
  )
}

type Column = { kind: 'site'; result: SiteResult } | { kind: 'unavailable'; site: UnavailableSite }

/** Columns in scenario order (`siteIds`), so a site doesn't move when it drops in or out of coverage. */
function columns({ siteIds, sites, unavailable }: ScenarioResults): Column[] {
  return siteIds.flatMap((id): Column[] => {
    const result = sites.find((x) => x.site.id === id)
    if (result) return [{ kind: 'site', result }]
    const site = unavailable.find((x) => x.id === id)
    return site ? [{ kind: 'unavailable', site }] : []
  })
}

export function MetricCards({ results }: { results: ScenarioResults }) {
  const { opts, durationH, baselineLandingMs, slippedLandingMs } = results
  const cols = columns(results)
  if (cols.length === 0) return <p className="hint">Add a site to compare.</p>
  const slipH = (slippedLandingMs - baselineLandingMs) / 3_600_000
  const slipped = slipH !== 0
  const colId = (c: Column) => (c.kind === 'site' ? c.result.site.id : c.site.id)

  return (
    <div className="metric-cards">
      <div className="metric-table-wrap">
        <table className="metric-table">
          <caption>
            Mission metrics · {durationH / 24} d from <span className="num">{formatUtc(slippedLandingMs)}</span>
            {slipped && (
              <>
                {' '}
                (slip <span className="num">{formatSlipH(slipH)}</span>; Δ vs. unslipped baseline)
              </>
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Metric</span>
              </th>
              {cols.map((c) =>
                c.kind === 'site' ? (
                  <SiteHeader key={colId(c)} site={c.result.site} />
                ) : (
                  <th key={colId(c)} scope="col">
                    <span className="metric-site-name">{c.site.name}</span>
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {cols.map((c) =>
                  c.kind === 'site' ? (
                    <td key={colId(c)} className="num">
                      {row.value(c.result.slipped.metrics)}
                      {c.result.delta && (
                        <Delta view={row.delta(c.result.delta, c.result.baseline.metrics, c.result.slipped.metrics)} />
                      )}
                    </td>
                  ) : (
                    <td key={colId(c)} className={i === 0 ? 'metric-unavailable' : 'muted'}>
                      {i === 0 ? `No data: ${c.site.reason}` : '—'}
                    </td>
                  ),
                )}
              </tr>
            ))}
            <tr>
              <th scope="row">Slope</th>
              {cols.map((c) =>
                c.kind === 'site' ? (
                  <td key={colId(c)} className="num">
                    <Slope slopeDeg={c.result.site.slopeDeg} />
                  </td>
                ) : (
                  <td key={colId(c)} className="muted">
                    —
                  </td>
                ),
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">
        Sunlit: at least {Math.round(opts.sunThreshold * 100)} % of the Sun disk above the terrain horizon. Earth link:
        geometric DTE, Earth center at least {opts.earthMarginDeg.toFixed(1)}° above the terrain horizon. Terrain: LOLA
        horizon masks at each column&apos;s observer height. Times are hours after landing.
      </p>
    </div>
  )
}
