// Loads the data-contract files (SPEC.md → Data Contract; SPEC-app P0-1).
// Core files load on startup; the grid, PGDA layers and the 3D terrain heights load lazily on first use (3D Terrain tab,
// Map tab, custom sites).
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  loadEphemeris,
  loadGrid,
  parseSites,
  type Ephemeris,
  type EphemerisManifest,
  type Grid,
  type GridManifest,
  type PgdaLayersManifest,
  type SitesFile,
  type ValidationFile,
} from '../engine'
import { gridHeightsField, parseDisplayTerrain, type TerrainField } from './terrain-data'

export type LoadState<T> =
  | { status: 'idle' }
  /** `progress` is 0–1, or null when unknown. */
  | { status: 'loading'; progress: number | null }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

/** Loaded on startup. */
export interface CoreData {
  ephemeris: Ephemeris
  /** Kept for provenance (frame, aberration correction, kernel names) shown in the validation panel. */
  ephemerisManifest: EphemerisManifest
  sitesFile: SitesFile
  validation: ValidationFile
}

export interface PgdaData {
  manifest: PgdaLayersManifest
  /** Image URLs for the v0 map layers. */
  urls: { sun: string; earth: string }
}

export interface DataSource {
  /** `fixtures` = synthetic test data; the UI must say so. */
  kind: 'data' | 'fixtures'
  loadCore(): Promise<CoreData>
  loadGrid(onProgress: (fraction: number | null) => void): Promise<Grid>
  /** The 2 km surface heights alone (65 KB), so the 3D view can draw before the 12 MB horizon grid arrives. */
  loadGridHeights(): Promise<TerrainField>
  /** The 1024² display terrain (SPEC.md → Display assets); rejects when the source has none. */
  loadDisplayTerrain(): Promise<TerrainField>
  loadPgda(): Promise<PgdaData>
}

type FetchFn = (url: string) => Promise<Response>

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function fetchOk(fetchFn: FetchFn, baseUrl: string, file: string): Promise<Response> {
  let res: Response
  try {
    res = await fetchFn(baseUrl + file)
  } catch (e) {
    throw new Error(`${file}: network error (${errorMessage(e)})`, { cause: e })
  }
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  // Vite's dev server and SPA hosts answer a missing file with index.html (200).
  if (res.headers.get('content-type')?.includes('text/html')) throw new Error(`${file}: not found`)
  return res
}

async function fetchJson(fetchFn: FetchFn, baseUrl: string, file: string): Promise<unknown> {
  const res = await fetchOk(fetchFn, baseUrl, file)
  try {
    return await res.json()
  } catch {
    throw new Error(`${file}: invalid JSON`)
  }
}

