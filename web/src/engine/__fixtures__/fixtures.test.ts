import { describe, expect, it } from 'vitest'
import type { MissionMetrics, Window } from '../types'
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
    const nullable = (k: keyof MissionMetrics & ('firstSunsetH' | 'firstEarthsetH')) => {
      const [a, b] = [baseline[k], slipped[k]]
      return a === null || b === null ? null : b - a
    }
    expect(metricDelta.firstSunsetH).toBe(nullable('firstSunsetH'))
    expect(metricDelta.firstEarthsetH).toBe(nullable('firstEarthsetH'))
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
