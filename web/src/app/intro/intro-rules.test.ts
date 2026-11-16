import { describe, expect, it } from 'vitest'
import { bootLines, FADE_MS, FLY_MS, INTRO_MS, introCamera, shouldPlayIntro, visibleBootLines, type BootCounts } from './intro-rules'

const ok = { search: '', reducedMotion: false, webgl: true, fixtures: false }

describe('shouldPlayIntro', () => {
  it('plays on real data with WebGL and normal motion', () => {
    expect(shouldPlayIntro(ok)).toBe(true)
    expect(shouldPlayIntro({ ...ok, search: '?site=x&layer=sun' })).toBe(true)
  })

  it('is skipped by ?nointro, however it is written', () => {
    expect(shouldPlayIntro({ ...ok, search: '?nointro' })).toBe(false)
    expect(shouldPlayIntro({ ...ok, search: '?nointro=1' })).toBe(false)
    expect(shouldPlayIntro({ ...ok, search: '?a=1&nointro' })).toBe(false)
  })

  it('is skipped for reduced motion, without WebGL and on fixture data', () => {
    expect(shouldPlayIntro({ ...ok, reducedMotion: true })).toBe(false)
    expect(shouldPlayIntro({ ...ok, webgl: false })).toBe(false)
    expect(shouldPlayIntro({ ...ok, fixtures: true })).toBe(false)
  })
})

describe('timing', () => {
  it('fits the 4.5 s budget, with the camera arriving before the fade', () => {
    expect(INTRO_MS).toBeLessThanOrEqual(4500)
    expect(FLY_MS + FADE_MS).toBe(INTRO_MS)
  })
})

describe('introCamera', () => {
  it('starts low and far, ends high and near over the pole, and holds there', () => {
    const a = introCamera(0)
    const b = introCamera(FLY_MS)
    expect(b.elevDeg).toBeGreaterThan(a.elevDeg)
    expect(b.distKm).toBeLessThan(a.distKm)
    expect(introCamera(INTRO_MS)).toEqual(b)
    expect(introCamera(-100)).toEqual(a)
  })

  it('moves monotonically (no back-and-forth)', () => {
    let prev = introCamera(0)
    for (let t = 100; t <= FLY_MS; t += 100) {
      const c = introCamera(t)
      expect(c.elevDeg).toBeGreaterThanOrEqual(prev.elevDeg)
      expect(c.distKm).toBeLessThanOrEqual(prev.distKm)
      prev = c
    }
  })

  it('stays above the surface', () => {
    for (let t = 0; t <= INTRO_MS; t += 50) expect(introCamera(t).distKm).toBeGreaterThan(1737.4 + 500)
  })
})

describe('boot log', () => {
  const counts: BootCounts = {
    epochs: 61368,
    stepS: 3600,
    sites: 12,
    terrainGrid: { nx: 182, ny: 182, cellKm: 2 },
    horizons: { status: 'ready', azBins: 360 },
  }

  it('reads every number from the counts it is given', () => {
    const text = bootLines(counts).map((l) => l.text)
    expect(text[0]).toBe('EPHEMERIS · 61,368 epochs · 1 h steps')
    expect(text[1]).toBe('SITES · 12 curated')
    expect(text[2]).toBe('TERRAIN · 182×182 cells · 2 km')
    expect(text[3]).toBe('HORIZONS · 360 azimuth bins per cell · ready')
    const other = bootLines({ ...counts, epochs: 49, sites: 3, terrainGrid: { nx: 5, ny: 6, cellKm: 1 } }).map((l) => l.text)
    expect(other[0]).toContain('49 epochs')
    expect(other[1]).toContain('3 curated')
    expect(other[2]).toContain('5×6 cells · 1 km')
  })

  it('says what is still loading instead of claiming it is ready', () => {
    expect(bootLines({ ...counts, terrainGrid: null })[2].text).toBe('TERRAIN · loading')
    expect(bootLines({ ...counts, horizons: { status: 'idle' } })[3].text).toBe('HORIZONS · queued')
    expect(bootLines({ ...counts, horizons: { status: 'loading', progress: 0.347 } })[3].text).toBe('HORIZONS · downloading 35 %')
    expect(bootLines({ ...counts, horizons: { status: 'loading', progress: null } })[3].text).toBe('HORIZONS · downloading')
    expect(bootLines({ ...counts, horizons: { status: 'error' } })[3].text).toBe('HORIZONS · could not load')
  })

  it('reveals lines in order as time passes', () => {
    const lines = bootLines(counts)
    expect(visibleBootLines(lines, 0)).toHaveLength(1)
    expect(visibleBootLines(lines, 1200)).toHaveLength(3)
    expect(visibleBootLines(lines, INTRO_MS)).toHaveLength(4)
    expect(lines[lines.length - 1].atMs).toBeLessThan(FLY_MS)
  })
})
