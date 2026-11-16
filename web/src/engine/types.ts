// Types for every data-contract file (SPEC.md → Data Contract) and for engine I/O (SPEC-engine.md).
// Units are in every name. Times are UTC Unix ms. Angles are degrees at this boundary.

export type Body = 'sun' | 'earth'

/** Cartesian vector in MOON_ME, km unless the name says otherwise. */
export type Vec3 = readonly [number, number, number]

// ---------------------------------------------------------------------------
// Data contract files (web/public/data/)
// ---------------------------------------------------------------------------

/** `ephemeris.json` */
export interface EphemerisManifest {
  schemaVersion: 1
  frame: 'MOON_ME'
  abcorr: string
  observer: string
  startUtc: string
  stepS: number
  count: number
  bodies: Body[]
  units: 'km'
  dtype: 'float32-le'
  layout: '[t][body][xyz]'
  kernels: string[]
}

export type SiteCategory = 'artemis3-region' | 'clps' | 'international' | 'reference'

/** One entry of `sites.json` → `sites`. */
export interface Site {
  id: string
  name: string
  category: SiteCategory
  latDeg: number
  lonDeg: number
  surfaceHeightM: number
  slopeDeg: number
  coordSource: string
  pgdaAvgSunPct: number
  pgdaAvgEarthPct: number
  /** Keyed by observer height in metres as a string ("2", "10"); value[i] is the horizon at azimuth i × azStepDeg. */
  horizonElevDeg: Record<string, number[]>
}

/** A LOLA DEM the horizon masks were built from. Listed near field first, in `sites.json` and `grid.json`. */
export interface DemRecord {
  /** Product name without extension, e.g. `LDEM_80S_80M`. */
  file: string
  /** How the horizon scan uses it, e.g. `near field`, `far field`. */
  role: string
  resolutionM: number
}

/** `sites.json` */
export interface SitesFile {
  schemaVersion: 1
  azStepDeg: number
  heightsM: number[]
  /** DEMs behind `horizonElevDeg`; same list as `grid.json`. */
  dems: DemRecord[]
  sites: Site[]
}

/** `grid.json` */
export interface GridManifest {
  schemaVersion: 1
  projection: 'polar-stereographic-south'
  sphereRadiusKm: number
  /** Lower-left corner of the grid extent, [x, y] km. Cell centers are at originKm + (i + 0.5) × cellKm. */
  originKm: [number, number]
  cellKm: number
  nx: number
  ny: number
  azBins: number
  heightM: number
  dtype: 'uint8'
  encoding: string
  cellSurfaceHeightM: string
  /** DEMs behind the cell horizons; same list as `sites.json`. */
  dems: DemRecord[]
}

/** `pgda-layers.json`. The contract only names its contents (extent, source, resolution, observer height). */
export interface PgdaLayersManifest {
  schemaVersion: 1
  source: string
  resolutionM: number
  /** null when PGDA does not document it. */
  observerHeightM: number | null
  projection: 'polar-stereographic-south'
  originKm: [number, number]
  cellKm: number
  nx: number
  ny: number
  /** 8-bit grayscale, value = percent (0–100). */
  encoding: string
  layers: { sun: string; earth: string }
}

/** One Horizons comparison row: our smooth-sphere az/el vs. JPL Horizons at one site/epoch/body. */
export interface HorizonsValidationRow {
  siteId: string
  tUtcMs: number
  body: Body
  oursAzDeg: number
  oursElevDeg: number
  horizonsAzDeg: number
  horizonsElevDeg: number
  azErrDeg: number
  elevErrDeg: number
}

export interface HorizonsValidation {
  rows: HorizonsValidationRow[]
  summary: {
    n: number
    maxAzErrDeg: number
    maxElevErrDeg: number
    meanAzErrDeg: number
    meanElevErrDeg: number
    /** Pass target for both max errors (SPEC.md criterion 1). Absent in files written before #71. */
    targetMaxErrDeg?: number
  }
}

