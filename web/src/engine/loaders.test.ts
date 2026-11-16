import { describe, expect, it } from 'vitest'
import { loadEphemeris, loadGrid, parseSites } from './loaders'
import type { EphemerisManifest, GridManifest, SitesFile } from './types'

const ephManifest: EphemerisManifest = {
  schemaVersion: 1,
  frame: 'MOON_ME',
  abcorr: 'LT+S',
  observer: 'MOON',
  startUtc: '2026-01-01T00:00:00Z',
  stepS: 3600,
  count: 2,
  bodies: ['sun', 'earth'],
  units: 'km',
  dtype: 'float32-le',
  layout: '[t][body][xyz]',
  kernels: ['naif0012.tls'],
}

function f32le(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 4)
  const view = new DataView(buf)
  values.forEach((v, i) => view.setFloat32(i * 4, v, true))
  return buf
}

function i16le(values: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(values.length * 2)
  const view = new DataView(buf)
  values.forEach((v, i) => view.setInt16(i * 2, v, true))
  return buf
}

describe('loadEphemeris', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12.5]

  it('decodes little-endian float32 positions and the time axis', () => {
    const eph = loadEphemeris(ephManifest, f32le(values))
    expect(eph.startUtcMs).toBe(Date.UTC(2026, 0, 1))
    expect(eph.stepMs).toBe(3_600_000)
    expect(eph.count).toBe(2)
    expect(eph.bodies).toEqual(['sun', 'earth'])
    expect(Array.from(eph.positionsKm)).toEqual(values)
  })

  it('does not share or mutate the input buffer', () => {
    const buf = f32le(values)
    const eph = loadEphemeris(ephManifest, buf)
    eph.positionsKm[0] = 99
    expect(new DataView(buf).getFloat32(0, true)).toBe(1)
  })

  it('rejects a buffer whose size does not match count × bodies × 3', () => {
    expect(() => loadEphemeris(ephManifest, f32le(values.slice(1)))).toThrow(/ephemeris\.bin/)
  })

  it('rejects an unsupported manifest', () => {
    const buf = f32le(values)
    expect(() => loadEphemeris({ ...ephManifest, schemaVersion: 2 as 1 }, buf)).toThrow(/schemaVersion/)
    expect(() => loadEphemeris({ ...ephManifest, frame: 'J2000' as 'MOON_ME' }, buf)).toThrow(/frame/)
    expect(() => loadEphemeris({ ...ephManifest, dtype: 'float64-le' as 'float32-le' }, buf)).toThrow(/dtype/)
    expect(() => loadEphemeris({ ...ephManifest, startUtc: 'not a date' }, buf)).toThrow(/startUtc/)
  })

  it('rejects a startUtc without an explicit UTC offset (it would parse as local time)', () => {
    expect(() => loadEphemeris({ ...ephManifest, startUtc: '2026-01-01T00:00:00' }, f32le(values))).toThrow(/startUtc/)
    expect(loadEphemeris({ ...ephManifest, startUtc: '2026-01-01T05:00:00+05:00' }, f32le(values)).startUtcMs).toBe(
      Date.UTC(2026, 0, 1),
    )
  })

  it('rejects a non-positive step or count, and bodies other than sun and earth once each', () => {
    const buf = f32le(values)
    expect(() => loadEphemeris({ ...ephManifest, stepS: 0 }, buf)).toThrow(/stepS/)
    expect(() => loadEphemeris({ ...ephManifest, count: 0 }, new ArrayBuffer(0))).toThrow(/count/)
    expect(() => loadEphemeris({ ...ephManifest, bodies: ['sun', 'sun'] }, buf)).toThrow(/bodies/)
    expect(() => loadEphemeris({ ...ephManifest, bodies: ['earth', 'moon' as 'sun'] }, buf)).toThrow(/bodies/)
  })
})

describe('loadGrid', () => {
  const manifest: GridManifest = {
    schemaVersion: 1,
    projection: 'polar-stereographic-south',
    sphereRadiusKm: 1737.4,
    originKm: [-2, -2],
    cellKm: 2,
    nx: 2,
    ny: 1,
    azBins: 3,
    heightM: 2,
    dtype: 'uint8',
    encoding: 'elevDeg = v * 0.1 - 5.0; 255 = no data',
    cellSurfaceHeightM: 'grid-heights.bin (int16-le, row-major)',
    dems: [{ file: 'LDEM_80S_80M', role: 'near field', resolutionM: 80 }],
  }
  const horizons = new Uint8Array([0, 50, 255, 10, 20, 30]).buffer
  const heights = i16le([-1200, 3400])

  it('exposes horizons as bytes and decodes little-endian int16 heights', () => {
    const grid = loadGrid(manifest, horizons, heights)
    expect(grid.manifest).toBe(manifest)
    expect(Array.from(grid.horizonsU8)).toEqual([0, 50, 255, 10, 20, 30])
    expect(Array.from(grid.surfaceHeightM)).toEqual([-1200, 3400])
  })

  it('rejects a missing or malformed dems list', () => {
    const missing: Partial<GridManifest> = { ...manifest }
    delete missing.dems
    expect(() => loadGrid(missing as GridManifest, horizons, heights)).toThrow(/grid\.json: dems/)
    expect(() => loadGrid({ ...manifest, dems: [] }, horizons, heights)).toThrow(/grid\.json: dems/)
    expect(() => loadGrid({ ...manifest, dems: [{ file: 'X', role: '', resolutionM: 80 }] }, horizons, heights)).toThrow(/dems\[0\]\.role/)
  })

  it('copies the horizons so the caller may transfer or reuse its buffer', () => {
    const buf = new Uint8Array([0, 50, 255, 10, 20, 30]).buffer
    const grid = loadGrid(manifest, buf, heights)
    new Uint8Array(buf)[0] = 77
    expect(grid.horizonsU8[0]).toBe(0)
  })

  it('rejects buffers whose size does not match the manifest', () => {
    expect(() => loadGrid(manifest, new ArrayBuffer(5), heights)).toThrow(/grid-horizons\.bin/)
    expect(() => loadGrid(manifest, horizons, new ArrayBuffer(2))).toThrow(/grid-heights\.bin/)
  })

  it('rejects an unsupported manifest', () => {
    expect(() => loadGrid({ ...manifest, schemaVersion: 2 as 1 }, horizons, heights)).toThrow(/schemaVersion/)
    expect(() => loadGrid({ ...manifest, dtype: 'uint16' as 'uint8' }, horizons, heights)).toThrow(/dtype/)
    expect(() => loadGrid({ ...manifest, encoding: 'elevDeg = v * 0.05 - 2.0' }, horizons, heights)).toThrow(/encoding/)
    expect(() => loadGrid({ ...manifest, projection: 'equirect' as 'polar-stereographic-south' }, horizons, heights)).toThrow(
      /projection/,
    )
    expect(() => loadGrid({ ...manifest, nx: 0, ny: 0 }, new ArrayBuffer(0), new ArrayBuffer(0))).toThrow(/nx/)
    expect(() => loadGrid({ ...manifest, azBins: 1.5 }, horizons, heights)).toThrow(/azBins/)
  })
})

