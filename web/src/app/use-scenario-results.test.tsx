import { act, renderHook, waitFor } from '@testing-library/react'
import type { Dispatch, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { diffMetrics, missionMetrics, siteContext, type Window } from '../engine'
import { fixtureEphemeris, fixtureSitesFile } from '../engine/__fixtures__'
import { DataProvider, fixtureDataSource, useCoreDataState } from './data'
import {
  HOUR_MS,
  ScenarioProvider,
  createInitialState,
  scenarioReducer,
  useScenarioDispatch,
  type ScenarioAction,
  type ScenarioState,
} from './state'
import { computeScenarioResults, resolveSite, useScenarioResults, visibilityOpts } from './use-scenario-results'

const core = { ephemeris: fixtureEphemeris, sitesFile: fixtureSitesFile }
const curated = fixtureSitesFile.sites
const plateau = curated[0]
/** The fixture ephemeris covers 48 h from the default landing, so use a 1-day mission. */
const base = scenarioReducer(createInitialState({ sites: curated }), { type: 'setDuration', durationH: 24 })
const apply = (...actions: ScenarioAction[]): ScenarioState => actions.reduce(scenarioReducer, base)
const customSite: ScenarioAction = { type: 'addCustomSite', latDeg: -85.12, lonDeg: 30.4, cell: { ix: 1, iy: 2, snapDistKm: 0.8 } }

/** Time a state is on inside [startMs, endMs), from a run's windows. */
const onMs = (wins: Window[], startMs: number, endMs: number) =>
  wins.reduce((sum, w) => sum + Math.max(0, Math.min(w.endMs, endMs) - Math.max(w.startMs, startMs)), 0)

describe('computeScenarioResults (real engine)', () => {
  it('returns missionMetrics for each scenario site, in order', () => {
    const r = computeScenarioResults(base, core)
    expect(r.sites.map((x) => x.site.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    const ctx = siteContext(fixtureEphemeris, plateau, fixtureSitesFile.azStepDeg, 2)
    expect(r.sites[0].baseline.metrics).toEqual(missionMetrics(ctx, base.landingMs, 24, visibilityOpts(base)))
    expect(r.sites[0].site).toMatchObject({ kind: 'curated', slopeDeg: plateau.slopeDeg, observerHeightM: 2 })
    expect(r.unavailable).toEqual([])
  })

  it('runs the slipped mission at the slipped landing', () => {
    const s = apply({ type: 'setSlip', slipH: 12 })
    const r = computeScenarioResults(s, core)
    const ctx = siteContext(fixtureEphemeris, plateau, fixtureSitesFile.azStepDeg, 2)
    expect(r.slippedLandingMs).toBe(base.landingMs + 12 * HOUR_MS)
    expect(r.sites[0].slipped.landingMs).toBe(r.slippedLandingMs)
    expect(r.sites[0].slipped.metrics).toEqual(missionMetrics(ctx, r.slippedLandingMs, 24, visibilityOpts(s)))
  })

  it('uses the scenario visibility options', () => {
    const s = apply({ type: 'setSunThreshold', value: 0.8 }, { type: 'setEarthMargin', deg: 3 })
    const r = computeScenarioResults(s, core)
    expect(r.opts).toMatchObject({ sunThreshold: 0.8, earthMarginDeg: 3 })
    const ctx = siteContext(fixtureEphemeris, plateau, fixtureSitesFile.azStepDeg, 2)
    expect(r.sites[0].baseline.metrics).toEqual(missionMetrics(ctx, base.landingMs, 24, r.opts))
  })

  it('builds each curated site at the scenario observer height and labels it with that height', () => {
    const r = computeScenarioResults(apply({ type: 'setObserverHeight', heightM: 10 }), core)
    for (const x of r.sites) {
      expect(x.ctx.observerHeightM).toBe(10)
      expect(x.site.observerHeightM).toBe(10)
    }
  })

  it('hides the delta at slip 0 and gives diffMetrics(baseline, slipped) otherwise', () => {
    expect(computeScenarioResults(base, core).sites[0].delta).toBeNull()
    const r = computeScenarioResults(apply({ type: 'setSlip', slipH: 12 }), core)
    const x = r.sites[0]
    expect(x.delta).toEqual(diffMetrics(x.baseline.metrics, x.slipped.metrics))
    expect(x.delta?.sunlitPct).not.toBe(0)
  })

  it("gives each run windows that agree with that run's metrics", () => {
    const r = computeScenarioResults(apply({ type: 'setSlip', slipH: 12 }), core)
    for (const x of r.sites) {
      for (const run of [x.baseline, x.slipped]) {
        const endMs = run.landingMs + 24 * HOUR_MS
        const pct = (wins: Window[]) => (100 * onMs(wins, run.landingMs, endMs)) / (24 * HOUR_MS)
        expect(pct(run.windows.sun)).toBeCloseTo(run.metrics.sunlitPct, 9)
        expect(pct(run.windows.earth)).toBeCloseTo(run.metrics.earthPct, 9)
        expect(pct(run.windows.both)).toBeCloseTo(run.metrics.bothPct, 9)
        expect(run.samples.tUtcMs.at(-1)).toBe(endMs)
      }
    }
  })

  it('lists a custom site as unavailable with a reason instead of inventing numbers', () => {
    const r = computeScenarioResults(apply(customSite), core)
    expect(r.sites).toHaveLength(2)
    expect(r.unavailable).toEqual([{ id: 'custom-1-2', name: 'Custom 85.12°S 30.40°E', reason: expect.stringMatching(/custom/i) }])
  })

  it('lists a site missing from sites.json as unavailable', () => {
    const s: ScenarioState = { ...base, sites: [{ kind: 'curated', id: 'gone' }] }
    expect(computeScenarioResults(s, core).unavailable).toEqual([
      { id: 'gone', name: 'gone', reason: expect.stringMatching(/sites\.json/) },
    ])
  })

  it('lists every site as unavailable when the baseline mission runs past the ephemeris', () => {
    const r = computeScenarioResults(apply({ type: 'setDuration', durationH: 72 }), core)
    expect(r.sites).toEqual([])
    expect(r.unavailable.map((x) => x.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    for (const x of r.unavailable) expect(x.reason).toMatch(/^Baseline run .*ephemeris/)
  })

  it('names the slipped mission when only the slip runs past the ephemeris', () => {
    const r = computeScenarioResults(apply({ type: 'setSlip', slipH: 30 }), core)
    expect(r.sites).toEqual([])
    for (const x of r.unavailable) expect(x.reason).toMatch(/^Slipped run .*ephemeris/)
  })
})

describe('useScenarioResults', () => {
  function renderResults() {
    let dispatch: Dispatch<ScenarioAction> = () => {}
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider source={fixtureDataSource()}>
        <CoreGate>
          <ScenarioProvider initialState={base}>{children}</ScenarioProvider>
        </CoreGate>
      </DataProvider>
    )
    const hook = renderHook(
      () => {
        dispatch = useScenarioDispatch()
        return useScenarioResults()
      },
      { wrapper },
    )
    return { ...hook, dispatch: (a: ScenarioAction) => act(() => dispatch(a)) }
  }

  it('matches computeScenarioResults', async () => {
    const { result } = renderResults()
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current).toEqual(computeScenarioResults(base, core))
  })

  it('keeps the same results when only the cursor moves', async () => {
    const { result, dispatch } = renderResults()
    await waitFor(() => expect(result.current).toBeTruthy())
    const before = result.current
    dispatch({ type: 'setCursor', cursorMs: base.landingMs + 3 * HOUR_MS })
    expect(result.current).toBe(before)
  })

  it('reuses the baseline runs when only the slip changes', async () => {
    const { result, dispatch } = renderResults()
    await waitFor(() => expect(result.current).toBeTruthy())
    const baseline = result.current.sites[0].baseline
    dispatch({ type: 'setSlip', slipH: 6 })
    expect(result.current.sites[0].baseline).toBe(baseline)
    expect(result.current.sites[0].slipped.landingMs).toBe(base.landingMs + 6 * HOUR_MS)
  })
})

/** Renders children once core data is ready, like the App does. */
function CoreGate({ children }: { children: ReactNode }) {
  return useCoreDataState().core.status === 'ready' ? children : null
}

describe('resolveSite', () => {
  it('resolves a custom site label and snap distance', () => {
    const s = apply(customSite)
    const ref = s.sites.find((x) => x.kind === 'custom')
    expect(ref && resolveSite(ref, curated, 10)).toEqual({
      id: 'custom-1-2',
      kind: 'custom',
      name: 'Custom 85.12°S 30.40°E',
      latDeg: -85.12,
      lonDeg: 30.4,
      slopeDeg: null,
      snapDistKm: 0.8,
      observerHeightM: 2,
    })
  })

  it('returns null for an id missing from sites.json', () => {
    expect(resolveSite({ kind: 'curated', id: 'gone' }, curated, 2)).toBeNull()
  })
})
