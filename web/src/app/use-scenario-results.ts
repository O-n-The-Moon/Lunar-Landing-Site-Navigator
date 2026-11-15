// Derived engine results for the current scenario (SPEC-app → State: derived results in useMemo).
import { useMemo } from 'react'
import {
  DEFAULT_VISIBILITY_OPTS,
  detectWindows,
  diffMetrics,
  missionMetrics,
  sampleSite,
  siteContext,
  type DetectedWindows,
  type Ephemeris,
  type MetricDelta,
  type MissionMetrics,
  type Site,
  type SiteContext,
  type SiteSamples,
  type SitesFile,
  type VisibilityOpts,
} from '../engine'
import { useCoreData } from './data'
import {
  GRID_OBSERVER_HEIGHT_M,
  HOUR_MS,
  slippedLandingMs,
  useScenario,
  type ScenarioSite,
  type ScenarioState,
} from './state'

/** A scenario site with everything views need to label it. */
export interface ResolvedSite {
  id: string
  kind: ScenarioSite['kind']
  name: string
  latDeg: number
  lonDeg: number
  /** null for custom sites (the grid has no slope). */
  slopeDeg: number | null
  /** Custom sites: distance from the entered point to the grid cell used; null for curated sites. */
  snapDistKm: number | null
  /** Height actually used: custom (grid-snapped) sites are 2 m only. */
  observerHeightM: number
}

/**
 * One mission run (baseline or slipped) at one site. `samples` and `windows` start up to 48 h before
 * `landingMs` (the same pre-roll `missionMetrics` uses, so window edges agree with `metrics`) and end at
 * `landingMs + durationH`; clip them to the mission when drawing.
 */
export interface SiteRun {
  landingMs: number
  samples: SiteSamples
  windows: DetectedWindows
  metrics: MissionMetrics
}

export interface SiteResult {
  site: ResolvedSite
  ctx: SiteContext
  baseline: SiteRun
  slipped: SiteRun
  /** diffMetrics(baseline, slipped); null at slip 0 so views hide the Δ. */
  delta: MetricDelta | null
}

/** A scenario site the engine can't evaluate, and why (shown to the user). */
export interface UnavailableSite {
  id: string
  name: string
  reason: string
}

export interface ScenarioResults {
  opts: VisibilityOpts
  baselineLandingMs: number
  slippedLandingMs: number
  durationH: number
  /** Scenario order, evaluable sites only. */
  sites: SiteResult[]
  /** Scenario order. */
  unavailable: UnavailableSite[]
}

/** The engine inputs `computeScenarioResults` needs from the loaded data. */
export type EngineData = { ephemeris: Ephemeris; sitesFile: SitesFile }

export const formatLatDeg = (latDeg: number) => `${Math.abs(latDeg).toFixed(2)}°${latDeg < 0 ? 'S' : 'N'}`
export const formatLonDeg = (lonDeg: number) => `${Math.abs(lonDeg).toFixed(2)}°${lonDeg < 0 ? 'W' : 'E'}`

export function visibilityOpts(s: Pick<ScenarioState, 'sunThreshold' | 'earthMarginDeg'>): VisibilityOpts {
  return {
    ...DEFAULT_VISIBILITY_OPTS,
    sunThreshold: s.sunThreshold,
    earthMarginDeg: s.earthMarginDeg,
  }
}

export function resolveSite(ref: ScenarioSite, curated: readonly Site[], observerHeightM: number): ResolvedSite | null {
  if (ref.kind === 'custom') {
    return {
      id: ref.id,
      kind: 'custom',
      name: `Custom ${formatLatDeg(ref.latDeg)} ${formatLonDeg(ref.lonDeg)}`,
      latDeg: ref.latDeg,
      lonDeg: ref.lonDeg,
      slopeDeg: null,
      snapDistKm: ref.cell.snapDistKm,
      observerHeightM: GRID_OBSERVER_HEIGHT_M,
    }
  }
  const site = curated.find((x) => x.id === ref.id)
  if (!site) return null
  return {
    id: site.id,
    kind: 'curated',
    name: site.name,
    latDeg: site.latDeg,
    lonDeg: site.lonDeg,
    slopeDeg: site.slopeDeg,
    snapDistKm: null,
    observerHeightM,
  }
}

type SiteSetup = { site: ResolvedSite; ctx: SiteContext } | UnavailableSite

/** Resolves each scenario site and builds its engine context, or says why it can't be evaluated. */
export function siteSetups(
  refs: readonly ScenarioSite[],
  { ephemeris, sitesFile }: EngineData,
  observerHeightM: number,
): SiteSetup[] {
  return refs.map((ref) => {
    const site = resolveSite(ref, sitesFile.sites, observerHeightM)
    if (!site) return { id: ref.id, name: ref.id, reason: 'Not in sites.json.' }
    // The engine has no grid-cell context yet (custom sites use the grid's terrain, not a sites.json mask).
    if (site.kind === 'custom') return { id: site.id, name: site.name, reason: 'Custom-site metrics are not available yet.' }
    const curated = sitesFile.sites.find((x) => x.id === site.id)
    if (!curated?.horizonElevDeg[String(observerHeightM)]) {
      return { id: site.id, name: site.name, reason: `No ${observerHeightM} m horizon mask in sites.json.` }
    }
    return { site, ctx: siteContext(ephemeris, curated, sitesFile.azStepDeg, observerHeightM) }
  })
}