describe('parseSites', () => {
  const mask = (v: number) => Array.from({ length: 720 }, () => v)
  const valid: SitesFile = {
    schemaVersion: 1,
    azStepDeg: 0.5,
    heightsM: [2, 10],
    dems: [
      { file: 'LDEM_80S_80M', role: 'near field', resolutionM: 80 },
      { file: 'LDEM_75S_240M', role: 'far field', resolutionM: 240 },
    ],
    sites: [
      {
        id: 'a',
        name: 'Site A',
        category: 'clps',
        latDeg: -84.79,
        lonDeg: 29.2,
        surfaceHeightM: 0,
        slopeDeg: 3,
        coordSource: 'test',
        pgdaAvgSunPct: 50,
        pgdaAvgEarthPct: 60,
        horizonElevDeg: { '2': mask(1), '10': mask(0.5) },
      },
    ],
  }
  const clone = (): SitesFile => structuredClone(valid)

  it('returns a valid sites.json unchanged', () => {
    expect(parseSites(clone())).toEqual(valid)
  })

  it('rejects anything that is not a sites.json object', () => {
    expect(() => parseSites(null)).toThrow(/sites\.json/)
    expect(() => parseSites({ ...clone(), schemaVersion: 2 })).toThrow(/schemaVersion/)
    expect(() => parseSites({ ...clone(), sites: 'x' })).toThrow(/sites/)
  })

  it('rejects a missing or malformed dems list', () => {
    const missing: Partial<SitesFile> = clone()
    delete missing.dems
    expect(() => parseSites(missing)).toThrow(/dems/)
    expect(() => parseSites({ ...clone(), dems: [] })).toThrow(/dems/)
    expect(() => parseSites({ ...clone(), dems: [{ file: 'X', role: 'near field' }] })).toThrow(/dems\[0\]\.resolutionM/)
    expect(() => parseSites({ ...clone(), dems: [{ file: '', role: 'near field', resolutionM: 80 }] })).toThrow(/dems\[0\]\.file/)
    expect(() => parseSites({ ...clone(), dems: [{ file: 'X', role: '', resolutionM: 80 }] })).toThrow(/dems\[0\]\.role/)
    expect(() => parseSites({ ...clone(), dems: [{ file: 'X', role: 'near field', resolutionM: 0 }] })).toThrow(/dems\[0\]\.resolutionM/)
  })

  it('rejects a site with a missing or mistyped field', () => {
    const noName = clone()
    delete (noName.sites[0] as Partial<SitesFile['sites'][0]>).name
    expect(() => parseSites(noName)).toThrow(/sites\[0\]\.name/)

    const badLat = clone()
    ;(badLat.sites[0] as unknown as Record<string, unknown>).latDeg = '-84'
    expect(() => parseSites(badLat)).toThrow(/sites\[0\]\.latDeg/)
  })

  it('rejects coordinates outside the contract ranges (lat −90…90, lon −180…180)', () => {
    const badLon = clone()
    badLon.sites[0].lonDeg = 330
    expect(() => parseSites(badLon)).toThrow(/sites\[0\]\.lonDeg/)

    const badLat = clone()
    badLat.sites[0].latDeg = -91
    expect(() => parseSites(badLat)).toThrow(/sites\[0\]\.latDeg/)
  })

  it('rejects heightsM without the default 2 m observer height', () => {
    const no2 = clone()
    no2.heightsM = [10]
    expect(() => parseSites(no2)).toThrow(/heightsM/)
  })

  it('rejects an unknown category', () => {
    const bad = clone()
    ;(bad.sites[0] as unknown as Record<string, unknown>).category = 'moonbase'
    expect(() => parseSites(bad)).toThrow(/category/)
  })

  it('rejects a site missing a listed observer height or with a mask of the wrong length', () => {
    const missing = clone()
    delete missing.sites[0].horizonElevDeg['10']
    expect(() => parseSites(missing)).toThrow(/horizonElevDeg\["10"\]/)

    const short = clone()
    short.sites[0].horizonElevDeg['2'] = mask(1).slice(1)
    expect(() => parseSites(short)).toThrow(/720/)
  })

  it('rejects duplicate site ids', () => {
    const dup = clone()
    dup.sites.push(structuredClone(dup.sites[0]))
    expect(() => parseSites(dup)).toThrow(/duplicate/i)
  })
})
