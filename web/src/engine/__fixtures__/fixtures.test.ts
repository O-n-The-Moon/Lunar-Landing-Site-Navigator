import { describe, expect, it } from 'vitest'
import type { EventDelta, Window } from '../types'
import {
  fixtureEphemeris,
  fixtureGrid,
  fixtureGridScores,
  fixtureOutputs,
  fixturePgdaLayers,
  fixtureScenario,
  fixtureSitesFile,
  fixtureValidation,
} from './index'

const H_MS = 3_600_000

// Independent re-statements of the SPEC-engine metric definitions, to catch generator regressions.
const onMs = (ws: Window[], a: number, b: number) =>
  ws.reduce((sum, w) => sum + Math.max(0, Math.min(w.endMs, b) - Math.max(w.startMs, a)), 0)

function longestGapMs(ws: Window[], a: number, b: number): number {
  const on = ws.filter((w) => w.endMs > a && w.startMs < b)
  const edges = [a, ...on.flatMap((w) => [Math.max(w.startMs, a), Math.min(w.endMs, b)]), b]
  let longest = 0
  for (let i = 0; i < edges.length; i += 2) longest = Math.max(longest, edges[i + 1] - edges[i])
  return longest
}

function firstSetH(ws: Window[], a: number, b: number): number | null {
  const ends = ws.filter((w) => !w.clippedEnd && w.endMs > a && w.endMs < b).map((w) => w.endMs)
  return ends.length ? Math.round(((Math.min(...ends) - a) / H_MS) * 1e4) / 1e4 : null
}

function expectedEventDelta(a: number | null, b: number | null): EventDelta {
  if (a === null && b === null) return { deltaH: null, change: 'none' }
  if (a === null) return { deltaH: null, change: 'appeared' }
  if (b === null) return { deltaH: null, change: 'disappeared' }
  const deltaH = Math.round((b - a) * 1e4) / 1e4
  return { deltaH, change: deltaH === 0 ? 'none' : 'shifted' }
}

