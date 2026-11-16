import { describe, expect, it } from 'vitest'
import { fixtureEphemeris, fixtureGrid, fixtureGridScores } from './__fixtures__'
import { MOON_RADIUS_KM, siteFrame } from './geometry'
import { gridSiteContext, nearestGridCell, scoreGrid } from './grid'
import { DEFAULT_VISIBILITY_OPTS } from './types'
import type { Grid, GridManifest, VisibilityOpts } from './types'
import { sampleSite, sunHysteresisLevels } from './windows'

const H_MS = 3_600_000
const DEG = Math.PI / 180
const T0 = fixtureEphemeris.startUtcMs
/** The fixture ephemeris covers [T0, T0 + 48 h]. */
const T_END = T0 + 48 * H_MS

/** Inverse south polar stereographic, as the pipeline uses it (x = ρ sin lon, y = ρ cos lon, ρ = 2R tan(c/2)). */
function mapKmToLatLon(xKm: number, yKm: number): { latDeg: number; lonDeg: number } {
  const c = 2 * Math.atan(Math.hypot(xKm, yKm) / (2 * MOON_RADIUS_KM))
  return { latDeg: -90 + c / DEG, lonDeg: Math.atan2(xKm, yKm) / DEG }
}

/** Fixture grid: originKm [-8, -8], cellKm 2, so cell (ix, iy) is centered at (-7 + 2 ix, -7 + 2 iy) km. */
const fixtureCellCenter = (ix: number, iy: number) => mapKmToLatLon(-7 + 2 * ix, -7 + 2 * iy)

describe('nearestGridCell', () => {
  it('snaps a cell center to that cell with ~0 km snap distance', () => {
    const { latDeg, lonDeg } = fixtureCellCenter(2, 5)
    const cell = nearestGridCell(fixtureGrid, latDeg, lonDeg)
    expect(cell).not.toBeNull()
    expect(cell?.ix).toBe(2)
    expect(cell?.iy).toBe(5)
    expect(cell?.snapDistKm).toBeLessThan(1e-6)
  })

  it('snaps the pole to the cell whose lower-left corner is the pole, √2 km away', () => {
    const cell = nearestGridCell(fixtureGrid, -90, 0)
    expect(cell).toMatchObject({ ix: 4, iy: 4 })
    expect(cell?.snapDistKm).toBeCloseTo(Math.SQRT2, 3)
  })

  it('treats longitude 315° like −45° (east-positive, wraps)', () => {
    const { latDeg } = fixtureCellCenter(2, 5) // the (−3, 3) km cell sits at lon −45°
    expect(nearestGridCell(fixtureGrid, latDeg, 315)).toEqual(nearestGridCell(fixtureGrid, latDeg, -45))
  })

  it('returns the great-circle distance to the cell center', () => {
    const center = fixtureCellCenter(3, 3) // (−1, −1) km
    const point = mapKmToLatLon(-1.6, -0.5) // same cell, 0.6 km west and 0.5 km north on the map
    const cell = nearestGridCell(fixtureGrid, point.latDeg, point.lonDeg)
    expect(cell).toMatchObject({ ix: 3, iy: 3 })
    // Near the pole the stereographic scale is ~1, so the map distance is a close check.
    expect(cell?.snapDistKm).toBeCloseTo(Math.hypot(0.6, 0.5), 3)
    expect(center.latDeg).toBeLessThan(-89.9)
  })

  it('returns null outside the grid extent', () => {
    expect(nearestGridCell(fixtureGrid, -85, 0)).toBeNull()
    expect(nearestGridCell(fixtureGrid, 45, 10)).toBeNull()
    expect(nearestGridCell(fixtureGrid, 90, 0)).toBeNull()
  })

  it('returns null for a no-data cell (no terrain horizon there)', () => {
    const { latDeg, lonDeg } = fixtureCellCenter(7, 7)
    expect(nearestGridCell(fixtureGrid, latDeg, lonDeg)).toBeNull()
  })

  it('throws RangeError for non-finite or out-of-range coordinates', () => {
    expect(() => nearestGridCell(fixtureGrid, NaN, 0)).toThrow(RangeError)
    expect(() => nearestGridCell(fixtureGrid, -89, Infinity)).toThrow(RangeError)
    expect(() => nearestGridCell(fixtureGrid, -91, 0)).toThrow(RangeError)
  })
})

