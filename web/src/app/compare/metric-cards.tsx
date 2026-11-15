// Metric cards (SPEC-app P0-3): one column per site, slipped-mission values with a Δ vs. the unslipped baseline.
import type { EventDelta, MetricDelta, MissionMetrics } from '../../engine'
import { formatUtc } from '../controls/date-controls'
import { formatLatDeg, formatLonDeg, type ResolvedSite, type ScenarioResults } from '../use-scenario-results'
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
  delta: (d: MetricDelta) => DeltaView
}

const MINUS = '−'
const pct = (v: number) => `${v.toFixed(1)} %`
const hours = (v: number | null) => (v === null ? 'None' : `${v.toFixed(1)} h`)

/** Signed Δ at display precision; one that rounds to zero is neutral. `higherIsBetter` sets the color. */
function numDelta(v: number, digits: number, unit: string, higherIsBetter: boolean): DeltaView {
  const abs = Math.abs(v).toFixed(digits)
  if (Number(abs) === 0) return { text: `±${abs}${unit}`, tone: 'neutral' }
  const up = v > 0
  return { text: `${up ? '+' : MINUS}${abs}${unit}`, tone: up === higherIsBetter ? 'better' : 'worse' }
}

/** Δ of a "first sunset / Earthset" time: later (or never) is better. */
function eventDelta(d: EventDelta): DeltaView {
  switch (d.change) {
    case 'shifted':
      return numDelta(d.deltaH ?? 0, 1, ' h', true)
    case 'appeared':
      return { text: 'now sets', tone: 'worse' }
    case 'disappeared':
      return { text: 'no longer sets', tone: 'better' }
    case 'none':
      return { text: 'no change', tone: 'neutral' }
  }
}

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
    value: (m) => (m.sunlitPct === 0 ? 'Never sunlit' : hours(m.firstSunsetH)),
    delta: (d) => eventDelta(d.firstSunsetH),
  },
  {
    label: 'First Earthset after landing',
    value: (m) => (m.earthPct === 0 ? 'Never in view' : hours(m.firstEarthsetH)),
    delta: (d) => eventDelta(d.firstEarthsetH),
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

const signedH = (h: number) => `${h >= 0 ? '+' : MINUS}${Math.abs(h)} h`

export function MetricCards({ results }: { results: ScenarioResults }) {
  const { sites, unavailable, opts, durationH, baselineLandingMs, slippedLandingMs } = results
  if (sites.length === 0 && unavailable.length === 0) return <p className="hint">Add a site to compare.</p>
  const slipH = (slippedLandingMs - baselineLandingMs) / 3_600_000
  const slipped = slipH !== 0

  return (
    <div className="metric-cards">
      <div className="metric-table-wrap">
        <table className="metric-table">
          <caption>
            Mission metrics · {durationH / 24} d from <span className="num">{formatUtc(slippedLandingMs)}</span>
            {slipped && (
              <>
                {' '}
                (slip <span className="num">{signedH(slipH)}</span>; Δ vs. unslipped baseline)
              </>
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Metric</span>
              </th>
              {sites.map((x) => (
                <SiteHeader key={x.site.id} site={x.site} />
              ))}
              {unavailable.map((x) => (
                <th key={x.id} scope="col">
                  <span className="metric-site-name">{x.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {sites.map((x) => (
                  <td key={x.site.id} className="num">
                    {row.value(x.slipped.metrics)}
                    {x.delta && <Delta view={row.delta(x.delta)} />}
                  </td>
                ))}
                {i === 0 &&
                  unavailable.map((x) => (
                    <td key={x.id} rowSpan={ROWS.length + 1} className="metric-unavailable">
                      No data: {x.reason}
                    </td>
                  ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Slope</th>
              {sites.map((x) => (
                <td key={x.site.id} className="num">
                  <Slope slopeDeg={x.site.slopeDeg} />
                </td>
              ))}
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
