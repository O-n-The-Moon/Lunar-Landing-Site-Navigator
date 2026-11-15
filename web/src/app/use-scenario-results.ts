// Derived engine results for the current scenario (SPEC-app → State: derived results in useMemo).
// For now this returns the T2 fixture outputs; T14 (#15) swaps in the real engine and keeps this shape.
import { useMemo } from 'react'
import {
  DEFAULT_VISIBILITY_OPTS,
  type DetectedWindows,
  type MetricDelta,
  type MissionMetrics,
  type Site,
  type SiteContext,
  type SiteSamples,
  type VisibilityOpts,
} from '../engine'
import { fixtureOutputs } from '../engine/__fixtures__'
import { useCoreData } from './data'
import {
  GRID_OBSERVER_HEIGHT_M,
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

/** One mission run (baseline or slipped) at one site. */
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

export interface ScenarioResults {
  opts: VisibilityOpts
  baselineLandingMs: number
  slippedLandingMs: number
  durationH: number
  /** Scenario order. Sites the engine can't evaluate yet are listed in `unavailableSiteIds` instead. */
  sites: SiteResult[]
  unavailableSiteIds: string[]
}

export const formatLatDeg = (latDeg: number) => `${Math.abs(latDeg).toFixed(2)}°${latDeg < 0 ? 'S' : 'N'}`
export const formatLonDeg = (lonDeg: number) => `${Math.abs(lonDeg).toFixed(2)}°${lonDeg < 0 ? 'W' : 'E'}`

export function visibilityOpts(s: ScenarioState): VisibilityOpts {
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

/** Fixture stand-in for the engine: fixed outputs for the fixture sites, whatever the scenario says. */
export function computeScenarioResults(s: ScenarioState, curated: readonly Site[]): ScenarioResults {
  const sites: SiteResult[] = []
  const unavailableSiteIds: string[] = []
  for (const ref of s.sites) {
    const site = resolveSite(ref, curated, s.observerHeightM)
    const out = fixtureOutputs[ref.id]
    if (!site || !out) {
      unavailableSiteIds.push(ref.id)
      continue
    }
    sites.push({
      site,
      ctx: out.ctx,
      baseline: { landingMs: s.landingMs, samples: out.samples, windows: out.windows, metrics: out.metrics.baseline },
      slipped: { landingMs: slippedLandingMs(s), samples: out.samples, windows: out.windows, metrics: out.metrics.slipped },
      delta: s.slipH === 0 ? null : out.metricDelta,
    })
  }
  return {
    opts: visibilityOpts(s),
    baselineLandingMs: s.landingMs,
    slippedLandingMs: slippedLandingMs(s),
    durationH: s.durationH,
    sites,
    unavailableSiteIds,
  }
}

export function useScenarioResults(): ScenarioResults {
  const scenario = useScenario()
  const { sitesFile } = useCoreData()
  return useMemo(() => computeScenarioResults(scenario, sitesFile.sites), [scenario, sitesFile])
}
