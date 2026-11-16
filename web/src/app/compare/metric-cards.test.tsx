import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_VISIBILITY_OPTS, diffMetrics, type MissionMetrics } from '../../engine'
import { fixtureOutputs, fixtureScenario, fixtureSitesFile } from '../../engine/__fixtures__'
import { HOUR_MS } from '../state'
import type { ScenarioResults, SiteResult } from '../use-scenario-results'
import { MetricCards } from './metric-cards'

afterEach(cleanup)

/** The fixture scenario (24 h mission slipped +12 h) as `useScenarioResults` would return it. */
function fixtureResults({ slipped }: { slipped: boolean }): ScenarioResults {
  const landingMs = fixtureScenario.baselineLandingMs
  const slipH = slipped ? fixtureScenario.slipH : 0
  const sites: SiteResult[] = fixtureSitesFile.sites.map((s) => {
    const out = fixtureOutputs[s.id]
    const run = (m: typeof out.metrics.baseline) => ({ landingMs: m.landingMs, samples: out.samples, windows: out.windows, metrics: m })
    return {
      site: { id: s.id, kind: 'curated', name: s.name, latDeg: s.latDeg, lonDeg: s.lonDeg, slopeDeg: s.slopeDeg, snapDistKm: null, gridCellKm: null, observerHeightM: 2 },
      ctx: out.ctx,
      baseline: run(out.metrics.baseline),
      slipped: run(slipped ? out.metrics.slipped : out.metrics.baseline),
      delta: slipped ? out.metricDelta : null,
    }
  })
  return {
    opts: DEFAULT_VISIBILITY_OPTS,
    baselineLandingMs: landingMs,
    slippedLandingMs: landingMs + slipH * HOUR_MS,
    durationH: fixtureScenario.durationH,
    siteIds: sites.map((x) => x.site.id),
    sites,
    unavailable: [],
  }
}

/** The fixture scenario with the plateau's baseline and slipped metrics patched. */
function withPlateau(baseline: Partial<MissionMetrics>, slipped: Partial<MissionMetrics>): ScenarioResults {
  const results = fixtureResults({ slipped: true })
  const [p] = results.sites
  const b = { ...p.baseline.metrics, ...baseline }
  const sl = { ...p.slipped.metrics, ...slipped }
  results.sites = [{ ...p, baseline: { ...p.baseline, metrics: b }, slipped: { ...p.slipped, metrics: sl }, delta: diffMetrics(b, sl) }]
  results.siteIds = [p.site.id]
  return results
}

const table = () => screen.getByRole('table', { name: /mission metrics/i })
/** The cell for a metric row and site column. */
function cell(metric: RegExp, site: RegExp) {
  const t = table()
  const col = within(t)
    .getAllByRole('columnheader')
    .findIndex((h) => site.test(h.textContent ?? ''))
  const row = within(t).getByRole('rowheader', { name: metric }).closest('tr')
  if (col < 0 || !row) throw new Error(`no cell for ${metric} / ${site}`)
  return row.children[col] as HTMLElement
}

