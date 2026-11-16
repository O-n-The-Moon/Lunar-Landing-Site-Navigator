import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  useDisplayTerrain,
  useGrid,
  usePgdaLayers,
  useTerrainHeights,
  type DataSource,
} from './data'

afterEach(cleanup)

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
const bin = (b: ArrayBuffer) => new Response(b, { headers: { 'content-type': 'application/octet-stream' } })

const displayManifest = {
  schemaVersion: 1,
  projection: 'polar-stereographic-south',
  sphereRadiusKm: 1737.4,
  originKm: [-8, -8],
  cellKm: 1,
  nx: 16,
  ny: 16,
  dtype: 'int16-le',
}

const files: Record<string, () => Response> = {
  'ephemeris.json': () => json(fixtureEphemerisManifest),
  'ephemeris.bin': () => bin(fixtureEphemerisBin()),
  'sites.json': () => json(fixtureSitesFile),
  'validation.json': () => json(fixtureValidation),
  'grid.json': () => json(fixtureGridManifest),
  'grid-horizons.bin': () => bin(fixtureGridHorizonsBin()),
  'grid-heights.bin': () => bin(fixtureGridHeightsBin()),
  'pgda-layers.json': () => json(fixturePgdaLayers),
  'terrain-display.json': () => json(displayManifest),
  'terrain-display.bin': () => bin(new Int16Array(displayManifest.nx * displayManifest.ny).fill(7).buffer),
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
    expect(core.ephemerisManifest.kernels).toEqual(fixtureEphemerisManifest.kernels)
    expect(core.sitesFile.sites.map((s) => s.id)).toEqual(['fixture-plateau', 'fixture-ridge'])
    expect(core.validation.schemaVersion).toBe(1)
  })

  it('the fixture source provides the same core shape, including the ephemeris manifest', async () => {
    const core = await fixtureDataSource().loadCore()
    expect(core.ephemerisManifest).toBe(fixtureEphemerisManifest)
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

  it('loads the 2 km heights alone, without the horizon grid', async () => {
    const fetchFn = fakeFetch()
    const field = await fetchDataSource('/data/', fetchFn).loadGridHeights()
    expect(field.source).toBe('grid')
    expect(field.frame.nx).toBe(fixtureGridManifest.nx)
    expect(field.heightM).toHaveLength(fixtureGridManifest.nx * fixtureGridManifest.ny)
    expect(fetchFn.mock.calls.map(([u]) => u)).not.toContain('/data/grid-horizons.bin')
  })

  it('rejects a grid-heights.bin of the wrong size', async () => {
    const short = fakeFetch({ 'grid-heights.bin': () => bin(new ArrayBuffer(10)) })
    await expect(fetchDataSource('/data/', short).loadGridHeights()).rejects.toThrow(/grid-heights\.bin: expected/)
  })

  it('loads the display terrain, and names the missing file when it is absent', async () => {
    const field = await fetchDataSource('/data/', fakeFetch()).loadDisplayTerrain()
    expect(field.source).toBe('display')
    expect(field.frame.nx).toBe(16)
    expect(field.heightM[0]).toBe(7)
    const missing = fakeFetch({ 'terrain-display.json': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) })
    await expect(fetchDataSource('/data/', missing).loadDisplayTerrain()).rejects.toThrow('terrain-display.json: not found')
  })

  it('the fixture source has the 2 km heights but no display terrain', async () => {
    const fixtures = fixtureDataSource()
    expect((await fixtures.loadGridHeights()).source).toBe('grid')
    await expect(fixtures.loadDisplayTerrain()).rejects.toThrow(/not available in fixtures/)
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
  const { state, retry } = useGrid()
  return (
    <p>
      grid {state.status}
      {state.status === 'error' && <button onClick={retry}>retry grid</button>}
    </p>
  )
}

function PgdaStatus() {
  const { state } = usePgdaLayers()
  return <p>pgda {state.status}</p>
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

  it('loads PGDA layers once for several consumers', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadPgda: vi.fn(fixtures.loadPgda) }
    render(
      <DataProvider source={source}>
        <PgdaStatus />
        <PgdaStatus />
      </DataProvider>,
    )
    await waitFor(() => expect(screen.getAllByText('pgda ready')).toHaveLength(2))
    expect(source.loadPgda).toHaveBeenCalledTimes(1)
  })

  it('retries a failed grid load on request', async () => {
    const fixtures = fixtureDataSource()
    const loadGrid = vi.fn<DataSource['loadGrid']>().mockRejectedValueOnce(new Error('grid.json: HTTP 503'))
    loadGrid.mockImplementation(fixtures.loadGrid)
    render(
      <DataProvider source={{ ...fixtures, loadGrid }}>
        <GridStatus />
      </DataProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'retry grid' }))
    expect(await screen.findByText('grid ready')).toBeInTheDocument()
    expect(loadGrid).toHaveBeenCalledTimes(2)
  })

  it('loads again in a new provider that reuses the same source', async () => {
    const source = fixtureDataSource()
    const first = render(
      <DataProvider source={source}>
        <GridStatus />
      </DataProvider>,
    )
    await screen.findByText('grid ready')
    first.unmount()
    render(
      <DataProvider source={source}>
        <GridStatus />
      </DataProvider>,
    )
    expect(await screen.findByText('grid ready')).toBeInTheDocument()
  })
})

describe('terrain hooks', () => {
  function Heights() {
    const { state, retry } = useTerrainHeights()
    return (
      <p>
        heights {state.status}
        {state.status === 'error' && <button onClick={retry}>retry heights</button>}
      </p>
    )
  }
  function Display({ enabled }: { enabled: boolean }) {
    return <p>display {useDisplayTerrain(enabled).status}</p>
  }

  it('loads the 2 km heights once however many components ask, with the grid untouched', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = {
      ...fixtures,
      loadGrid: vi.fn(fixtures.loadGrid),
      loadGridHeights: vi.fn(fixtures.loadGridHeights),
    }
    render(
      <DataProvider source={source}>
        <Heights />
        <Heights />
      </DataProvider>,
    )
    expect((await screen.findAllByText('heights ready')).length).toBe(2)
    expect(source.loadGridHeights).toHaveBeenCalledTimes(1)
    expect(source.loadGrid).not.toHaveBeenCalled()
  })

  it('can retry the 2 km heights after an error', async () => {
    const fixtures = fixtureDataSource()
    const loadGridHeights = vi.fn(fixtures.loadGridHeights).mockRejectedValueOnce(new Error('boom'))
    render(
      <DataProvider source={{ ...fixtures, loadGridHeights }}>
        <Heights />
      </DataProvider>,
    )
    fireEvent.click(await screen.findByText('retry heights'))
    expect(await screen.findByText('heights ready')).toBeInTheDocument()
    expect(loadGridHeights).toHaveBeenCalledTimes(2)
  })

  it('loads the display terrain only once enabled, and reports its absence as an error state', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadDisplayTerrain: vi.fn(fixtures.loadDisplayTerrain) }
    const { rerender } = render(
      <DataProvider source={source}>
        <Display enabled={false} />
      </DataProvider>,
    )
    await waitFor(() => expect(screen.getByText('display idle')).toBeInTheDocument())
    expect(source.loadDisplayTerrain).not.toHaveBeenCalled()
    rerender(
      <DataProvider source={source}>
        <Display enabled />
      </DataProvider>,
    )
    expect(await screen.findByText('display error')).toBeInTheDocument()
    expect(source.loadDisplayTerrain).toHaveBeenCalledTimes(1)
  })
})
