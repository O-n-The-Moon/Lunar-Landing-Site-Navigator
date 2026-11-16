// Data-contract loaders: turn already-fetched JSON/ArrayBuffers into engine inputs. No fetch here.
import type { Ephemeris, EphemerisManifest, Grid, GridManifest, Site, SiteCategory, SitesFile } from './types'

const SITE_CATEGORIES: readonly SiteCategory[] = ['artemis3-region', 'clps', 'international', 'reference']
const GRID_ENCODING = 'elevDeg = v * 0.1 - 5.0; 255 = no data'
/** ISO 8601 date-time with an explicit offset; without one, Date.parse reads local time. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const isPositiveInt = (v: number) => Number.isInteger(v) && v > 0

function fail(file: string, msg: string): never {
  throw new Error(`${file}: ${msg}`)
}

function checkSchemaVersion(file: string, v: unknown): void {
  if (v !== 1) fail(file, `unsupported schemaVersion ${String(v)} (expected 1)`)
}

/** Decodes `ephemeris.bin` (count × bodies × 3 float32-le) into a fresh Float32Array. */
export function loadEphemeris(manifest: EphemerisManifest, buf: ArrayBuffer): Ephemeris {
  const file = 'ephemeris.json'
  checkSchemaVersion(file, manifest.schemaVersion)
  if (manifest.frame !== 'MOON_ME') fail(file, `unsupported frame ${manifest.frame}`)
  if (manifest.dtype !== 'float32-le') fail(file, `unsupported dtype ${manifest.dtype}`)
  if (manifest.layout !== '[t][body][xyz]') fail(file, `unsupported layout ${manifest.layout}`)
  const startUtcMs = ISO_UTC.test(manifest.startUtc) ? Date.parse(manifest.startUtc) : NaN
  if (Number.isNaN(startUtcMs)) fail(file, `startUtc "${manifest.startUtc}" must be ISO 8601 with Z or an offset`)
  if (!(manifest.stepS > 0)) fail(file, `stepS must be positive, got ${manifest.stepS}`)
  if (!isPositiveInt(manifest.count)) fail(file, `count must be a positive integer, got ${manifest.count}`)
  const { bodies } = manifest
  if (bodies.length !== 2 || !bodies.includes('sun') || !bodies.includes('earth')) {
    fail(file, `bodies must be "sun" and "earth" once each, got ${JSON.stringify(bodies)}`)
  }

  const n = manifest.count * manifest.bodies.length * 3
  if (buf.byteLength !== n * 4) {
    fail('ephemeris.bin', `expected ${n * 4} bytes (count × bodies × 3 × float32), got ${buf.byteLength}`)
  }
  const view = new DataView(buf)
  const positionsKm = new Float32Array(n)
  for (let i = 0; i < n; i++) positionsKm[i] = view.getFloat32(i * 4, true)

  return {
    startUtcMs,
    stepMs: manifest.stepS * 1000,
    count: manifest.count,
    bodies: [...manifest.bodies],
    positionsKm,
  }
}

/** Copies `grid-horizons.bin` (ny × nx × azBins uint8) and decodes `grid-heights.bin` (ny × nx int16-le). */
export function loadGrid(manifest: GridManifest, horizons: ArrayBuffer, heights: ArrayBuffer): Grid {
  const file = 'grid.json'
  checkSchemaVersion(file, manifest.schemaVersion)
  if (manifest.projection !== 'polar-stereographic-south') fail(file, `unsupported projection ${manifest.projection}`)
  if (manifest.dtype !== 'uint8') fail(file, `unsupported dtype ${manifest.dtype}`)
  if (manifest.encoding !== GRID_ENCODING) fail(file, `unsupported encoding "${manifest.encoding}" (expected "${GRID_ENCODING}")`)
  for (const key of ['nx', 'ny', 'azBins'] as const) {
    if (!isPositiveInt(manifest[key])) fail(file, `${key} must be a positive integer, got ${manifest[key]}`)
  }
  if (!(manifest.cellKm > 0)) fail(file, `cellKm must be positive, got ${manifest.cellKm}`)
  parseDems(file, manifest.dems)

  const cells = manifest.nx * manifest.ny
  if (horizons.byteLength !== cells * manifest.azBins) {
    fail('grid-horizons.bin', `expected ${cells * manifest.azBins} bytes (ny × nx × azBins), got ${horizons.byteLength}`)
  }
  if (heights.byteLength !== cells * 2) {
    fail('grid-heights.bin', `expected ${cells * 2} bytes (ny × nx × int16), got ${heights.byteLength}`)
  }
  const view = new DataView(heights)
  const surfaceHeightM = new Int16Array(cells)
  for (let i = 0; i < cells; i++) surfaceHeightM[i] = view.getInt16(i * 2, true)

  return { manifest, horizonsU8: new Uint8Array(horizons.slice(0)), surfaceHeightM }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))
}