describe('gridSiteContext', () => {
  it('builds the frame at the cell center, on the cell surface height, at the grid observer height', () => {
    const ctx = gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 3, iy: 4 })
    const { latDeg, lonDeg } = fixtureCellCenter(3, 4)
    const heightM = fixtureGrid.surfaceHeightM[4 * 8 + 3] // 1000 + 25·3 − 10·4 = 1035 in the fixture
    expect(heightM).toBe(1035)
    const expected = siteFrame(latDeg, lonDeg, heightM, 2)
    expect(ctx.observerHeightM).toBe(2)
    expect(ctx.eph).toBe(fixtureEphemeris)
    ctx.frame.positionKm.forEach((v, k) => expect(v).toBeCloseTo(expected.positionKm[k], 9))
    expect(ctx.frame.latDeg).toBeCloseTo(expected.latDeg, 9)
    expect(ctx.frame.lonDeg).toBeCloseTo(expected.lonDeg, 9)
  })

  it('decodes the cell horizon (v · 0.1 − 5) into a 360-bin mask at 1° steps', () => {
    const ctx = gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 3, iy: 4 })
    const base = (4 * 8 + 3) * 360
    expect(ctx.azStepDeg).toBe(1)
    expect(ctx.horizonMaskDeg.length).toBe(360)
    for (const i of [0, 90, 359]) {
      expect(ctx.horizonMaskDeg[i]).toBeCloseTo(fixtureGrid.horizonsU8[base + i] * 0.1 - 5, 9)
    }
  })

  it('gives a context the time-series functions accept', () => {
    const ctx = gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 0, iy: 0 })
    const s = sampleSite(ctx, T0, T0 + 2 * H_MS)
    expect(s.sunFraction.every((f) => f >= 0 && f <= 1)).toBe(true)
  })

  it('throws RangeError for a no-data cell or an index outside the grid', () => {
    expect(() => gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 7, iy: 7 })).toThrow(RangeError)
    expect(() => gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 8, iy: 0 })).toThrow(RangeError)
    expect(() => gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 0, iy: -1 })).toThrow(RangeError)
    expect(() => gridSiteContext(fixtureEphemeris, fixtureGrid, { ix: 1.5, iy: 0 })).toThrow(RangeError)
  })
})

/**
 * Straightforward per-cell reference for scoreGrid: hourly samples from the cell's own context (via sampleSite),
 * up to 48 whole hours of lead-in, the windowsFromSeries hysteresis rule on the samples, and each sample from
 * startMs on weighted by the part of its hour inside [startMs, endMs).
 */
function referenceCellScores(
  grid: Grid,
  ix: number,
  iy: number,
  startMs: number,
  endMs: number,
  opts: VisibilityOpts,
  { leadIn = true } = {},
) {
  const ctx = gridSiteContext(fixtureEphemeris, grid, { ix, iy })
  const preH = leadIn ? Math.min(48, Math.floor((startMs - fixtureEphemeris.startUtcMs) / H_MS)) : 0
  const n = Math.ceil((endMs - startMs) / H_MS)
  const s = sampleSite(ctx, startMs - preH * H_MS, startMs + (n - 1) * H_MS, 60)
  const { onFraction, offFraction } = sunHysteresisLevels(opts)
  const earthOn = opts.earthHysteresisDeg
  const earthOff = -opts.earthHysteresisDeg
  const clearance = (i: number) => s.earthElevDeg[i] - s.earthHorizonDeg[i] - opts.earthMarginDeg
  let sun = s.sunFraction[0] >= (onFraction + offFraction) / 2
  let earth = clearance(0) >= (earthOn + earthOff) / 2
  const pct = { sun: 0, earth: 0, both: 0 }
  for (let i = 0; i < s.tUtcMs.length; i++) {
    const f = s.sunFraction[i]
    const c = clearance(i)
    if (i > 0) {
      if (!sun && f >= onFraction) sun = true
      else if (sun && f <= offFraction && f < onFraction) sun = false
      if (!earth && c >= earthOn) earth = true
      else if (earth && c <= earthOff && c < earthOn) earth = false
    }
    if (i < preH) continue
    const t = s.tUtcMs[i]
    const w = (100 * (Math.min(t + H_MS, endMs) - t)) / (endMs - startMs)
    if (sun) pct.sun += w
    if (earth) pct.earth += w
    if (sun && earth) pct.both += w
  }
  return pct
}

