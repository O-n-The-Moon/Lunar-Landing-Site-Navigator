import { describe, expect, it } from 'vitest'
import { fixtureSitesFile } from '../engine/__fixtures__'
import {
  DEFAULT_DURATION_H,
  DEFAULT_LANDING_MS,
  HOUR_MS,
  MAP_LAYERS,
  MAX_SITES,
  SLIP_RANGE_H,
  createInitialState,
  missionEndMs,
  scenarioReducer,
  slippedLandingMs,
  type MapLayer,
  type ScenarioAction,
  type ScenarioState,
} from './state'

const [plateau, ridge] = fixtureSitesFile.sites
const cell = (ix: number, iy: number) => ({ ix, iy, snapDistKm: 0.8 })

function run(state: ScenarioState, ...actions: ScenarioAction[]): ScenarioState {
  return actions.reduce(scenarioReducer, state)
}

const empty = createInitialState({ sites: [] })

describe('createInitialState', () => {
  it('uses spec defaults and focuses the first of up to two curated sites', () => {
    const s = createInitialState({ sites: fixtureSitesFile.sites })
    expect(s.sites).toEqual([
      { kind: 'curated', id: plateau.id },
      { kind: 'curated', id: ridge.id },
    ])
    expect(s.focusedSiteId).toBe(plateau.id)
    expect(s.landingMs).toBe(DEFAULT_LANDING_MS)
    expect(s.durationH).toBe(DEFAULT_DURATION_H)
    expect(DEFAULT_DURATION_H).toBe(14 * 24)
    expect(s.slipH).toBe(0)
    expect(s.observerHeightM).toBe(2)
    expect(s.sunThreshold).toBe(0.5)
    expect(s.earthMarginDeg).toBe(1)
    expect(s.cursorMs).toBe(DEFAULT_LANDING_MS)
    expect(s.mapLayer).toBe('pgda-sun')
  })

  it('handles an empty catalog', () => {
    expect(empty.sites).toEqual([])
    expect(empty.focusedSiteId).toBeNull()
  })
})

