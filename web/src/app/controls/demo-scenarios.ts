// Demo scenarios found by `lunarnav demo` (docs/demo.md, T30): an exhaustive search over every curated site and daily
// landing from 2027-01-01, at the app defaults (14 d mission, 2 m, Sun 0.5, Earth margin 1°). Hand-copied from the
// generated doc; `demo-scenarios.test.ts` fails if the doc and this list disagree. The app recomputes every number
// live, so the stories below carry none.
import { DEFAULT_OBSERVER_HEIGHT_M, DEFAULT_VISIBILITY_OPTS, type Site } from '../../engine'
import { DEFAULT_DURATION_H, HOUR_MS, type ScenarioState } from '../state'

export interface DemoScenario {
  id: string
  kind: 'flip' | 'loss'
  title: string
  /** "Feb 2029": the landing month, shown beside the title. */
  when: string
  /** One line: what happens when you apply the slip. */
  story: string
  /** Curated site ids, in display order. */
  siteIds: readonly string[]
  /** Baseline landing, UTC midnight. */
  landingMs: number
  /** The slip that tells the story. A preset loads at slip 0; the deck's "Try" button applies this. */
  targetSlipDays: number
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'flip-athena-ridge',
    kind: 'flip',
    title: 'Athena vs ridge',
    when: 'Feb 2029',
    story: 'IM-2 Athena leads the connecting ridge on power + comms, until a 15-day slip hands the lead to the ridge.',
    siteIds: ['mons-mouton-im2', 'connecting-ridge'],
    landingMs: Date.UTC(2029, 1, 20),
    targetSlipDays: 15,
  },
  {
    id: 'flip-haworth-nobile',
    kind: 'flip',
    title: 'Haworth vs Nobile Rim 2',
    when: 'Oct 2027',
    story: 'Haworth leads Nobile Rim 2 on power + comms, until a 15-day slip puts Nobile Rim 2 far ahead.',
    siteIds: ['haworth', 'nobile-rim-2'],
    landingMs: Date.UTC(2027, 9, 18),
    targetSlipDays: 15,
  },
  {
    id: 'flip-gerlache-malapert',
    kind: 'flip',
    title: 'de Gerlache vs Malapert',
    when: 'Aug 2027',
    story: 'de Gerlache Rim 2 leads Malapert Massif on power + comms, until a 14-day slip reverses it.',
    siteIds: ['de-gerlache-rim-2', 'malapert-massif'],
    landingMs: Date.UTC(2027, 7, 13),
    targetSlipDays: 14,
  },
  {
    id: 'loss-athena',
    kind: 'loss',
    title: 'Athena goes dark',
    when: 'Oct 2030',
    story: 'IM-2 Athena has near-full power + comms, then none after a 14-day slip.',
    siteIds: ['mons-mouton-im2'],
    landingMs: Date.UTC(2030, 9, 4),
    targetSlipDays: 14,
  },
  {
    id: 'loss-gerlache',
    kind: 'loss',
    title: 'de Gerlache goes dark',
    when: 'Aug 2028',
    story: 'de Gerlache Rim 2 has near-full power + comms, then none after a 15-day slip.',
    siteIds: ['de-gerlache-rim-2'],
    landingMs: Date.UTC(2028, 7, 31),
    targetSlipDays: 15,
  },
  {
    id: 'loss-nobile',
    kind: 'loss',
    title: 'Nobile Rim 2 goes dark',
    when: 'Oct 2028',
    story: 'Nobile Rim 2 has near-full power + comms, then none after a 14-day slip.',
    siteIds: ['nobile-rim-2'],
    landingMs: Date.UTC(2028, 9, 22),
    targetSlipDays: 14,
  },
]

/** True when every site of the scenario is in the loaded catalog (the fixtures don't have them). */
export function scenarioAvailable(sc: DemoScenario, sites: readonly Site[]): boolean {
  return sc.siteIds.every((id) => sites.some((s) => s.id === id))
}

/**
 * The full scenario state for a preset. The doc's numbers hold at the app defaults, so loading a preset also resets
 * the assumptions (observer height, Sun threshold, Earth margin) to them. The map layer is kept.
 */
export function scenarioState(sc: DemoScenario, prev: ScenarioState): ScenarioState {
  return {
    ...prev,
    sites: sc.siteIds.map((id) => ({ kind: 'curated', id })),
    focusedSiteId: sc.siteIds[0],
    landingMs: sc.landingMs,
    durationH: DEFAULT_DURATION_H,
    slipH: 0,
    cursorMs: sc.landingMs + 2 * 24 * HOUR_MS,
    observerHeightM: DEFAULT_OBSERVER_HEIGHT_M,
    sunThreshold: DEFAULT_VISIBILITY_OPTS.sunThreshold,
    earthMarginDeg: DEFAULT_VISIBILITY_OPTS.earthMarginDeg,
  }
}

/** True while the scenario still is the preset's (same sites in order, landing and mission length); the slip may differ. */
export function matchesScenario(sc: DemoScenario, s: ScenarioState): boolean {
  return (
    s.landingMs === sc.landingMs &&
    s.durationH === DEFAULT_DURATION_H &&
    s.sites.length === sc.siteIds.length &&
    s.sites.every((x, i) => x.kind === 'curated' && x.id === sc.siteIds[i])
  )
}
