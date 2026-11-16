// Height fields used to DRAW the 3D views (never for visibility): the 2 km `grid-heights.bin` and the optional
// 1024² `terrain-display.bin` (SPEC.md → Display assets). Both are int16 metres in the grid's polar-stereographic
// square, row-major `iy · nx + ix`, iy = 0 = lowest y.

/** Where a height field sits on the map plane (a subset of `GridManifest`). */
export interface TerrainFrame {
  originKm: readonly [number, number]
  cellKm: number
  nx: number
  ny: number
  sphereRadiusKm: number
}

export interface TerrainField {
  frame: TerrainFrame
  /** `ny × nx` metres above the reference sphere. */
  heightM: Int16Array
  /** Which file it came from; the 3D view labels the display one. */
  source: 'grid' | 'display'
}

interface DisplayManifestJson {
  schemaVersion?: unknown
  projection?: unknown
  sphereRadiusKm?: unknown
  originKm?: unknown
  cellKm?: unknown
  nx?: unknown
  ny?: unknown
  dtype?: unknown
}

const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0

function readInt16Le(bytes: ArrayBuffer, count: number): Int16Array {
  const view = new DataView(bytes)
  const out = new Int16Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

/** Validates `terrain-display.json` and decodes `terrain-display.bin`. Throws Error with the file name on bad input. */
export function parseDisplayTerrain(manifestJson: unknown, bytes: ArrayBuffer): TerrainField {
  const m = (manifestJson ?? {}) as DisplayManifestJson
  const file = 'terrain-display.json'
  if (m.schemaVersion !== 1) throw new Error(`${file}: unsupported schemaVersion ${String(m.schemaVersion)} (expected 1)`)
  if (m.projection !== 'polar-stereographic-south') throw new Error(`${file}: unsupported projection ${String(m.projection)}`)
  if (m.dtype !== 'int16-le') throw new Error(`${file}: unsupported dtype ${String(m.dtype)}`)
  if (!isPosInt(m.nx) || !isPosInt(m.ny)) throw new Error(`${file}: nx and ny must be positive integers`)
  if (typeof m.cellKm !== 'number' || !(m.cellKm > 0)) throw new Error(`${file}: cellKm must be positive`)
  if (typeof m.sphereRadiusKm !== 'number' || !(m.sphereRadiusKm > 0)) throw new Error(`${file}: sphereRadiusKm must be positive`)
  const origin = m.originKm
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error(`${file}: originKm must be [x, y]`)
  }
  if (bytes.byteLength !== m.nx * m.ny * 2) {
    throw new Error(`terrain-display.bin: expected ${m.nx * m.ny * 2} bytes (ny × nx × int16), got ${bytes.byteLength}`)
  }
  return {
    frame: { originKm: [origin[0], origin[1]], cellKm: m.cellKm, nx: m.nx, ny: m.ny, sphereRadiusKm: m.sphereRadiusKm },
    heightM: readInt16Le(bytes, m.nx * m.ny),
    source: 'display',
  }
}

/** The 2 km grid's heights as a drawing field (the grid manifest already validated its own geometry). */
export function gridHeightsField(frame: TerrainFrame, heightM: Int16Array): TerrainField {
  return { frame, heightM, source: 'grid' }
}
