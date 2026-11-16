// @vitest-environment node
// Node, not jsdom: crypto.subtle.digest rejects buffers from jsdom's realm. Engine code needs no DOM.
import { beforeAll, describe, expect, it } from 'vitest'
import golden from '../../../shared/fixtures/golden.json'
import ephemerisBinUrl from '../../public/data/ephemeris.bin?inline'
import ephemerisJsonText from '../../public/data/ephemeris.json?raw'
import sitesJsonText from '../../public/data/sites.json?raw'
import { dataUrlToArrayBuffer } from './__fixtures__/data-url'
import { realSiteContext, realSitesFile } from './__fixtures__/real-data'
import { detectWindows, sampleSite } from './windows'
import type { SiteContext, VisibilityOpts } from './types'

/** SPEC.md → Success Criteria: az/el ≤ 1e-3°, Sun fraction ≤ 1e-3. */
const ANGLE_TOL_DEG = 1e-3
const FRACTION_TOL = 1e-3

type GoldenCase = (typeof golden.cases)[number]

/** golden.json → inputs: digests of the contract files it was generated from (golden.py input_fingerprint). */
type InputFingerprint = Record<string, string>

const REGENERATE = 'cd pipeline && uv run lunarnav golden'

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Text files are hashed with CRLF read as LF, like golden.py text_sha256 (Windows checkouts have CRLF). */
const lfBytes = (text: string) => new TextEncoder().encode(text.replace(/\r\n/g, '\n'))

// Keyed by golden.json's own fields, so tsc flags a key renamed in golden.py but not here.
async function actualFingerprint(): Promise<Record<keyof typeof golden.inputs, string>> {
  return {
    ephemerisBinSha256: await sha256Hex(dataUrlToArrayBuffer(ephemerisBinUrl)),
    ephemerisJsonSha256: await sha256Hex(lfBytes(ephemerisJsonText)),
    sitesJsonSha256: await sha256Hex(lfBytes(sitesJsonText)),
  }
}

/** Null when golden.json was generated from these files; otherwise why it is stale and how to fix it. */
function staleGoldenMessage(recorded: InputFingerprint | undefined, actual: InputFingerprint): string | null {
  if (!recorded) return `golden.json has no inputs fingerprint, so it predates #89. Regenerate it: ${REGENERATE}`
  const keys = [...new Set([...Object.keys(recorded), ...Object.keys(actual)])].sort()
  const differ = keys.filter((k) => recorded[k] !== actual[k])
  if (differ.length === 0) return null
  return (
    `golden.json is stale: it was generated from different contract files (${differ.join(', ')} differ). ` +
    `Engine parity results are meaningless until it is regenerated: ${REGENERATE}`
  )
}

// Started once at import; the parity suites below wait for it in beforeAll.
// The catch keeps a hashing failure from surfacing as an unhandled rejection before anything awaits it.
const staleness = actualFingerprint().then(
  (actual) => staleGoldenMessage(golden.inputs, actual),
  (e: unknown) => `could not fingerprint the golden.json inputs: ${e instanceof Error ? e.message : String(e)}`,
)

describe('golden.json freshness (inputs fingerprint)', () => {
  const fp = { ephemerisBinSha256: 'a', ephemerisJsonSha256: 'b', sitesJsonSha256: 'c' }

  it('accepts a matching fingerprint', () => {
    expect(staleGoldenMessage({ ...fp }, fp)).toBeNull()
  })

  it('names each differing file and the regenerate command', () => {
    const msg = staleGoldenMessage({ ...fp, sitesJsonSha256: 'old' }, fp)
    expect(msg).toContain('golden.json is stale')
    expect(msg).toContain('sitesJsonSha256')
    expect(msg).not.toContain('ephemerisBinSha256')
    expect(msg).toContain(REGENERATE)
  })

  it('treats a missing or differently shaped fingerprint as stale', () => {
    expect(staleGoldenMessage(undefined, fp)).toContain(REGENERATE)
    expect(staleGoldenMessage({ ephemerisBinSha256: 'a' }, fp)).toContain('ephemerisJsonSha256, sitesJsonSha256')
  })

  it('hashes text with CRLF read as LF', async () => {
    expect(await sha256Hex(lfBytes('{\r\n  "a": 1\r\n}\r\n'))).toBe(await sha256Hex(lfBytes('{\n  "a": 1\n}\n')))
  })

  it('matches the shipped web/public/data files', async () => {
    expect(await staleness).toBeNull()
  })
})