describe('MetricCards', () => {
  it('shows one column per site with name, coordinates and observer height', () => {
    render(<MetricCards results={fixtureResults({ slipped: false })} />)
    const headers = within(table()).getAllByRole('columnheader').slice(1)
    expect(headers).toHaveLength(2)
    expect(headers[0]).toHaveTextContent(/Fixture Plateau \(synthetic\)/)
    expect(headers[0]).toHaveTextContent(/°S/)
    expect(headers[0]).toHaveTextContent(/2 m/)
  })

  it('shows every SPEC-app P0-3 metric with the missionMetrics values', () => {
    render(<MetricCards results={fixtureResults({ slipped: false })} />)
    const p = /plateau/i
    expect(cell(/^sunlit/i, p)).toHaveTextContent('56.0 %')
    expect(cell(/^earth link/i, p)).toHaveTextContent('100.0 %')
    expect(cell(/^both/i, p)).toHaveTextContent('56.0 %')
    expect(cell(/longest sun gap/i, p)).toHaveTextContent('10.6 h')
    expect(cell(/longest earth gap/i, p)).toHaveTextContent('0.0 h')
    expect(cell(/first sunset/i, p)).toHaveTextContent('13.4 h')
    // Earth link 100 %: it never sets.
    expect(cell(/first earthset/i, p)).toHaveTextContent('No Earthset')
    expect(cell(/mean sun fraction/i, p)).toHaveTextContent('0.56')
    expect(cell(/slope/i, p)).toHaveTextContent('4.2°')
  })

  it('says "never" instead of "None" when the body is never up during the mission', () => {
    const results = fixtureResults({ slipped: false })
    const [plateau] = results.sites
    const dark = { ...plateau.slipped.metrics, sunlitPct: 0, firstSunsetH: null, sunNeverUp: true, earthPct: 0, firstEarthsetH: null, earthNeverUp: true }
    results.sites = [{ ...plateau, slipped: { ...plateau.slipped, metrics: dark } }]
    render(<MetricCards results={results} />)
    expect(cell(/first sunset/i, /plateau/i)).toHaveTextContent('Never sunlit')
    expect(cell(/first earthset/i, /plateau/i)).toHaveTextContent('Never in view')
  })

  it('shows no Δ at slip 0', () => {
    render(<MetricCards results={fixtureResults({ slipped: false })} />)
    expect(within(table()).queryByText(/Δ|better|worse/)).toBeNull()
  })

  it('shows slipped values with a Δ vs the baseline, green when better and red when worse', () => {
    render(<MetricCards results={fixtureResults({ slipped: true })} />)
    const p = /plateau/i
    const sunlit = cell(/^sunlit/i, p)
    expect(sunlit).toHaveTextContent('51.9 %')
    expect(sunlit).toHaveTextContent('−4.1 pp')
    expect(within(sunlit).getByText(/−4\.1 pp/).closest('.delta')).toHaveClass('worse')
    expect(sunlit).toHaveTextContent(/worse/)

    // A longer gap is worse; an earlier sunset is worse.
    expect(cell(/longest sun gap/i, p)).toHaveTextContent('+1.0 h')
    expect(cell(/longest sun gap/i, p).querySelector('.delta')).toHaveClass('worse')
    expect(cell(/first sunset/i, p)).toHaveTextContent('1.4 h')
    expect(cell(/first sunset/i, p)).toHaveTextContent('−12.0 h')
    expect(cell(/first sunset/i, p).querySelector('.delta')).toHaveClass('worse')
    // Earth never set in the baseline; now it does.
    expect(cell(/first earthset/i, p)).toHaveTextContent('17.3 h')
    expect(cell(/first earthset/i, p)).toHaveTextContent(/now sets/i)
    expect(cell(/first earthset/i, p).querySelector('.delta')).toHaveClass('worse')
    expect(cell(/mean sun fraction/i, p)).toHaveTextContent('−0.04')
    // Slope does not depend on the date.
    expect(cell(/slope/i, p).querySelector('.delta')).toBeNull()
  })

  it('marks a better Δ green', () => {
    render(<MetricCards results={withPlateau({ sunlitPct: 50 }, { sunlitPct: 53.25, firstSunsetH: null })} />)
    expect(cell(/^sunlit/i, /plateau/i).querySelector('.delta')).toHaveClass('better')
    expect(cell(/^sunlit/i, /plateau/i)).toHaveTextContent('+3.3 pp')
    expect(cell(/first sunset/i, /plateau/i)).toHaveTextContent('No sunset')
    expect(cell(/first sunset/i, /plateau/i)).toHaveTextContent(/no longer sets/i)
    expect(cell(/first sunset/i, /plateau/i).querySelector('.delta')).toHaveClass('better')
  })

  it('tells "never up" apart from "never sets" in the event Δ', () => {
    // Baseline never sunlit; the slipped mission gets sunlight that later sets: a gain, not "now sets".
    const { unmount } = render(
      <MetricCards results={withPlateau({ sunlitPct: 0, firstSunsetH: null, sunNeverUp: true }, { sunlitPct: 20, firstSunsetH: 30, sunNeverUp: false })} />,
    )
    const gained = cell(/first sunset/i, /plateau/i)
    expect(gained).toHaveTextContent('30.0 h')
    expect(gained).toHaveTextContent(/now sunlit/i)
    expect(gained.querySelector('.delta')).toHaveClass('better')
    unmount()

    // Baseline always sunlit, slipped never sunlit: both firstSunsetH null, but the engine's sunNeverUp flag marks a total loss.
    render(<MetricCards results={withPlateau({ sunlitPct: 100, firstSunsetH: null, sunNeverUp: false }, { sunlitPct: 0, firstSunsetH: null, sunNeverUp: true })} />)
    const lost = cell(/first sunset/i, /plateau/i)
    expect(lost).toHaveTextContent('Never sunlit')
    expect(lost.querySelector('.delta')).toHaveClass('worse')
  })

  it('shows a Δ that rounds to zero as neutral', () => {
    const results = fixtureResults({ slipped: true })
    const [plateau] = results.sites
    results.sites = [{ ...plateau, delta: { ...plateau.delta!, sunlitPct: -0.01 } }]
    render(<MetricCards results={results} />)
    const d = cell(/^sunlit/i, /plateau/i).querySelector('.delta')
    expect(d).toHaveTextContent('±0.0 pp')
    expect(d).not.toHaveClass('better')
    expect(d).not.toHaveClass('worse')
  })

  it('marks a slope over 10° in red with a text label, and not one at or under', () => {
    render(<MetricCards results={fixtureResults({ slipped: false })} />)
    const ridge = cell(/slope/i, /ridge/i)
    expect(ridge).toHaveTextContent('11.5°')
    expect(ridge.querySelector('.steep')).not.toBeNull()
    expect(ridge).toHaveTextContent(/over 10°/i)
    expect(cell(/slope/i, /plateau/i).querySelector('.steep')).toBeNull()
  })

  it('shows "—" for the slope of a custom site', () => {
    const results = fixtureResults({ slipped: false })
    results.sites[0] = { ...results.sites[0], site: { ...results.sites[0].site, kind: 'custom', slopeDeg: null } }
    render(<MetricCards results={results} />)
    expect(cell(/slope/i, /plateau/i)).toHaveTextContent('—')
  })

  it('gives unavailable sites a column with the reason, in scenario order', () => {
    const results = fixtureResults({ slipped: false })
    results.unavailable = [{ id: 'custom-1-2', name: 'Custom 85.12°S 30.40°E', reason: 'Custom-site metrics are not available yet.' }]
    results.siteIds = ['fixture-plateau', 'custom-1-2', 'fixture-ridge']
    render(<MetricCards results={results} />)
    const headers = within(table()).getAllByRole('columnheader').slice(1)
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringMatching(/plateau/i),
      expect.stringMatching(/custom 85\.12°S/i),
      expect.stringMatching(/ridge/i),
    ])
    expect(cell(/^sunlit/i, /custom/i)).toHaveTextContent(/no data.*custom-site metrics are not available yet/i)
    // Columns after it stay aligned in every row.
    expect(cell(/slope/i, /ridge/i)).toHaveTextContent('11.5°')
    expect(cell(/slope/i, /custom/i)).toHaveTextContent('—')
  })

  it('states the assumptions the numbers depend on', () => {
    render(<MetricCards results={fixtureResults({ slipped: true })} />)
    const caption = within(table()).getByText(/mission metrics/i)
    expect(caption).toHaveTextContent(/24 h|1 d/)
    expect(caption).toHaveTextContent(/\+12 h/)
    expect(screen.getByText(/geometric DTE/i)).toHaveTextContent(/1\.0°/)
    expect(screen.getByText(/geometric DTE/i)).toHaveTextContent(/50 %/)
  })

  it('asks for a site when there are none', () => {
    render(<MetricCards results={{ ...fixtureResults({ slipped: false }), sites: [], siteIds: [] }} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/add a site/i)).toBeInTheDocument()
  })
})