/** One PGDA comparison row: our long-term average visibility vs. the PGDA pixel at one site. */
export interface PgdaValidationRow {
  siteId: string
  oursSunPct: number
  pgdaSunPct: number
  sunDiffPp: number
  oursEarthPct: number
  pgdaEarthPct: number
  earthDiffPp: number
  /** Required for outliers (|diff| > thresholdPp), otherwise null. */
  explanation: string | null
}

export interface PgdaValidation {
  rows: PgdaValidationRow[]
  summary: {
    thresholdPp: number
    sitesWithinThreshold: number
    sitesTotal: number
    maxAbsSunDiffPp: number
    maxAbsEarthDiffPp: number
    /** Pass target: fraction of sites that must be within `thresholdPp` (SPEC.md criterion 2). Absent in files written before #71. */
    targetFractionWithin?: number
  }
  /** How the comparison was made. Absent in files written before #71. */
  method?: PgdaMethod | null
}

/** The PGDA comparison method as recorded by the pipeline (#57), shown next to the numbers. */
export interface PgdaMethod {
  /** Observer height of the primary comparison; null if unknown. An assumption, see `notes`. */
  observerHeightM: number | null
  /** Heights run as sensitivity checks only. */
  sensitivityHeightsM: number[]
  sunDefinition: string
  earthDefinition: string
  /** What the PGDA product itself counts. */
  pgdaDefinition: string
  /** Timestep and span. */
  sampling: string
  /** The only wording under which the within-threshold result may be stated. */
  claimLabel: string
  /** Limits on claims. */
  notes: string
}

/** `validation.json`. A section is null until the pipeline produces it. */
export interface ValidationFile {
  schemaVersion: 1
  horizons: HorizonsValidation | null
  pgda: PgdaValidation | null
}

// ---------------------------------------------------------------------------
// Loaded data (engine input)
// ---------------------------------------------------------------------------

export interface Ephemeris {
  startUtcMs: number
  stepMs: number
  count: number
  bodies: readonly Body[]
  /** `count × bodies.length × 3`, layout [t][body][xyz], km, MOON_ME. */
  positionsKm: Float32Array
}

export interface Grid {
  manifest: GridManifest
  /** `ny × nx × azBins`, encoded per `manifest.encoding` (255 = no data). */
  horizonsU8: Uint8Array
  /** `ny × nx`, row-major (y outer, x inner). */
  surfaceHeightM: Int16Array
}

// ---------------------------------------------------------------------------
// Engine I/O
// ---------------------------------------------------------------------------

export interface AzEl {
  azDeg: number
  elevDeg: number
  distKm: number
}

/** Observer position and local ENU basis (unit vectors) in MOON_ME. */
export interface SiteFrame {
  /** Clamped to ±89.999°. */
  latDeg: number
  lonDeg: number
  positionKm: Vec3
  east: Vec3
  north: Vec3
  up: Vec3
}

/**
 * Everything the time-series functions need for one site at one observer height. The height is per site
 * (grid-snapped sites are 2 m only) and lives only here: the engine uses it through `frame` and `horizonMaskDeg`;
 * `observerHeightM` records which height those were built for (for labels). Nothing re-checks a hand-built
 * context, so build curated sites with `siteContext()`.
 */
export interface SiteContext {
  eph: Ephemeris
  frame: SiteFrame
  horizonMaskDeg: ArrayLike<number>
  azStepDeg: number
  /** Height above the surface that `frame` and `horizonMaskDeg` were built for. */
  observerHeightM: number
}

export interface VisibilityOpts {
  sunThreshold: number
  hysteresis: number
  earthMarginDeg: number
  earthHysteresisDeg: number
}

export const DEFAULT_VISIBILITY_OPTS: Readonly<VisibilityOpts> = {
  sunThreshold: 0.5,
  hysteresis: 0.05,
  earthMarginDeg: 1.0,
  earthHysteresisDeg: 0.1,
}

