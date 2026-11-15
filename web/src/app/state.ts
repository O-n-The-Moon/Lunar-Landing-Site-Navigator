// Scenario state for every V1 feature (SPEC-app.md → State): useReducer + context, no state library.
// Later issues read and dispatch; they should not need to change this file.
import { createContext, createElement, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import { DEFAULT_OBSERVER_HEIGHT_M, DEFAULT_VISIBILITY_OPTS, type GridCellRef, type Site } from '../engine'

export const HOUR_MS = 3_600_000
export const MAX_SITES = 3
/** Mission duration: 1–30 days, default 14 (SPEC-app P0-2). */
export const DURATION_RANGE_H = { min: 24, max: 30 * 24 } as const
export const DEFAULT_DURATION_H = 14 * 24
/** Slip: −30…+90 days (SPEC-app P0-2). Fine steps (±12 h) are any value in between. */
export const SLIP_RANGE_H = { min: -30 * 24, max: 90 * 24 } as const
/** Heights published in `sites.json`. Grid-snapped (custom) sites only have 2 m. */
export const OBSERVER_HEIGHTS_M = [2, 10] as const
export type ObserverHeightM = (typeof OBSERVER_HEIGHTS_M)[number]
export const GRID_OBSERVER_HEIGHT_M: ObserverHeightM = 2
export const EARTH_MARGIN_RANGE_DEG = { min: 0, max: 10 } as const
/** Placeholder default landing (inside both the fixture and the real ephemeris range). */
export const DEFAULT_LANDING_MS = Date.UTC(2026, 2, 1)

/** v0: PGDA long-term averages. v1: window scores from `scoreGrid`. */
export const MAP_LAYERS = ['pgda-sun', 'pgda-earth', 'score-sun', 'score-earth', 'score-both'] as const
export type MapLayer = (typeof MAP_LAYERS)[number]

export interface CuratedSiteRef {
  kind: 'curated'
  /** `sites.json` id. */
  id: string
}

/** A lat/lon the user typed or clicked, snapped to the nearest grid cell (its terrain is that cell's). */
export interface CustomSiteRef {
  kind: 'custom'
  /** `custom-<ix>-<iy>`: one custom site per grid cell. */
  id: string
  /** As entered (shown in the label); the terrain comes from `cell`. */
  latDeg: number
  lonDeg: number
  cell: GridCellRef
}

export type ScenarioSite = CuratedSiteRef | CustomSiteRef

export interface ScenarioState {
  /** ≤ MAX_SITES, in display order. */
  sites: ScenarioSite[]
  /** Site shown in the panorama; null only when there are no sites. */
  focusedSiteId: string | null
  /** Baseline (unslipped) landing, UTC ms. */
  landingMs: number
  durationH: number
  slipH: number
  observerHeightM: ObserverHeightM
  /** Visible Sun-disk fraction (0–1) that counts as "sunlit". */
  sunThreshold: number
  /** Earth center must clear the terrain horizon by this much to count as "linked". */
  earthMarginDeg: number
  /** Shared timeline/panorama cursor, UTC ms, always inside the slipped mission window. */
  cursorMs: number
  mapLayer: MapLayer
}

export type ScenarioAction =
  | { type: 'addCuratedSite'; id: string }
  | { type: 'addCustomSite'; latDeg: number; lonDeg: number; cell: GridCellRef }
  | { type: 'removeSite'; id: string }
  | { type: 'focusSite'; id: string }
  | { type: 'setLanding'; landingMs: number }
  | { type: 'setDuration'; durationH: number }
  | { type: 'setSlip'; slipH: number }
  | { type: 'setObserverHeight'; heightM: ObserverHeightM }
  | { type: 'setSunThreshold'; value: number }
  | { type: 'setEarthMargin'; deg: number }
  | { type: 'setCursor'; cursorMs: number }
  | { type: 'setMapLayer'; layer: MapLayer }
  /** Load a whole scenario (e.g. from a shared URL); every rule above is re-applied. */
  | { type: 'replace'; state: ScenarioState }

export const slippedLandingMs = (s: ScenarioState): number => s.landingMs + s.slipH * HOUR_MS
export const missionEndMs = (s: ScenarioState): number => slippedLandingMs(s) + s.durationH * HOUR_MS
export const customSiteId = (cell: GridCellRef): string => `custom-${cell.ix}-${cell.iy}`

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function clampCursor(s: ScenarioState, cursorMs: number): number {
  return clamp(cursorMs, slippedLandingMs(s), missionEndMs(s))
}

/** Applies a landing/slip/duration change, keeping the cursor at the same mission-elapsed time. */
function retime(s: ScenarioState, patch: Partial<Pick<ScenarioState, 'landingMs' | 'slipH' | 'durationH'>>): ScenarioState {
  const elapsedMs = s.cursorMs - slippedLandingMs(s)
  const next = { ...s, ...patch }
  return { ...next, cursorMs: clampCursor(next, slippedLandingMs(next) + elapsedMs) }
}

function withSites(s: ScenarioState, sites: ScenarioSite[]): ScenarioState {
  const focused = sites.some((x) => x.id === s.focusedSiteId) ? s.focusedSiteId : (sites[0]?.id ?? null)
  return { ...s, sites, focusedSiteId: focused }
}

function addSite(s: ScenarioState, site: ScenarioSite): ScenarioState {
  if (s.sites.length >= MAX_SITES || s.sites.some((x) => x.id === site.id)) return s
  return withSites(s, [...s.sites, site])
}

const validLatLon = (latDeg: number, lonDeg: number) => Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180
const isMapLayer = (v: unknown): v is MapLayer => MAP_LAYERS.includes(v as MapLayer)
const isObserverHeight = (v: unknown): v is ObserverHeightM => OBSERVER_HEIGHTS_M.includes(v as ObserverHeightM)
const isCellIndex = (v: unknown) => Number.isInteger(v) && (v as number) >= 0

/** Rebuilds a site from untrusted input (e.g. a shared URL), or returns null if it is malformed. */
function sanitizeSite(raw: unknown): ScenarioSite | null {
  if (typeof raw !== 'object' || raw === null) return null
  const site = raw as Record<string, unknown>
  if (site.kind === 'curated') {
    return typeof site.id === 'string' && site.id !== '' ? { kind: 'curated', id: site.id } : null
  }
  if (site.kind !== 'custom') return null
  const { latDeg, lonDeg } = site
  const cell = site.cell as Record<string, unknown> | null | undefined
  if (typeof latDeg !== 'number' || typeof lonDeg !== 'number' || !validLatLon(latDeg, lonDeg)) return null
  if (!cell || !isCellIndex(cell.ix) || !isCellIndex(cell.iy)) return null
  const snapDistKm = typeof cell.snapDistKm === 'number' && cell.snapDistKm >= 0 ? cell.snapDistKm : NaN
  if (!Number.isFinite(snapDistKm)) return null
  const ref: GridCellRef = { ix: cell.ix as number, iy: cell.iy as number, snapDistKm }
  return { kind: 'custom', id: customSiteId(ref), latDeg, lonDeg, cell: ref }
}

/** Re-applies every reducer rule to an externally supplied state; invalid fields fall back to `prev`. */
function normalize(next: ScenarioState, prev: ScenarioState): ScenarioState {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  let s: ScenarioState = {
    sites: [],
    focusedSiteId: typeof next.focusedSiteId === 'string' ? next.focusedSiteId : null,
    landingMs: num(next.landingMs, prev.landingMs),
    durationH: clamp(num(next.durationH, prev.durationH), DURATION_RANGE_H.min, DURATION_RANGE_H.max),
    slipH: clamp(num(next.slipH, prev.slipH), SLIP_RANGE_H.min, SLIP_RANGE_H.max),
    observerHeightM: isObserverHeight(next.observerHeightM) ? next.observerHeightM : prev.observerHeightM,
    sunThreshold: clamp(num(next.sunThreshold, prev.sunThreshold), 0, 1),
    earthMarginDeg: clamp(num(next.earthMarginDeg, prev.earthMarginDeg), EARTH_MARGIN_RANGE_DEG.min, EARTH_MARGIN_RANGE_DEG.max),
    cursorMs: 0, // set below, once the mission window is known
    mapLayer: isMapLayer(next.mapLayer) ? next.mapLayer : prev.mapLayer,
  }
  const sites: ScenarioSite[] = []
  for (const raw of Array.isArray(next.sites) ? next.sites : []) {
    const site = sanitizeSite(raw)
    if (site && sites.length < MAX_SITES && !sites.some((x) => x.id === site.id)) sites.push(site)
  }
  s = withSites(s, sites)
  return { ...s, cursorMs: clampCursor(s, num(next.cursorMs, slippedLandingMs(s))) }
}

export function scenarioReducer(s: ScenarioState, a: ScenarioAction): ScenarioState {
  switch (a.type) {
    case 'addCuratedSite':
      return addSite(s, { kind: 'curated', id: a.id })
    case 'addCustomSite':
      if (!validLatLon(a.latDeg, a.lonDeg)) return s
      return addSite(s, { kind: 'custom', id: customSiteId(a.cell), latDeg: a.latDeg, lonDeg: a.lonDeg, cell: a.cell })
    case 'removeSite':
      return withSites(
        s,
        s.sites.filter((x) => x.id !== a.id),
      )
    case 'focusSite':
      return s.sites.some((x) => x.id === a.id) ? { ...s, focusedSiteId: a.id } : s
    case 'setLanding':
      return Number.isFinite(a.landingMs) ? retime(s, { landingMs: a.landingMs }) : s
    case 'setDuration':
      return Number.isFinite(a.durationH)
        ? retime(s, { durationH: clamp(a.durationH, DURATION_RANGE_H.min, DURATION_RANGE_H.max) })
        : s
    case 'setSlip':
      return Number.isFinite(a.slipH) ? retime(s, { slipH: clamp(a.slipH, SLIP_RANGE_H.min, SLIP_RANGE_H.max) }) : s
    case 'setObserverHeight':
      return isObserverHeight(a.heightM) ? { ...s, observerHeightM: a.heightM } : s
    case 'setSunThreshold':
      return Number.isFinite(a.value) ? { ...s, sunThreshold: clamp(a.value, 0, 1) } : s
    case 'setEarthMargin':
      return Number.isFinite(a.deg)
        ? { ...s, earthMarginDeg: clamp(a.deg, EARTH_MARGIN_RANGE_DEG.min, EARTH_MARGIN_RANGE_DEG.max) }
        : s
    case 'setCursor':
      return Number.isFinite(a.cursorMs) ? { ...s, cursorMs: clampCursor(s, a.cursorMs) } : s
    case 'setMapLayer':
      return isMapLayer(a.layer) ? { ...s, mapLayer: a.layer } : s
    case 'replace':
      return normalize(a.state, s)
  }
}

/** Defaults: spec values, the first two curated sites, cursor at landing. */
export function createInitialState({ sites, landingMs = DEFAULT_LANDING_MS }: { sites: readonly Site[]; landingMs?: number }): ScenarioState {
  const picked: ScenarioSite[] = sites.slice(0, 2).map((x) => ({ kind: 'curated', id: x.id }))
  return {
    sites: picked,
    focusedSiteId: picked[0]?.id ?? null,
    landingMs,
    durationH: DEFAULT_DURATION_H,
    slipH: 0,
    observerHeightM: DEFAULT_OBSERVER_HEIGHT_M,
    sunThreshold: DEFAULT_VISIBILITY_OPTS.sunThreshold,
    earthMarginDeg: DEFAULT_VISIBILITY_OPTS.earthMarginDeg,
    cursorMs: landingMs,
    mapLayer: 'pgda-sun',
  }
}

// --- React binding -----------------------------------------------------------------
// State and dispatch live in separate contexts so dispatch-only components don't re-render.

const StateContext = createContext<ScenarioState | null>(null)
const DispatchContext = createContext<Dispatch<ScenarioAction> | null>(null)

export function ScenarioProvider({ initialState, children }: { initialState: ScenarioState; children: ReactNode }) {
  const [state, dispatch] = useReducer(scenarioReducer, initialState)
  return createElement(
    DispatchContext.Provider,
    { value: dispatch },
    createElement(StateContext.Provider, { value: state }, children),
  )
}

export function useScenario(): ScenarioState {
  const s = useContext(StateContext)
  if (!s) throw new Error('useScenario must be used inside <ScenarioProvider>')
  return s
}

export function useScenarioDispatch(): Dispatch<ScenarioAction> {
  const d = useContext(DispatchContext)
  if (!d) throw new Error('useScenarioDispatch must be used inside <ScenarioProvider>')
  return d
}