describe('sites', () => {
  it('adds curated sites, focusing the first one added', () => {
    const s = run(empty, { type: 'addCuratedSite', id: 'a' }, { type: 'addCuratedSite', id: 'b' })
    expect(s.sites.map((x) => x.id)).toEqual(['a', 'b'])
    expect(s.focusedSiteId).toBe('a')
  })

  it('ignores duplicates and caps at MAX_SITES', () => {
    const s = run(
      empty,
      { type: 'addCuratedSite', id: 'a' },
      { type: 'addCuratedSite', id: 'a' },
      { type: 'addCuratedSite', id: 'b' },
      { type: 'addCuratedSite', id: 'c' },
      { type: 'addCuratedSite', id: 'd' },
    )
    expect(MAX_SITES).toBe(3)
    expect(s.sites.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds a custom site keyed by its grid cell, deduplicating the same cell', () => {
    const s = run(
      empty,
      { type: 'addCustomSite', latDeg: -85.12, lonDeg: 30.4, cell: cell(3, 4) },
      { type: 'addCustomSite', latDeg: -85.13, lonDeg: 30.41, cell: cell(3, 4) },
    )
    expect(s.sites).toEqual([{ kind: 'custom', id: 'custom-3-4', latDeg: -85.12, lonDeg: 30.4, cell: cell(3, 4) }])
    expect(s.focusedSiteId).toBe('custom-3-4')
  })

  it('rejects custom sites with out-of-range coordinates', () => {
    expect(run(empty, { type: 'addCustomSite', latDeg: -91, lonDeg: 0, cell: cell(0, 0) })).toBe(empty)
    expect(run(empty, { type: 'addCustomSite', latDeg: -85, lonDeg: 181, cell: cell(0, 0) })).toBe(empty)
  })

  it('removing the focused site moves focus to the first remaining site', () => {
    const base = run(empty, { type: 'addCuratedSite', id: 'a' }, { type: 'addCuratedSite', id: 'b' })
    const s = run(base, { type: 'removeSite', id: 'a' })
    expect(s.sites.map((x) => x.id)).toEqual(['b'])
    expect(s.focusedSiteId).toBe('b')
    expect(run(s, { type: 'removeSite', id: 'b' }).focusedSiteId).toBeNull()
  })

  it('focuses only sites in the scenario', () => {
    const base = run(empty, { type: 'addCuratedSite', id: 'a' }, { type: 'addCuratedSite', id: 'b' })
    expect(run(base, { type: 'focusSite', id: 'b' }).focusedSiteId).toBe('b')
    expect(run(base, { type: 'focusSite', id: 'zzz' })).toBe(base)
  })
})

describe('time controls', () => {
  it('derives the slipped landing and mission end', () => {
    const s = run(empty, { type: 'setSlip', slipH: 36 })
    expect(slippedLandingMs(s)).toBe(DEFAULT_LANDING_MS + 36 * HOUR_MS)
    expect(missionEndMs(s)).toBe(slippedLandingMs(s) + DEFAULT_DURATION_H * HOUR_MS)
  })

  it('clamps duration to 1–30 days and slip to −30…+90 days', () => {
    expect(run(empty, { type: 'setDuration', durationH: 1 }).durationH).toBe(24)
    expect(run(empty, { type: 'setDuration', durationH: 9999 }).durationH).toBe(720)
    expect(run(empty, { type: 'setSlip', slipH: -9999 }).slipH).toBe(SLIP_RANGE_H.min)
    expect(run(empty, { type: 'setSlip', slipH: 9999 }).slipH).toBe(SLIP_RANGE_H.max)
    expect(SLIP_RANGE_H).toEqual({ min: -720, max: 2160 })
  })

  it('ignores non-finite numbers', () => {
    expect(run(empty, { type: 'setLanding', landingMs: NaN })).toBe(empty)
    expect(run(empty, { type: 'setSlip', slipH: Infinity })).toBe(empty)
    expect(run(empty, { type: 'setDuration', durationH: NaN })).toBe(empty)
    expect(run(empty, { type: 'setCursor', cursorMs: NaN })).toBe(empty)
  })

  it('keeps the cursor at the same mission-elapsed time when the landing or slip moves', () => {
    const atT10 = run(empty, { type: 'setCursor', cursorMs: DEFAULT_LANDING_MS + 10 * HOUR_MS })
    const slipped = run(atT10, { type: 'setSlip', slipH: 48 })
    expect(slipped.cursorMs).toBe(slippedLandingMs(slipped) + 10 * HOUR_MS)
    const moved = run(slipped, { type: 'setLanding', landingMs: DEFAULT_LANDING_MS + 7 * 24 * HOUR_MS })
    expect(moved.cursorMs).toBe(slippedLandingMs(moved) + 10 * HOUR_MS)
  })

  it('clamps the cursor into the slipped mission window', () => {
    const late = run(empty, { type: 'setCursor', cursorMs: DEFAULT_LANDING_MS + 300 * HOUR_MS })
    expect(late.cursorMs).toBe(DEFAULT_LANDING_MS + 300 * HOUR_MS)
    expect(run(late, { type: 'setDuration', durationH: 48 }).cursorMs).toBe(DEFAULT_LANDING_MS + 48 * HOUR_MS)
    expect(run(empty, { type: 'setCursor', cursorMs: 0 }).cursorMs).toBe(DEFAULT_LANDING_MS)
  })
})

describe('options', () => {
  it('accepts only the published observer heights', () => {
    expect(run(empty, { type: 'setObserverHeight', heightM: 10 }).observerHeightM).toBe(10)
    expect(run(empty, { type: 'setObserverHeight', heightM: 5 as 2 })).toBe(empty)
  })

  it('clamps the Sun threshold to 0–1 and the Earth margin to 0–10°', () => {
    expect(run(empty, { type: 'setSunThreshold', value: 1.5 }).sunThreshold).toBe(1)
    expect(run(empty, { type: 'setSunThreshold', value: 0.25 }).sunThreshold).toBe(0.25)
    expect(run(empty, { type: 'setEarthMargin', deg: -1 }).earthMarginDeg).toBe(0)
    expect(run(empty, { type: 'setEarthMargin', deg: 2.5 }).earthMarginDeg).toBe(2.5)
  })

  it('sets the map layer', () => {
    expect(run(empty, { type: 'setMapLayer', layer: 'score-both' }).mapLayer).toBe('score-both')
    expect(run(empty, { type: 'setMapLayer', layer: 'nope' as MapLayer })).toBe(empty)
    expect(MAP_LAYERS).toEqual(['pgda-sun', 'pgda-earth', 'score-sun', 'score-earth', 'score-both'])
  })
})

describe('replace', () => {
  it('loads a whole scenario (URL sharing), re-applying every rule', () => {
    const next = run(empty, {
      type: 'replace',
      state: {
        ...empty,
        sites: [
          { kind: 'curated', id: 'a' },
          { kind: 'curated', id: 'a' },
          { kind: 'curated', id: 'b' },
          { kind: 'curated', id: 'c' },
          { kind: 'curated', id: 'd' },
        ],
        focusedSiteId: 'zzz',
        durationH: 5,
        slipH: 9999,
        cursorMs: 0,
      },
    })
    expect(next.sites.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(next.focusedSiteId).toBe('a')
    expect(next.durationH).toBe(24)
    expect(next.slipH).toBe(SLIP_RANGE_H.max)
    expect(next.cursorMs).toBe(slippedLandingMs(next))
  })

  it('drops malformed sites and fields from untrusted input (e.g. a shared URL) instead of throwing', () => {
    const untrusted = {
      ...empty,
      sites: [
        { kind: 'custom', id: 'x', latDeg: -85, lonDeg: 30 }, // no cell
        { kind: 'custom', id: 'x', latDeg: -85, lonDeg: 30, cell: { ix: 1.5, iy: 2, snapDistKm: 0.1 } },
        { kind: 'custom', id: 'x', latDeg: -85, lonDeg: 30, cell: { ix: -1, iy: 2, snapDistKm: 0.1 } },
        { kind: 'custom', id: 'x', latDeg: NaN, lonDeg: 30, cell: cell(1, 2) },
        { kind: 'weird', id: 'w' },
        { kind: 'curated', id: '' },
        { kind: 'curated', id: 7 },
        null,
        { kind: 'custom', id: 'ignored', latDeg: -85, lonDeg: 30, cell: cell(1, 2) },
      ],
      mapLayer: 'not-a-layer',
      observerHeightM: 5,
    } as unknown as ScenarioState
    const next = run(empty, { type: 'replace', state: untrusted })
    expect(next.sites).toEqual([{ kind: 'custom', id: 'custom-1-2', latDeg: -85, lonDeg: 30, cell: cell(1, 2) }])
    expect(next.mapLayer).toBe(empty.mapLayer)
    expect(next.observerHeightM).toBe(empty.observerHeightM)
  })

  it('survives a non-array sites field', () => {
    const next = run(empty, { type: 'replace', state: { ...empty, sites: 'a,b' } as unknown as ScenarioState })
    expect(next.sites).toEqual([])
    expect(next.focusedSiteId).toBeNull()
  })

  it('keeps a valid focused site that is not first', () => {
    const next = run(empty, {
      type: 'replace',
      state: { ...empty, sites: [{ kind: 'curated', id: 'a' }, { kind: 'curated', id: 'b' }], focusedSiteId: 'b' },
    })
    expect(next.focusedSiteId).toBe('b')
  })
})