export const DEFAULT_OBSERVER_HEIGHT_M = 2

/** Parallel arrays, one entry per sample time. */
export interface SiteSamples {
  /** The context the samples were taken from, so detectWindows can refine events between samples. */
  ctx: SiteContext
  stepMin: number
  tUtcMs: Float64Array
  sunAzDeg: Float64Array
  sunElevDeg: Float64Array
  sunHorizonDeg: Float64Array
  sunFraction: Float64Array
  earthAzDeg: Float64Array
  earthElevDeg: Float64Array
  earthHorizonDeg: Float64Array
}

/**
 * A continuous "on" interval. `clippedStart`/`clippedEnd`: that edge is the sampled range limit, not a real
 * transition. A real transition can still fall exactly on the range end (then the flag is false).
 */
export interface Window {
  startMs: number
  endMs: number
  clippedStart: boolean
  clippedEnd: boolean
}

export interface DetectedWindows {
  sun: Window[]
  earth: Window[]
  both: Window[]
}

/** Hours from the query time to the next transition, or null if none in range. */
export interface NextEvents {
  sunsetInH: number | null
  sunriseInH: number | null
  earthsetInH: number | null
  earthriseInH: number | null
}

export interface MissionMetrics {
  landingMs: number
  durationH: number
  sunlitPct: number
  earthPct: number
  bothPct: number
  longestSunGapH: number
  longestEarthGapH: number
  /** null if there is no on→off transition: check `sunNeverUp` to tell "never sunlit" from "never sets". */
  firstSunsetH: number | null
  /** null if there is no on→off transition: check `earthNeverUp` to tell "never in view" from "never sets". */
  firstEarthsetH: number | null
  /** True when the Sun is never sunlit during the mission (`sunlitPct` = 0), so `firstSunsetH` null means worst, not best. */
  sunNeverUp: boolean
  /** True when Earth is never in view during the mission (`earthPct` = 0). */
  earthNeverUp: boolean
  meanSunFraction: number
}

/** What a mission does with a body: never up (worst), sets at some point, or never sets (best). */
export type EventState = 'never-up' | 'sets' | 'never-sets'

/**
 * How a "first event" metric changed from baseline (a) to slipped (b):
 * `appeared` = a has no set event, b does; `disappeared` = a has one, b has none; `shifted` = both set at different
 * times; `flipped` = neither sets but one is never up and the other never sets; `none` = same state and time.
 * `from` / `to` give the states, so a consumer can rank them (never-up < sets < never-sets).
 */
export type EventChange = 'none' | 'appeared' | 'disappeared' | 'shifted' | 'flipped'

export interface EventDelta {
  /** `b − a` in hours; null unless both events happen. */
  deltaH: number | null
  change: EventChange
  /** State in the baseline (a). */
  from: EventState
  /** State in the slipped mission (b). */
  to: EventState
}

/** `b − a` per metric (a = baseline, b = slipped). */
export interface MetricDelta {
  sunlitPct: number
  earthPct: number
  bothPct: number
  longestSunGapH: number
  longestEarthGapH: number
  firstSunsetH: EventDelta
  firstEarthsetH: EventDelta
  meanSunFraction: number
}

/** Per-cell scores, `ny × nx` row-major. NaN = no data. */
export interface GridScores {
  startMs: number
  endMs: number
  nx: number
  ny: number
  sunPct: Float32Array
  earthPct: Float32Array
  bothPct: Float32Array
}

export interface GridCellRef {
  ix: number
  iy: number
  snapDistKm: number
}

export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(`${fn} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}

/** Stub body: takes the stub's arguments so their names stay in the final signature without unused-param errors. */
export function notImplemented(fn: string, ...args: unknown[]): never {
  void args
  throw new NotImplementedError(fn)
}
