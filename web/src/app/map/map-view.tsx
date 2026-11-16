// Opportunity map tab (SPEC-app P0-6). v0: static PGDA average Sun / Earth layers, curated and scenario site markers,
// hover readout, click → custom site. The window-score layer (v1, scoreGrid in a worker) is a separate issue.
// Opening this tab starts the lazy loads of the PGDA layers and of the terrain grid (needed to snap a clicked point).
import { useState } from 'react'
import { nearestGridCell } from '../../engine'
import { useCoreData, useGrid, usePgdaLayers } from '../data'
import { customSiteLabel } from '../controls/custom-site'
import { MAX_SITES, customSiteId, useScenario, useScenarioDispatch } from '../state'
import { customSiteName } from '../use-scenario-results'
import { OpportunityMap, type MapMarker } from './opportunity-map'
import type { PgdaLayer } from './pgda-raster'
import { usePgdaValues } from './use-pgda-values'

export function MapView() {
  const { state: pgda, retry: retryPgda } = usePgdaLayers()
  const { state: grid, retry: retryGrid } = useGrid()
  const { sitesFile } = useCoreData()
  const { sites } = useScenario()
  const dispatch = useScenarioDispatch()
  const [layer, setLayer] = useState<PgdaLayer>('sun')
  const [message, setMessage] = useState<string | null>(null)
  const values = usePgdaValues(pgda.status === 'ready' ? pgda.data.urls[layer] : undefined)

  const inScenario = new Set(sites.map((s) => s.id))
  const markers: MapMarker[] = [
    ...sitesFile.sites.map((s) => ({ id: s.id, name: s.name, latDeg: s.latDeg, lonDeg: s.lonDeg, selected: inScenario.has(s.id) })),
    ...sites.flatMap((s) =>
      s.kind === 'custom'
        ? [{ id: s.id, name: customSiteName(s.latDeg, s.lonDeg), latDeg: s.latDeg, lonDeg: s.lonDeg, selected: true }]
        : [],
    ),
  ]

  const pickPoint = (latDeg: number, lonDeg: number) => {
    if (grid.status !== 'ready') return setMessage('The terrain grid is still loading. Try again in a moment.')
    const cell = nearestGridCell(grid.data, latDeg, lonDeg)
    if (!cell) return setMessage('No terrain data at that point (outside the terrain grid or a no-data cell).')
    if (sites.some((s) => s.id === customSiteId(cell))) return setMessage('That grid cell is already in the scenario.')
    if (sites.length >= MAX_SITES) return setMessage(`The scenario already has ${MAX_SITES} sites. Remove one first.`)
    dispatch({ type: 'addCustomSite', latDeg, lonDeg, cell })
    setMessage(`Added ${customSiteLabel(latDeg, lonDeg, cell.snapDistKm)}`)
  }

  return (
    <section className="map-view" aria-label="Opportunity map">
      <h3>Opportunity map</h3>
      {pgda.status === 'ready' && (
        <OpportunityMap
          geom={pgda.data.manifest}
          layer={layer}
          onLayerChange={setLayer}
          values={values}
          markers={markers}
          onPickPoint={pickPoint}
          sourceNote={`Source: ${pgda.data.manifest.source}, ${pgda.data.manifest.resolutionM} m, observer height ${
            pgda.data.manifest.observerHeightM === null ? 'not documented by PGDA' : `${pgda.data.manifest.observerHeightM} m`
          }.`}
        />
      )}
      {(pgda.status === 'idle' || pgda.status === 'loading') && <p role="status">Loading PGDA layers…</p>}
      {pgda.status === 'error' && (
        <p role="alert">
          Could not load the PGDA layers: {pgda.message}{' '}
          <button type="button" onClick={retryPgda}>
            Retry
          </button>
        </p>
      )}

      {message && <p role="status">{message}</p>}
      <p role="status">
        {grid.status === 'loading' &&
          `Loading horizon grid${grid.progress === null ? '…' : ` ${Math.round(grid.progress * 100)}%`} (needed to add a clicked point)`}
        {grid.status === 'ready' && `Horizon grid loaded: ${grid.data.manifest.nx} × ${grid.data.manifest.ny} cells`}
        {grid.status === 'error' && `Could not load the horizon grid: ${grid.message}`}
      </p>
      {grid.status === 'error' && (
        <button type="button" onClick={retryGrid}>
          Retry
        </button>
      )}
    </section>
  )
}