describe('contract fixtures', () => {
  it('ephemeris covers 48 h hourly with Sun at ~1 AU and Earth at ~383,000 km', () => {
    expect(fixtureEphemeris.count).toBe(49)
    expect(fixtureEphemeris.positionsKm).toHaveLength(49 * 2 * 3)
    const norm = (o: number) => Math.hypot(...fixtureEphemeris.positionsKm.subarray(o, o + 3))
    expect(norm(0) / 1.4855e8).toBeCloseTo(1, 4)
    expect(norm(3) / 383_000).toBeCloseTo(1, 4)
  })

  it('sites parse with masks for every listed height', () => {
    expect(fixtureSitesFile.sites.map((s) => s.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    for (const site of fixtureSitesFile.sites) {
      expect(Object.keys(site.horizonElevDeg).sort()).toEqual(['10', '2'])
    }
  })

  it('grid is 8 × 8 × 360 with exactly one no-data cell (ix 7, iy 7)', () => {
    const { nx, ny, azBins } = fixtureGrid.manifest
    expect(fixtureGrid.horizonsU8).toHaveLength(nx * ny * azBins)
    expect(fixtureGrid.surfaceHeightM).toHaveLength(nx * ny)
    const noDataCells = Array.from({ length: nx * ny }, (_, c) => c).filter((c) =>
      fixtureGrid.horizonsU8.subarray(c * azBins, (c + 1) * azBins).every((v) => v === 255),
    )
    expect(noDataCells).toEqual([7 * nx + 7])
  })

  it('fixture-ridge lies inside the grid extent (for snapping and marker tests)', () => {
    const { originKm, cellKm, nx, ny, sphereRadiusKm } = fixtureGrid.manifest
    const ridge = fixtureSitesFile.sites.find((s) => s.id === 'fixture-ridge')
    const colatRad = ((90 + (ridge?.latDeg ?? 0)) * Math.PI) / 180
    const rhoKm = 2 * sphereRadiusKm * Math.tan(colatRad / 2)
    expect(rhoKm).toBeLessThan(Math.min(-originKm[0], -originKm[1], originKm[0] + nx * cellKm, originKm[1] + ny * cellKm))
  })

  it('PGDA layers share the grid extent', () => {
    const { originKm, cellKm, nx, ny } = fixtureGrid.manifest
    expect(fixturePgdaLayers).toMatchObject({ originKm, cellKm, nx, ny })
  })

  it('validation summaries agree with their rows', () => {
    const { horizons, pgda } = fixtureValidation
    expect(horizons?.summary.n).toBe(horizons?.rows.length)
    expect(horizons?.summary.maxAzErrDeg).toBe(Math.max(...(horizons?.rows.map((r) => r.azErrDeg) ?? [])))
    const outliers = pgda?.rows.filter((r) => Math.abs(r.sunDiffPp) > 5 || Math.abs(r.earthDiffPp) > 5) ?? []
    expect(outliers.length).toBeGreaterThan(0)
    for (const r of outliers) expect(r.explanation).toBeTruthy()
    expect(pgda?.summary.sitesWithinThreshold).toBe((pgda?.rows.length ?? 0) - outliers.length)
  })

  it('validation carries pass/fail targets and the PGDA method, with one passing and one failing summary', () => {
    const { horizons, pgda } = fixtureValidation
    expect(horizons?.summary.targetMaxErrDeg).toBe(0.02)
    expect(pgda?.summary.targetFractionWithin).toBe(0.8)
    expect(pgda?.method?.observerHeightM).toBe(0)
    expect(pgda?.method?.claimLabel).toMatch(/any-disc definition, surface level assumed/)
    expect(Math.max(horizons!.summary.maxAzErrDeg, horizons!.summary.maxElevErrDeg)).toBeLessThanOrEqual(0.02)
    expect(pgda!.summary.sitesWithinThreshold / pgda!.summary.sitesTotal).toBeLessThan(0.8)
  })
})

describe('output fixtures', () => {
  const sites = Object.entries(fixtureOutputs)

  it('cover every fixture site', () => {
    expect(sites.map(([id]) => id)).toEqual(fixtureSitesFile.sites.map((s) => s.id))
  })

  it.each(sites)('%s: samples are parallel 10-min series over the scenario range', (_, { samples }) => {
    const n = (fixtureScenario.endMs - fixtureScenario.startMs) / (10 * 60_000) + 1
    for (const key of ['tUtcMs', 'sunAzDeg', 'sunElevDeg', 'sunHorizonDeg', 'sunFraction', 'earthAzDeg', 'earthElevDeg', 'earthHorizonDeg'] as const) {
      expect(samples[key]).toHaveLength(n)
    }
    expect(samples.tUtcMs[0]).toBe(fixtureScenario.startMs)
    expect(samples.tUtcMs[n - 1]).toBe(fixtureScenario.endMs)
    expect(samples.sunFraction.every((f) => f >= 0 && f <= 1)).toBe(true)
  })

  const inside = (w: Window, outer: Window[]) => outer.some((o) => o.startMs <= w.startMs && w.endMs <= o.endMs)

  it.each(sites)('%s: windows are ordered, inside the range, and both ⊆ sun ∩ earth', (_, { windows }) => {
    for (const list of [windows.sun, windows.earth, windows.both]) {
      list.forEach((w, i) => {
        expect(w.startMs).toBeLessThan(w.endMs)
        expect(w.startMs).toBeGreaterThanOrEqual(fixtureScenario.startMs)
        expect(w.endMs).toBeLessThanOrEqual(fixtureScenario.endMs)
        if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(list[i - 1].endMs)
      })
    }
    for (const w of windows.both) {
      expect(inside(w, windows.sun)).toBe(true)
      expect(inside(w, windows.earth)).toBe(true)
    }
  })

  it.each(sites)('%s: metrics are in range and the delta is slipped − baseline', (_, { metrics, metricDelta }) => {
    const { baseline, slipped } = metrics
    expect(slipped.landingMs - baseline.landingMs).toBe(fixtureScenario.slipH * H_MS)
    for (const m of [baseline, slipped]) {
      for (const pct of [m.sunlitPct, m.earthPct, m.bothPct]) expect(pct).toBeGreaterThanOrEqual(0)
      for (const pct of [m.sunlitPct, m.earthPct, m.bothPct]) expect(pct).toBeLessThanOrEqual(100)
      expect(m.bothPct).toBeLessThanOrEqual(Math.min(m.sunlitPct, m.earthPct) + 1e-9)
    }
    const numeric = ['sunlitPct', 'earthPct', 'bothPct', 'longestSunGapH', 'longestEarthGapH', 'meanSunFraction'] as const
    for (const k of numeric) expect(metricDelta[k]).toBeCloseTo(slipped[k] - baseline[k], 3)
    for (const k of ['firstSunsetH', 'firstEarthsetH'] as const) {
      expect(metricDelta[k]).toEqual(expectedEventDelta(baseline[k], slipped[k]))
    }
  })

  it.each(sites)('%s: metrics match a recomputation from the windows', (_, { windows, metrics }) => {
    for (const m of Object.values(metrics)) {
      const [a, b] = [m.landingMs, m.landingMs + m.durationH * H_MS]
      const pct = (ws: Window[]) => (100 * onMs(ws, a, b)) / (b - a)
      expect(m.sunlitPct).toBeCloseTo(pct(windows.sun), 3)
      expect(m.earthPct).toBeCloseTo(pct(windows.earth), 3)
      expect(m.bothPct).toBeCloseTo(pct(windows.both), 3)
      expect(m.longestSunGapH).toBeCloseTo(longestGapMs(windows.sun, a, b) / H_MS, 3)
      expect(m.longestEarthGapH).toBeCloseTo(longestGapMs(windows.earth, a, b) / H_MS, 3)
      expect(m.firstSunsetH).toBe(firstSetH(windows.sun, a, b))
      expect(m.firstEarthsetH).toBe(firstSetH(windows.earth, a, b))
    }
  })

  it('the plateau shows the slip story: Earth never sets at baseline, sets after the slip', () => {
    expect(fixtureOutputs['fixture-plateau'].metricDelta.firstEarthsetH.change).toBe('appeared')
  })

  it.each(sites)('%s: ctx carries the fixture ephemeris, a unit ENU frame and the 2 m mask', (id, { ctx, samples }) => {
    expect(samples.ctx).toBe(ctx)
    expect(ctx.eph).toBe(fixtureEphemeris)
    for (const v of [ctx.frame.east, ctx.frame.north, ctx.frame.up]) expect(Math.hypot(...v)).toBeCloseTo(1, 9)
    expect(ctx.horizonMaskDeg).toBe(fixtureSitesFile.sites.find((s) => s.id === id)?.horizonElevDeg['2'])
  })

  it('exercise sunsets, an Earthset and an Earthrise somewhere', () => {
    const all = sites.map(([, o]) => o)
    expect(all.some((o) => o.windows.sun.some((w) => !w.clippedEnd))).toBe(true)
    expect(all.some((o) => o.windows.earth.some((w) => !w.clippedEnd))).toBe(true)
    expect(all.some((o) => o.windows.earth.some((w) => !w.clippedStart))).toBe(true)
  })

  it('grid scores are ny × nx with NaN only at the no-data cell', () => {
    const { nx, ny } = fixtureGrid.manifest
    for (const arr of [fixtureGridScores.sunPct, fixtureGridScores.earthPct, fixtureGridScores.bothPct]) {
      expect(arr).toHaveLength(nx * ny)
      const nan = Array.from(arr.keys()).filter((i) => Number.isNaN(arr[i]))
      expect(nan).toEqual([7 * nx + 7])
    }
  })
})
