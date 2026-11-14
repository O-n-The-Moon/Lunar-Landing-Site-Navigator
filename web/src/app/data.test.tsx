import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fixtureEphemerisBin,
  fixtureEphemerisManifest,
  fixtureGridHeightsBin,
  fixtureGridHorizonsBin,
  fixtureGridManifest,
  fixturePgdaLayers,
  fixtureSitesFile,
  fixtureValidation,
} from '../engine/__fixtures__'
import {
  DataProvider,
  fetchDataSource,
  fixtureDataSource,
  useCoreDataState,
  useGrid,
  type DataSource,
} from './data'

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
const bin = (b: ArrayBuffer) => new Response(b, { headers: { 'content-type': 'application/octet-stream' } })

const files: Record<string, () => Response> = {
  'ephemeris.json': () => json(fixtureEphemerisManifest),
  'ephemeris.bin': () => bin(fixtureEphemerisBin()),
  'sites.json': () => json(fixtureSitesFile),
  'validation.json': () => json(fixtureValidation),
  'grid.json': () => json(fixtureGridManifest),
  'grid-horizons.bin': () => bin(fixtureGridHorizonsBin()),
  'grid-heights.bin': () => bin(fixtureGridHeightsBin()),
  'pgda-layers.json': () => json(fixturePgdaLayers),
}

/** Serves `files` under /data/; anything else gets index.html, like Vite's dev server. */
const fakeFetch = (overrides: Record<string, () => Response> = {}) =>
  vi.fn(async (url: string) => {
    const file = url.replace('/data/', '')
    const make = overrides[file] ?? files[file]
    return make ? make() : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  })

describe('fetchDataSource', () => {
  it('loads and decodes the core contract files', async () => {
    const core = await fetchDataSource('/data/', fakeFetch()).loadCore()
    expect(core.ephemeris.count).toBe(fixtureEphemerisManifest.count)
    expect(core.sitesFile.sites.map((s) => s.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    expect(core.validation.schemaVersion).toBe(1)
  })

  it('names the missing file when the server falls back to index.html', async () => {
    const fetchFn = fakeFetch({ 'sites.json': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })
    await expect(fetchDataSource('/data/', fetchFn).loadCore()).rejects.toThrow('sites.json: not found')
  })

  it('reports HTTP errors and contract violations', async () => {
    const http = fakeFetch({ 'ephemeris.bin': () => new Response('', { status: 500 }) })
    await expect(fetchDataSource('/data/', http).loadCore()).rejects.toThrow('ephemeris.bin: HTTP 500')
    const bad = fakeFetch({ 'validation.json': () => json({ schemaVersion: 2 }) })
    await expect(fetchDataSource('/data/', bad).loadCore()).rejects.toThrow(/validation\.json: unsupported schemaVersion/)
  })

  it('loads the grid with progress up to 1', async () => {
    const progress: (number | null)[] = []
    const grid = await fetchDataSource('/data/', fakeFetch()).loadGrid((p) => progress.push(p))
    expect(grid.manifest.nx).toBe(fixtureGridManifest.nx)
    expect(progress.at(-1)).toBe(1)
  })

  it('resolves PGDA layer URLs against the base URL', async () => {
    const pgda = await fetchDataSource('/data/', fakeFetch()).loadPgda()
    expect(pgda.urls).toEqual({ sun: '/data/pgda-sun.png', earth: '/data/pgda-earth.png' })
  })
})

function CoreStatus() {
  const { core, kind, fallbackReason } = useCoreDataState()
  return (
    <p>
      {core.status} {kind} {fallbackReason ?? 'no-fallback'} {core.status === 'error' ? core.message : ''}
    </p>
  )
}

function GridStatus() {
  const grid = useGrid()
  return <p>grid {grid.status}</p>
}

describe('DataProvider', () => {
  it('shows a load error instead of rendering nothing', async () => {
    render(
      <DataProvider source={fetchDataSource('/data/', fakeFetch({ 'sites.json': () => new Response('', { status: 404 }) }))}>
        <CoreStatus />
      </DataProvider>,
    )
    expect(await screen.findByText(/error data no-fallback sites\.json: HTTP 404/)).toBeInTheDocument()
  })

  it('switches to the fallback source when real data is missing, and says why', async () => {
    const empty = fetchDataSource('/data/', fakeFetch({ 'ephemeris.json': () => new Response('', { status: 404 }) }))
    render(
      <DataProvider source={empty} fallback={fixtureDataSource()}>
        <CoreStatus />
      </DataProvider>,
    )
    expect(await screen.findByText(/ready fixtures ephemeris\.json: HTTP 404/)).toBeInTheDocument()
  })

  it('loads the grid only once something asks for it', async () => {
    const source: DataSource = { ...fixtureDataSource(), loadGrid: vi.fn(fixtureDataSource().loadGrid) }
    const { rerender } = render(
      <DataProvider source={source}>
        <CoreStatus />
      </DataProvider>,
    )
    await screen.findByText(/^ready/)
    expect(source.loadGrid).not.toHaveBeenCalled()

    rerender(
      <DataProvider source={source}>
        <CoreStatus />
        <GridStatus />
        <GridStatus />
      </DataProvider>,
    )
    await waitFor(() => expect(screen.getAllByText('grid ready')).toHaveLength(2))
    expect(source.loadGrid).toHaveBeenCalledTimes(1)
  })
})
