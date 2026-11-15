// Typed fixtures for building UI/viz before real data or engine math exist. Regenerate with generate.mjs.
import { loadEphemeris, loadGrid, parseSites } from '../loaders'
import type {
  DetectedWindows,
  EphemerisManifest,
  GridManifest,
  GridScores,
  MetricDelta,
  MissionMetrics,
  PgdaLayersManifest,
  SiteContext,
  SiteFrame,
  SiteSamples,
  ValidationFile,
  VisibilityOpts,
} from '../types'
import ephemerisBin from './ephemeris.bin?inline'
import ephemerisJson from './ephemeris.json'
import gridHeightsBin from './grid-heights.bin?inline'
import gridHorizonsBin from './grid-horizons.bin?inline'
import gridScoresJson from './grid-scores.json'
import gridJson from './grid.json'
import outputsJson from './outputs.json'
import pgdaEarthPngUrl from './pgda-earth.png'
import pgdaLayersJson from './pgda-layers.json'
import pgdaSunPngUrl from './pgda-sun.png'
import sitesJson from './sites.json'
import validationJson from './validation.json'

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// --- contract files ---------------------------------------------------------

export const fixtureEphemerisManifest = ephemerisJson as EphemerisManifest
export const fixtureEphemerisBin = (): ArrayBuffer => dataUrlToArrayBuffer(ephemerisBin)
/** 48 h hourly (49 samples) from 2026-03-01T00:00Z. */
export const fixtureEphemeris = loadEphemeris(fixtureEphemerisManifest, fixtureEphemerisBin())

/** Two synthetic sites: `fixture-plateau` and `fixture-ridge`. */
export const fixtureSitesFile = parseSites(sitesJson)

export const fixtureGridManifest = gridJson as GridManifest
export const fixtureGridHorizonsBin = (): ArrayBuffer => dataUrlToArrayBuffer(gridHorizonsBin)
export const fixtureGridHeightsBin = (): ArrayBuffer => dataUrlToArrayBuffer(gridHeightsBin)
/** 8 × 8 cells at 2 km around the pole; cell (ix 7, iy 7) has no data. */
export const fixtureGrid = loadGrid(fixtureGridManifest, fixtureGridHorizonsBin(), fixtureGridHeightsBin())

export const fixturePgdaLayers = pgdaLayersJson as PgdaLayersManifest
export const fixturePgdaPngUrls = { sun: pgdaSunPngUrl, earth: pgdaEarthPngUrl }

export const fixtureValidation = validationJson as ValidationFile

// --- output fixtures (what the engine would return) ---------------------------

export interface FixtureScenario {
  /** Range covered by the samples and windows. */
  startMs: number
  endMs: number
  baselineLandingMs: number
  slipH: number
  durationH: number
  observerHeightM: number
  opts: VisibilityOpts
}

export interface FixtureSiteOutputs {
  /** fixtureEphemeris + the site's frame and 2 m mask (frame stored by generate.mjs; siteFrame reproduces it). */
  ctx: SiteContext
  samples: SiteSamples
  windows: DetectedWindows
  metrics: { baseline: MissionMetrics; slipped: MissionMetrics }
  /** diffMetrics(baseline, slipped) */
  metricDelta: MetricDelta
}

type JsonSamples = {
  [K in Exclude<keyof SiteSamples, 'ctx'>]: SiteSamples[K] extends Float64Array ? number[] : SiteSamples[K]
}

function toSamples(s: JsonSamples, ctx: SiteContext): SiteSamples {
  return {
    ctx,
    stepMin: s.stepMin,
    tUtcMs: Float64Array.from(s.tUtcMs),
    sunAzDeg: Float64Array.from(s.sunAzDeg),
    sunElevDeg: Float64Array.from(s.sunElevDeg),
    sunHorizonDeg: Float64Array.from(s.sunHorizonDeg),
    sunFraction: Float64Array.from(s.sunFraction),
    earthAzDeg: Float64Array.from(s.earthAzDeg),
    earthElevDeg: Float64Array.from(s.earthElevDeg),
    earthHorizonDeg: Float64Array.from(s.earthHorizonDeg),
  }
}

const outputs = outputsJson as unknown as {
  scenario: FixtureScenario
  sites: Record<string, Omit<FixtureSiteOutputs, 'samples' | 'ctx'> & { frame: SiteFrame; samples: JsonSamples }>
}

/** Baseline landing at the range start, 24 h mission, slipped by +12 h. */
export const fixtureScenario: FixtureScenario = outputs.scenario

/** Keyed by site id, observer height 2 m, 10-min samples over the scenario range. */
export const fixtureOutputs: Record<string, FixtureSiteOutputs> = Object.fromEntries(
  Object.entries(outputs.sites).map(([id, { frame, samples, ...rest }]) => {
    const site = fixtureSitesFile.sites.find((s) => s.id === id)
    if (!site) throw new Error(`outputs.json: unknown site ${id}`)
    const ctx: SiteContext = {
      eph: fixtureEphemeris,
      frame,
      horizonMaskDeg: site.horizonElevDeg[String(fixtureScenario.observerHeightM)],
      azStepDeg: fixtureSitesFile.azStepDeg,
      observerHeightM: fixtureScenario.observerHeightM,
    }
    return [id, { ...rest, ctx, samples: toSamples(samples, ctx) }]
  }),
)

const toF32 = (xs: (number | null)[]) => Float32Array.from(xs, (x) => x ?? NaN)

/** Scores of `fixtureGrid` over the scenario range (NaN = no data). */
export const fixtureGridScores: GridScores = {
  startMs: gridScoresJson.startMs,
  endMs: gridScoresJson.endMs,
  nx: gridScoresJson.nx,
  ny: gridScoresJson.ny,
  sunPct: toF32(gridScoresJson.sunPct),
  earthPct: toF32(gridScoresJson.earthPct),
  bothPct: toF32(gridScoresJson.bothPct),
}