const STEP_MIN = 10
const STEP_MS = STEP_MIN * 60_000
/** Must match `missionMetrics`' pre-roll so the run's windows match its metrics (a test checks this). */
const PRE_ROLL_STEPS = (48 * 60) / STEP_MIN

const ephemerisEndMs = (eph: Ephemeris) => eph.startUtcMs + (eph.count - 1) * eph.stepMs

/** True when the half-open mission [landingMs, landingMs + durationH) lies inside the ephemeris. */
export function missionInCoverage(eph: Ephemeris, landingMs: number, durationH: number): boolean {
  return landingMs >= eph.startUtcMs && landingMs + durationH * HOUR_MS <= ephemerisEndMs(eph)
}

/** Samples, windows and metrics of one mission; the mission must be inside the ephemeris coverage. */
export function runMission(ctx: SiteContext, landingMs: number, durationH: number, opts: VisibilityOpts): SiteRun {
  const metrics = missionMetrics(ctx, landingMs, durationH, opts)
  const preSteps = Math.min(PRE_ROLL_STEPS, Math.floor((landingMs - ctx.eph.startUtcMs) / STEP_MS))
  const samples = sampleSite(ctx, landingMs - preSteps * STEP_MS, landingMs + durationH * HOUR_MS, STEP_MIN)
  return { landingMs, samples, windows: detectWindows(samples, opts), metrics }
}

/** One run per setup, or null where the site is unavailable or the mission is outside the ephemeris. */
export function runAll(setups: readonly SiteSetup[], landingMs: number, durationH: number, opts: VisibilityOpts) {
  return setups.map((x) =>
    'ctx' in x && missionInCoverage(x.ctx.eph, landingMs, durationH) ? runMission(x.ctx, landingMs, durationH, opts) : null,
  )
}

function coverageReason(which: 'Baseline' | 'Slipped', eph: Ephemeris): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return `${which} mission runs outside the ephemeris (${day(eph.startUtcMs)} → ${day(ephemerisEndMs(eph))}).`
}

type Mission = Pick<ScenarioState, 'landingMs' | 'slipH' | 'durationH'>

/** Combines setups and runs (same order) into the results views read. */
export function assembleResults(
  mission: Mission,
  opts: VisibilityOpts,
  eph: Ephemeris,
  setups: readonly SiteSetup[],
  baseline: readonly (SiteRun | null)[],
  slipped: readonly (SiteRun | null)[],
): ScenarioResults {
  const sites: SiteResult[] = []
  const unavailable: UnavailableSite[] = []
  for (const [i, x] of setups.entries()) {
    if (!('ctx' in x)) {
      unavailable.push(x)
      continue
    }
    const b = baseline[i]
    const sl = slipped[i]
    if (!b || !sl) {
      unavailable.push({ id: x.site.id, name: x.site.name, reason: coverageReason(b ? 'Slipped' : 'Baseline', eph) })
      continue
    }
    const site = { ...x.site, observerHeightM: x.ctx.observerHeightM }
    const delta = mission.slipH === 0 ? null : diffMetrics(b.metrics, sl.metrics)
    sites.push({ site, ctx: x.ctx, baseline: b, slipped: sl, delta })
  }
  return {
    opts,
    baselineLandingMs: mission.landingMs,
    slippedLandingMs: mission.landingMs + mission.slipH * HOUR_MS,
    durationH: mission.durationH,
    sites,
    unavailable,
  }
}

/** Runs the engine for every scenario site: baseline and slipped missions plus the slip delta. */
export function computeScenarioResults(s: ScenarioState, data: EngineData): ScenarioResults {
  const opts = visibilityOpts(s)
  const setups = siteSetups(s.sites, data, s.observerHeightM)
  const baseline = runAll(setups, s.landingMs, s.durationH, opts)
  const slipped = s.slipH === 0 ? baseline : runAll(setups, slippedLandingMs(s), s.durationH, opts)
  return assembleResults(s, opts, data.ephemeris, setups, baseline, slipped)
}

/**
 * `computeScenarioResults`, memoized per stage: moving the cursor recomputes nothing, and the slip slider
 * only recomputes the slipped runs.
 */
export function useScenarioResults(): ScenarioResults {
  const data = useCoreData()
  const { sites: refs, observerHeightM, landingMs, durationH, slipH, sunThreshold, earthMarginDeg } = useScenario()
  const opts = useMemo(() => visibilityOpts({ sunThreshold, earthMarginDeg }), [sunThreshold, earthMarginDeg])
  const setups = useMemo(() => siteSetups(refs, data, observerHeightM), [refs, data, observerHeightM])
  const baseline = useMemo(() => runAll(setups, landingMs, durationH, opts), [setups, landingMs, durationH, opts])
  const slipped = useMemo(
    () => (slipH === 0 ? baseline : runAll(setups, landingMs + slipH * HOUR_MS, durationH, opts)),
    [slipH, baseline, setups, landingMs, durationH, opts],
  )
  return useMemo(
    () => assembleResults({ landingMs, slipH, durationH }, opts, data.ephemeris, setups, baseline, slipped),
    [landingMs, slipH, durationH, opts, data.ephemeris, setups, baseline, slipped],
  )
}