/** Signed azimuth difference in [−180, 180), so 359.9995° vs 0.0003° counts as −0.0008°. */
function azDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

describe('engine golden parity (shared/fixtures/golden.json cases)', () => {
  // Fail every case with the one clear cause instead of hundreds of numeric mismatches.
  beforeAll(async () => {
    const stale = await staleness
    if (stale) throw new Error(stale)
  })

  const opts: VisibilityOpts = golden.opts
  const ctxCache = new Map<string, SiteContext>()

  function ctxFor(c: GoldenCase): SiteContext {
    const key = `${c.siteId}@${c.observerHeightM}`
    let ctx = ctxCache.get(key)
    if (!ctx) {
      // Cases carry their own height (2 or 10 m); it is not a visibility option.
      ctx = realSiteContext(c.siteId, c.observerHeightM)
      ctxCache.set(key, ctx)
    }
    return ctx
  }

  it('covers every site, both heights, partly hidden Sun disks and the 0°/360° horizon bin', () => {
    const cases = golden.cases
    expect(cases.length).toBeGreaterThan(0)
    expect(new Set(cases.map((c) => c.siteId))).toEqual(new Set(realSitesFile.sites.map((s) => s.id)))
    expect(new Set(cases.map((c) => c.observerHeightM))).toEqual(new Set(realSitesFile.heightsM))
    expect(cases.some((c) => c.sunFraction > 0 && c.sunFraction < 1)).toBe(true)
    expect(cases.some((c) => c.earthVisible) && cases.some((c) => !c.earthVisible)).toBe(true)
    // horizonElevAt interpolates between the last bin and bin 0 here.
    const lastBinDeg = 360 - realSitesFile.azStepDeg
    expect(cases.some((c) => c.sunAzDeg >= lastBinDeg || c.earthAzDeg >= lastBinDeg)).toBe(true)
  })

  it.each(golden.cases.map((c) => [`${c.siteId} h=${c.observerHeightM} t=${new Date(c.tUtcMs).toISOString()}`, c] as const))(
    '%s',
    (_, c) => {
      // Sample 0 is at tUtcMs exactly; the 1 ms second sample gives detectWindows a range to report on.
      const samples = sampleSite(ctxFor(c), c.tUtcMs, c.tUtcMs + 1)

      expect(Math.abs(azDiffDeg(samples.sunAzDeg[0], c.sunAzDeg)), 'sunAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunElevDeg[0] - c.sunElevDeg), 'sunElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunHorizonDeg[0] - c.sunHorizonDeg), 'sunHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.sunFraction[0] - c.sunFraction), 'sunFraction').toBeLessThanOrEqual(FRACTION_TOL)
      expect(Math.abs(azDiffDeg(samples.earthAzDeg[0], c.earthAzDeg)), 'earthAzDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.earthElevDeg[0] - c.earthElevDeg), 'earthElevDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)
      expect(Math.abs(samples.earthHorizonDeg[0] - c.earthHorizonDeg), 'earthHorizonDeg').toBeLessThanOrEqual(ANGLE_TOL_DEG)

      // With no prior state, the engine starts the link on at clearance ≥ 0 (no hysteresis), which is golden's
      // earthVisible. Sample 0 alone decides: a turn-on at the 1 ms sample would start at t + 1, not clipped at t.
      const { earth } = detectWindows(samples, opts)
      expect(earth[0]?.startMs === c.tUtcMs && earth[0].clippedStart, 'earthVisible').toBe(c.earthVisible)
    },
  )

  it('wraps azimuth differences across 0°/360°', () => {
    expect(azDiffDeg(359.9995, 0.0003)).toBeCloseTo(-0.0008, 12)
    expect(azDiffDeg(0.0003, 359.9995)).toBeCloseTo(0.0008, 12)
    expect(azDiffDeg(10, 10)).toBe(0)
  })
})
