import { describe, expect, it } from 'vitest'
import { gridHeightsField, parseDisplayTerrain } from './terrain-data'

const manifest = {
  schemaVersion: 1,
  projection: 'polar-stereographic-south',
  sphereRadiusKm: 1737.4,
  originKm: [-4, -4],
  cellKm: 2,
  nx: 4,
  ny: 4,
  dtype: 'int16-le',
}

const bytesOf = (values: number[]) => {
  const buf = new ArrayBuffer(values.length * 2)
  const view = new DataView(buf)
  values.forEach((v, i) => view.setInt16(i * 2, v, true))
  return buf
}

describe('parseDisplayTerrain', () => {
  const heights = Array.from({ length: 16 }, (_, i) => i * 100 - 500)

  it('decodes little-endian int16 metres in row-major order and tags the source', () => {
    const field = parseDisplayTerrain(manifest, bytesOf(heights))
    expect(field.source).toBe('display')
    expect(Array.from(field.heightM)).toEqual(heights)
    expect(field.frame).toEqual({ originKm: [-4, -4], cellKm: 2, nx: 4, ny: 4, sphereRadiusKm: 1737.4 })
  })

  it('rejects a wrong file size and names the file', () => {
    expect(() => parseDisplayTerrain(manifest, bytesOf(heights.slice(1)))).toThrow(/terrain-display\.bin: expected 32 bytes/)
  })

  it.each([
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{ projection: 'mercator' }, /projection/],
    [{ dtype: 'float32' }, /dtype/],
    [{ nx: 0 }, /nx and ny/],
    [{ cellKm: -1 }, /cellKm/],
    [{ sphereRadiusKm: 0 }, /sphereRadiusKm/],
    [{ originKm: [1] }, /originKm/],
  ])('rejects a bad manifest (%j)', (patch, message) => {
    expect(() => parseDisplayTerrain({ ...manifest, ...patch }, bytesOf(heights))).toThrow(message)
    expect(() => parseDisplayTerrain({ ...manifest, ...patch }, bytesOf(heights))).toThrow(/terrain-display\.json/)
  })

  it('rejects a missing manifest', () => {
    expect(() => parseDisplayTerrain(null, bytesOf(heights))).toThrow(/terrain-display\.json/)
  })
})

describe('gridHeightsField', () => {
  it('wraps the 2 km heights as a drawing field tagged "grid"', () => {
    const heightM = new Int16Array(16)
    const frame = { originKm: [-4, -4] as const, cellKm: 2, nx: 4, ny: 4, sphereRadiusKm: 1737.4 }
    expect(gridHeightsField(frame, heightM)).toEqual({ frame, heightM, source: 'grid' })
  })
})