describe('scoreGrid', () => {
  it('returns ny × nx row-major Float32 scores for the requested range', () => {
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, DEFAULT_VISIBILITY_OPTS)
    expect(scores).toMatchObject({ startMs: T0, endMs: T_END, nx: 8, ny: 8 })
    for (const a of [scores.sunPct, scores.earthPct, scores.bothPct]) {
      expect(a).toBeInstanceOf(Float32Array)
      expect(a.length).toBe(64)
    }
  })

  it('gives NaN for a no-data cell and finite 0–100 % elsewhere', () => {
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, DEFAULT_VISIBILITY_OPTS)
    const noData = 7 * 8 + 7
    for (const a of [scores.sunPct, scores.earthPct, scores.bothPct]) {
      expect(a[noData]).toBeNaN()
      a.forEach((v, i) => {
        if (i !== noData) expect(v >= 0 && v <= 100).toBe(true)
      })
    }
  })

  it('at default options, matches the fixture scores (generate.mjs writes them with scoreGrid)', () => {
    const opts = DEFAULT_VISIBILITY_OPTS
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, fixtureGridScores.startMs, fixtureGridScores.endMs, opts)
    for (const key of ['sunPct', 'earthPct', 'bothPct'] as const) {
      fixtureGridScores[key].forEach((want, i) => {
        if (Number.isNaN(want)) expect(scores[key][i]).toBeNaN()
        else expect(scores[key][i]).toBeCloseTo(want, 2)
      })
    }
  })

  it('matches a per-cell reference with hysteresis, a 12 h lead-in and an off-step end', () => {
    const opts: VisibilityOpts = { sunThreshold: 0.5, hysteresis: 0.2, earthMarginDeg: 1, earthHysteresisDeg: 0.5 }
    const startMs = T0 + 12 * H_MS
    const endMs = T0 + 36.5 * H_MS
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, startMs, endMs, opts)
    for (let iy = 0; iy < 8; iy++) {
      for (let ix = 0; ix < 8; ix++) {
        if (ix === 7 && iy === 7) continue
        const want = referenceCellScores(fixtureGrid, ix, iy, startMs, endMs, opts)
        const c = iy * 8 + ix
        expect(scores.sunPct[c]).toBeCloseTo(want.sun, 3)
        expect(scores.earthPct[c]).toBeCloseTo(want.earth, 3)
        expect(scores.bothPct[c]).toBeCloseTo(want.both, 3)
      }
    }
  })

  it('takes the state at startMs from the lead-in, not the band-midpoint seed', () => {
    // threshold 0.5 ± 0.5: on at 1 (fully visible), off at 0 (fully hidden). Anything in between keeps the state.
    const opts: VisibilityOpts = { ...DEFAULT_VISIBILITY_OPTS, sunThreshold: 0.5, hysteresis: 0.5 }
    const startMs = T0 + 24 * H_MS
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, startMs, T_END, opts)
    let cellsWhereLeadInMatters = 0
    for (let c = 0; c < 63; c++) {
      const want = referenceCellScores(fixtureGrid, c % 8, Math.floor(c / 8), startMs, T_END, opts)
      expect(scores.sunPct[c]).toBeCloseTo(want.sun, 3)
      const seededAtStart = referenceCellScores(fixtureGrid, c % 8, Math.floor(c / 8), startMs, T_END, opts, { leadIn: false })
      if (Math.abs(seededAtStart.sun - want.sun) > 1e-3) cellsWhereLeadInMatters++
    }
    // Guards the test itself: the fixture must contain cells whose state at startMs depends on the lead-in.
    expect(cellsWhereLeadInMatters).toBeGreaterThan(0)
  })

  it('never scores "both" above Sun or Earth', () => {
    const scores = scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, DEFAULT_VISIBILITY_OPTS)
    scores.bothPct.forEach((b, i) => {
      if (Number.isNaN(b)) return
      expect(b).toBeLessThanOrEqual(Math.min(scores.sunPct[i], scores.earthPct[i]) + 1e-4)
    })
  })

  it('reports monotonic progress ending at 1', () => {
    const seen: number[] = []
    scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, DEFAULT_VISIBILITY_OPTS, (f) => seen.push(f))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(1)
    seen.forEach((f, i) => i > 0 && expect(f).toBeGreaterThanOrEqual(seen[i - 1]))
  })

  it('does not mutate the grid or the ephemeris', () => {
    const horizons = fixtureGrid.horizonsU8.slice()
    const heights = fixtureGrid.surfaceHeightM.slice()
    const positions = fixtureEphemeris.positionsKm.slice()
    scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, DEFAULT_VISIBILITY_OPTS)
    expect(fixtureGrid.horizonsU8).toEqual(horizons)
    expect(fixtureGrid.surfaceHeightM).toEqual(heights)
    expect(fixtureEphemeris.positionsKm).toEqual(positions)
  })

  // Opt-in bench (SPEC-engine → Performance: full grid, 30 days, ≤ 3 s). Loads the real 11 MB grid, so it is not
  // part of `npm test`. Run: GRID_BENCH=1 npx vitest run src/engine/grid.test.ts -t bench
  it.runIf(import.meta.env.GRID_BENCH)('bench: full real grid, 30-day window in ≤ 3 s', async () => {
    const [{ realEphemeris: eph }, { dataUrlToArrayBuffer }, horizonsBin, heightsBin, gridJson, { loadGrid }] = await Promise.all([
      import('./__fixtures__/real-data'),
      import('./__fixtures__/data-url'),
      import('../../public/data/grid-horizons.bin?inline'),
      import('../../public/data/grid-heights.bin?inline'),
      import('../../public/data/grid.json'),
      import('./loaders'),
    ])
    const grid = loadGrid(gridJson.default as GridManifest, dataUrlToArrayBuffer(horizonsBin.default), dataUrlToArrayBuffer(heightsBin.default))
    const startMs = Date.UTC(2027, 2, 1)
    const endMs = startMs + 30 * 24 * H_MS
    scoreGrid(grid, eph, startMs, endMs, DEFAULT_VISIBILITY_OPTS) // warm-up (JIT)
    const t0 = performance.now()
    const scores = scoreGrid(grid, eph, startMs, endMs, DEFAULT_VISIBILITY_OPTS)
    const elapsedMs = performance.now() - t0
    console.log(`scoreGrid ${grid.manifest.nx}×${grid.manifest.ny} × 30 d: ${elapsedMs.toFixed(0)} ms`)
    expect(scores.sunPct.some((v) => v > 0)).toBe(true)
    expect(elapsedMs).toBeLessThanOrEqual(3000)
  }, 60_000)

  it('throws RangeError for an empty or inverted range, a range outside the ephemeris, or bad options', () => {
    const o = DEFAULT_VISIBILITY_OPTS
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0, T0, o)).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0 + H_MS, T0, o)).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0 - H_MS, T0 + H_MS, o)).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END + H_MS, o)).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, NaN, T_END, o)).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, { ...o, sunThreshold: 1.5 })).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, { ...o, hysteresis: -1 })).toThrow(RangeError)
    expect(() => scoreGrid(fixtureGrid, fixtureEphemeris, T0, T_END, { ...o, earthMarginDeg: NaN })).toThrow(RangeError)
  })
})
