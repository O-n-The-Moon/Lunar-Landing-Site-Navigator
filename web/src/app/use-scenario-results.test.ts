import { describe, expect, it } from 'vitest'
import { fixtureOutputs, fixtureSitesFile } from '../engine/__fixtures__'
import { HOUR_MS, createInitialState, scenarioReducer } from './state'
import { computeScenarioResults } from './use-scenario-results'

const curated = fixtureSitesFile.sites
const base = createInitialState({ sites: curated })

describe('computeScenarioResults (fixture stand-in)', () => {
  it('returns fixture outputs per scenario site, in order, with the scenario opts', () => {
    const r = computeScenarioResults({ ...base, sunThreshold: 0.8 }, curated)
    expect(r.sites.map((x) => x.site.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    expect(r.sites[0].slipped.metrics).toBe(fixtureOutputs['fixture-plateau'].metrics.slipped)
    expect(r.sites[0].site).toMatchObject({ kind: 'curated', slopeDeg: 4.2, observerHeightM: 2 })
    expect(r.opts.sunThreshold).toBe(0.8)
    expect(r.unavailableSiteIds).toEqual([])
  })

  it('hides the delta at slip 0 and shows it otherwise', () => {
    expect(computeScenarioResults(base, curated).sites[0].delta).toBeNull()
    const slipped = scenarioReducer(base, { type: 'setSlip', slipH: 12 })
    const r = computeScenarioResults(slipped, curated)
    expect(r.sites[0].delta).toBe(fixtureOutputs['fixture-plateau'].metricDelta)
    expect(r.slippedLandingMs).toBe(base.landingMs + 12 * HOUR_MS)
  })

  it('lists sites without outputs as unavailable instead of inventing numbers', () => {
    const s = scenarioReducer(base, { type: 'addCustomSite', latDeg: -85.12, lonDeg: 30.4, cell: { ix: 1, iy: 2, snapDistKm: 0.8 } })
    const r = computeScenarioResults(s, curated)
    expect(r.sites).toHaveLength(2)
    expect(r.unavailableSiteIds).toEqual(['custom-1-2'])
  })
})