/** Reads the body, reporting `loaded / expectedBytes` (decoded size, so it works with compressed transfers). */
async function fetchBytes(
  fetchFn: FetchFn,
  baseUrl: string,
  file: string,
  expectedBytes?: number,
  onProgress?: (fraction: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetchOk(fetchFn, baseUrl, file)
  if (!onProgress || !res.body) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(expectedBytes ? Math.min(1, loaded / expectedBytes) : null)
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

function parseValidation(json: unknown): ValidationFile {
  const v = json as Partial<ValidationFile> | null
  if (v?.schemaVersion !== 1) throw new Error(`validation.json: unsupported schemaVersion ${String(v?.schemaVersion)} (expected 1)`)
  return v as ValidationFile
}

/** Real data from `web/public/data/` (served at `<base>data/`). */
export function fetchDataSource(baseUrl = `${import.meta.env.BASE_URL}data/`, fetchFn: FetchFn = (u) => fetch(u)): DataSource {
  return {
    kind: 'data',
    async loadCore() {
      const [ephManifest, ephBin, sitesJson, validationJson] = await Promise.all([
        fetchJson(fetchFn, baseUrl, 'ephemeris.json'),
        fetchBytes(fetchFn, baseUrl, 'ephemeris.bin'),
        fetchJson(fetchFn, baseUrl, 'sites.json'),
        fetchJson(fetchFn, baseUrl, 'validation.json'),
      ])
      return {
        ephemeris: loadEphemeris(ephManifest as EphemerisManifest, ephBin),
        ephemerisManifest: ephManifest as EphemerisManifest,
        sitesFile: parseSites(sitesJson),
        validation: parseValidation(validationJson),
      }
    },
    async loadGrid(onProgress) {
      const manifest = (await fetchJson(fetchFn, baseUrl, 'grid.json')) as GridManifest
      const horizonsBytes = manifest.nx * manifest.ny * manifest.azBins
      const [horizons, heights] = await Promise.all([
        fetchBytes(fetchFn, baseUrl, 'grid-horizons.bin', horizonsBytes, onProgress),
        fetchBytes(fetchFn, baseUrl, 'grid-heights.bin'),
      ])
      return loadGrid(manifest, horizons, heights)
    },
    async loadGridHeights() {
      const manifest = (await fetchJson(fetchFn, baseUrl, 'grid.json')) as GridManifest
      const bytes = await fetchBytes(fetchFn, baseUrl, 'grid-heights.bin')
      const cells = manifest.nx * manifest.ny
      if (bytes.byteLength !== cells * 2) throw new Error(`grid-heights.bin: expected ${cells * 2} bytes, got ${bytes.byteLength}`)
      const view = new DataView(bytes)
      const heightM = new Int16Array(cells)
      for (let i = 0; i < cells; i++) heightM[i] = view.getInt16(i * 2, true)
      return gridHeightsField(manifest, heightM)
    },
    async loadDisplayTerrain() {
      const [manifest, bytes] = await Promise.all([
        fetchJson(fetchFn, baseUrl, 'terrain-display.json'),
        fetchBytes(fetchFn, baseUrl, 'terrain-display.bin'),
      ])
      return parseDisplayTerrain(manifest, bytes)
    },
    async loadPgda() {
      const manifest = (await fetchJson(fetchFn, baseUrl, 'pgda-layers.json')) as PgdaLayersManifest
      if (manifest.schemaVersion !== 1) throw new Error('pgda-layers.json: unsupported schemaVersion')
      return { manifest, urls: { sun: baseUrl + manifest.layers.sun, earth: baseUrl + manifest.layers.earth } }
    },
  }
}

/** Synthetic fixtures (`src/engine/__fixtures__`), code-split so production doesn't download them. */
export function fixtureDataSource(): DataSource {
  const load = () => import('../engine/__fixtures__')
  return {
    kind: 'fixtures',
    async loadCore() {
      const f = await load()
      return {
        ephemeris: f.fixtureEphemeris,
        ephemerisManifest: f.fixtureEphemerisManifest,
        sitesFile: f.fixtureSitesFile,
        validation: f.fixtureValidation,
      }
    },
    async loadGrid(onProgress) {
      const f = await load()
      onProgress(1)
      return f.fixtureGrid
    },
    async loadGridHeights() {
      const f = await load()
      return gridHeightsField(f.fixtureGrid.manifest, f.fixtureGrid.surfaceHeightM)
    },
    async loadDisplayTerrain() {
      throw new Error('terrain-display: not available in fixtures')
    },
    async loadPgda() {
      const f = await load()
      return { manifest: f.fixturePgdaLayers, urls: f.fixturePgdaPngUrls }
    },
  }
}

/** Dev: real data if present, otherwise fixtures (flagged in the UI). Production: real data only. */
export function defaultDataSources(): { source: DataSource; fallback?: DataSource } {
  return import.meta.env.DEV
    ? { source: fetchDataSource(), fallback: fixtureDataSource() }
    : { source: fetchDataSource() }
}

// --- React binding -----------------------------------------------------------------
// Two contexts: core data is stable after startup, while lazy loads update often (grid progress),
// so progress updates must not re-render everything that only reads core data.

interface CoreContextValue {
  core: LoadState<CoreData>
  /** Kind of the source in use (the fallback once it has taken over). */
  kind: DataSource['kind']
  /** Why the fallback is in use, or null. */
  fallbackReason: string | null
}

interface LazyContextValue {
  grid: LoadState<Grid>
  pgda: LoadState<PgdaData>
  heights: LoadState<TerrainField>
  display: LoadState<TerrainField>
  requestGrid: () => void
  requestPgda: () => void
  requestHeights: () => void
  requestDisplay: () => void
}

/** A lazily loaded resource plus a retry for the error state. */
export interface LazyResource<T> {
  state: LoadState<T>
  /** Starts the load again after an error; no-op while loading or once loaded. */
  retry: () => void
}

const CoreContext = createContext<CoreContextValue | null>(null)
const LazyContext = createContext<LazyContextValue | null>(null)

type LazyKind = 'grid' | 'pgda' | 'heights' | 'display'
/**
 * Lazy loads already started, keyed by a per-provider object. Kept outside React state so two
 * consumers asking in the same commit start only one load.
 */
const lazyStarted = new WeakMap<object, Set<LazyKind>>()

/** Returns false if `what` was already started for this provider; otherwise marks it started. */
function startOnce(key: object, what: LazyKind): boolean {
  let started = lazyStarted.get(key)
  if (!started) lazyStarted.set(key, (started = new Set()))
  if (started.has(what)) return false
  started.add(what)
  return true
}
const allowRetry = (key: object, what: LazyKind) => lazyStarted.get(key)?.delete(what)

export function DataProvider({ source, fallback, children }: { source: DataSource; fallback?: DataSource; children: ReactNode }) {
  const [active, setActive] = useState<{ source: DataSource; fallbackReason: string | null }>({ source, fallbackReason: null })
  const [core, setCore] = useState<LoadState<CoreData>>({ status: 'loading', progress: null })
  const [grid, setGrid] = useState<LoadState<Grid>>({ status: 'idle' })
  const [pgda, setPgda] = useState<LoadState<PgdaData>>({ status: 'idle' })
  const [heights, setHeights] = useState<LoadState<TerrainField>>({ status: 'idle' })
  const [display, setDisplay] = useState<LoadState<TerrainField>>({ status: 'idle' })
  const [lazyKey] = useState(() => ({}))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await source.loadCore()
        if (!cancelled) {
          setActive({ source, fallbackReason: null })
          setCore({ status: 'ready', data })
        }
      } catch (e) {
        if (!fallback) {
          if (!cancelled) setCore({ status: 'error', message: errorMessage(e) })
          return
        }
        try {
          const data = await fallback.loadCore()
          if (!cancelled) {
            setActive({ source: fallback, fallbackReason: errorMessage(e) })
            setCore({ status: 'ready', data })
          }
        } catch (e2) {
          if (!cancelled) setCore({ status: 'error', message: `${errorMessage(e)}; fallback: ${errorMessage(e2)}` })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, fallback])

  const requestGrid = useCallback(() => {
    if (!startOnce(lazyKey, 'grid')) return
    setGrid({ status: 'loading', progress: 0 })
    // The body arrives in many small chunks; only re-render when the whole percent changes.
    let lastPct: number | null = 0
    const onProgress = (progress: number | null) => {
      const pct = progress === null ? null : Math.round(progress * 100)
      if (pct === lastPct) return
      lastPct = pct
      setGrid({ status: 'loading', progress })
    }
    active.source.loadGrid(onProgress).then(
      (data) => setGrid({ status: 'ready', data }),
      (e) => {
        allowRetry(lazyKey, 'grid')
        setGrid({ status: 'error', message: errorMessage(e) })
      },
    )
  }, [active.source, lazyKey])

  const requestPgda = useCallback(() => {
    if (!startOnce(lazyKey, 'pgda')) return
    setPgda({ status: 'loading', progress: null })
    active.source.loadPgda().then(
      (data) => setPgda({ status: 'ready', data }),
      (e) => {
        allowRetry(lazyKey, 'pgda')
        setPgda({ status: 'error', message: errorMessage(e) })
      },
    )
  }, [active.source, lazyKey])

  const requestHeights = useCallback(() => {
    if (!startOnce(lazyKey, 'heights')) return
    setHeights({ status: 'loading', progress: null })
    active.source.loadGridHeights().then(
      (data) => setHeights({ status: 'ready', data }),
      (e) => {
        allowRetry(lazyKey, 'heights')
        setHeights({ status: 'error', message: errorMessage(e) })
      },
    )
  }, [active.source, lazyKey])

  // No retry for the display terrain: the 3D view keeps the 2 km mesh, which is a complete fallback.
  const requestDisplay = useCallback(() => {
    if (!startOnce(lazyKey, 'display')) return
    setDisplay({ status: 'loading', progress: null })
    active.source.loadDisplayTerrain().then(
      (data) => setDisplay({ status: 'ready', data }),
      (e) => setDisplay({ status: 'error', message: errorMessage(e) }),
    )
  }, [active.source, lazyKey])

  const coreValue = useMemo<CoreContextValue>(
    () => ({ core, kind: active.source.kind, fallbackReason: active.fallbackReason }),
    [core, active],
  )
  const lazyValue = useMemo<LazyContextValue>(
    () => ({ grid, pgda, heights, display, requestGrid, requestPgda, requestHeights, requestDisplay }),
    [grid, pgda, heights, display, requestGrid, requestPgda, requestHeights, requestDisplay],
  )
  return createElement(
    CoreContext.Provider,
    { value: coreValue },
    createElement(LazyContext.Provider, { value: lazyValue }, children),
  )
}

function useCoreContext(): CoreContextValue {
  const ctx = useContext(CoreContext)
  if (!ctx) throw new Error('data hooks must be used inside <DataProvider>')
  return ctx
}

function useLazyContext(): LazyContextValue {
  const ctx = useContext(LazyContext)
  if (!ctx) throw new Error('data hooks must be used inside <DataProvider>')
  return ctx
}

/** Startup data status, plus which source is in use. */
export function useCoreDataState(): CoreContextValue {
  return useCoreContext()
}

/** Core data; only call below the point where `useCoreDataState().core` is ready (the App gates this). */
export function useCoreData(): CoreData {
  const { core } = useCoreContext()
  if (core.status !== 'ready') throw new Error('useCoreData called before core data loaded')
  return core.data
}

/** The horizon grid; starts loading on first use, or once `enabled` turns true (so callers can defer the ~12 MB). */
export function useGrid(enabled = true): LazyResource<Grid> {
  const { grid, requestGrid } = useLazyContext()
  useEffect(() => {
    if (enabled) requestGrid()
  }, [enabled, requestGrid])
  return { state: grid, retry: requestGrid }
}

/** PGDA v0 map layers; start loading on first use, or once `enabled` turns true (the 3D view only needs them for a PGDA overlay). */
export function usePgdaLayers(enabled = true): LazyResource<PgdaData> {
  const { pgda, requestPgda } = useLazyContext()
  useEffect(() => {
    if (enabled) requestPgda()
  }, [enabled, requestPgda])
  return { state: pgda, retry: requestPgda }
}

/** The 2 km surface heights alone (for the first 3D frame); starts loading on first use. */
export function useTerrainHeights(): LazyResource<TerrainField> {
  const { heights, requestHeights } = useLazyContext()
  useEffect(requestHeights, [requestHeights])
  return { state: heights, retry: requestHeights }
}

/** The 1024² display terrain. Starts loading only when `enabled` (the 3D view enables it once the 2 km mesh is up). */
export function useDisplayTerrain(enabled: boolean): LoadState<TerrainField> {
  const { display, requestDisplay } = useLazyContext()
  useEffect(() => {
    if (enabled) requestDisplay()
  }, [enabled, requestDisplay])
  return display
}