function parseSite(raw: unknown, path: string, heightsM: number[], azBins: number): Site {
  const file = 'sites.json'
  if (!isRecord(raw)) fail(file, `${path} is not an object`)
  for (const key of ['id', 'name', 'category', 'coordSource'] as const) {
    if (typeof raw[key] !== 'string') fail(file, `${path}.${key} must be a string`)
  }
  for (const key of ['latDeg', 'lonDeg', 'surfaceHeightM', 'slopeDeg', 'pgdaAvgSunPct', 'pgdaAvgEarthPct'] as const) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) fail(file, `${path}.${key} must be a finite number`)
  }
  if (Math.abs(raw.latDeg as number) > 90) fail(file, `${path}.latDeg must be within −90…90`)
  if (Math.abs(raw.lonDeg as number) > 180) fail(file, `${path}.lonDeg must be within −180…180 (east-positive)`)
  if (!SITE_CATEGORIES.includes(raw.category as SiteCategory)) {
    fail(file, `${path}.category "${String(raw.category)}" is not one of ${SITE_CATEGORIES.join(', ')}`)
  }
  const masks = raw.horizonElevDeg
  if (!isRecord(masks)) fail(file, `${path}.horizonElevDeg must be an object`)
  for (const h of heightsM) {
    const mask = masks[String(h)]
    if (!isNumberArray(mask) || mask.length !== azBins) {
      fail(file, `${path}.horizonElevDeg["${h}"] must be ${azBins} finite numbers`)
    }
  }
  return raw as unknown as Site
}

function parseDems(file: string, dems: unknown): void {
  if (!Array.isArray(dems) || dems.length === 0) fail(file, 'dems must be a non-empty array')
  dems.forEach((dem, i) => parseDem(file, dem, `dems[${i}]`))
}

function parseDem(file: string, raw: unknown, path: string): void {
  if (!isRecord(raw)) fail(file, `${path} must be an object`)
  for (const key of ['file', 'role'] as const) {
    if (typeof raw[key] !== 'string' || raw[key].length === 0) fail(file, `${path}.${key} must be a non-empty string`)
  }
  if (typeof raw.resolutionM !== 'number' || !(raw.resolutionM > 0)) fail(file, `${path}.resolutionM must be a positive number`)
}

/** Validates parsed `sites.json` JSON and returns it typed. Throws with the offending path on any mismatch. */
export function parseSites(json: unknown): SitesFile {
  const file = 'sites.json'
  if (!isRecord(json)) fail(file, 'not an object')
  checkSchemaVersion(file, json.schemaVersion)
  const { azStepDeg, heightsM, sites } = json
  if (typeof azStepDeg !== 'number' || !(azStepDeg > 0) || !Number.isInteger(360 / azStepDeg)) {
    fail(file, 'azStepDeg must be a positive divisor of 360')
  }
  if (!isNumberArray(heightsM) || !heightsM.includes(2)) {
    fail(file, 'heightsM must be a number array that includes the default 2 m observer height')
  }
  parseDems(file, json.dems)
  if (!Array.isArray(sites)) fail(file, 'sites must be an array')

  const azBins = 360 / azStepDeg
  const ids = new Set<string>()
  sites.forEach((raw, i) => {
    const site = parseSite(raw, `sites[${i}]`, heightsM, azBins)
    if (ids.has(site.id)) fail(file, `duplicate site id "${site.id}"`)
    ids.add(site.id)
  })
  return json as unknown as SitesFile
}
