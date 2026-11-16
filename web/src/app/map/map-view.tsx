// Opportunity map tab (SPEC-app P0-6). v0: static PGDA average Sun / Earth layers. v1 (#29): this mission window's
// Sun / Earth / Both scores for the 2 km grid, from `scoreGrid` in a Web Worker (`score-layer.ts`, debounced 300 ms).
// Curated and scenario site markers, hover readout, click → custom site.
// Opening this tab starts the lazy loads of the PGDA layers and of the terrain grid (scoring and snapping a clicked point).
import { useMemo, useState } from 'react'
import { nearestGridCell } from '../../engine'
import { useCoreData, useGrid, usePgdaLayers } from '../data'
import { customSiteLabel } from '../controls/custom-site'
import { MAX_SITES, customSiteId, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch, type MapLayer } from '../state'
import { customSiteName, missionInCoverage, visibilityOpts } from '../use-scenario-results'
import { LAYER_META, OpportunityMap, type MapMarker } from './opportunity-map'
import { scoresToRaster, useGridScores } from './score-layer'
import { usePgdaValues } from './use-pgda-values'

/** `active`: the Map tab is showing. A hidden map does not score (one worker, ~13 MB copied into it, is enough). */
export function MapView({ active = true }: { active?: boolean }) {
  const { state: pgda, retry: retryPgda } = usePgdaLayers()
  const { state: grid, retry: retryGrid } = useGrid()
  const { sitesFile, ephemeris } = useCoreData()
  const scenario = useScenario()
  const { sites, mapLayer: layer, sunThreshold, earthMarginDeg } = scenario
  const dispatch = useScenarioDispatch()
  const setLayer = (l: MapLayer) => {
    setMessage(null) // an old "Added …" / "already in the scenario" no longer describes what is on screen
    dispatch({ type: 'setMapLayer', layer: l })
  }
  const [message, setMessage] = useState<string | null>(null)
  const meta = LAYER_META[layer]
  const pgdaValues = usePgdaValues(
    pgda.status === 'ready' && meta.source === 'pgda' ? pgda.data.urls[meta.ramp === 'earth' ? 'earth' : 'sun'] : undefined,
  )

  // Window scores: the slipped mission window, scored while this tab is showing. `opts` must be stable (it is an effect
  // dependency of the debounce), so it is memoized on the two settings it is made of.
  const gridData = grid.status === 'ready' ? grid.data : null
  const startMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)
  const inCoverage = missionInCoverage(ephemeris, startMs, scenario.durationH)
  const opts = useMemo(() => visibilityOpts({ sunThreshold, earthMarginDeg }), [sunThreshold, earthMarginDeg])
  const scores = useGridScores(gridData, ephemeris, startMs, endMs, opts, active && inCoverage)
  const shownScores =
    scores.status === 'ready' ? scores.scores : scores.status === 'computing' || scores.status === 'error' ? scores.previous : null
  const scoreRaster = useMemo(() => {
    if (!gridData || !shownScores) return null
    const field = layer === 'score-sun' ? shownScores.sunPct : layer === 'score-earth' ? shownScores.earthPct : shownScores.bothPct
    return scoresToRaster(field, gridData.manifest.nx, gridData.manifest.ny)
  }, [gridData, shownScores, layer])

  // Each layer is drawn in its own file's geometry; before that file is there, the other one keeps the map on screen.
  const pgdaGeom = pgda.status === 'ready' ? pgda.data.manifest : null
  const gridGeom = gridData ? gridData.manifest : null
  const geom = meta.source === 'pgda' ? (pgdaGeom ?? gridGeom) : (gridGeom ?? pgdaGeom)
  const values = meta.source === 'pgda' ? (pgdaGeom ? pgdaValues : null) : scoreRaster

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
      {geom && (
        <OpportunityMap
          geom={geom}
          layer={layer}
          onLayerChange={setLayer}
          values={values}
          markers={markers}
          onPickPoint={pickPoint}
          sourceNote={
            pgda.status === 'ready'
              ? `Source: ${pgda.data.manifest.source}, ${pgda.data.manifest.resolutionM} m, observer height ${
                  pgda.data.manifest.observerHeightM === null ? 'not documented by PGDA' : `${pgda.data.manifest.observerHeightM} m`
                }.`
              : ''
          }
        />
      )}
      {meta.source === 'window' && <p role="status">{scoreStatus(scores, gridData !== null, inCoverage)}</p>}
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

/** One line on the state of the window-score job (the grid itself has its own status line below the map). */
function scoreStatus(scores: ReturnType<typeof useGridScores>, gridReady: boolean, inCoverage: boolean): string {
  if (!inCoverage) return 'The mission window is outside the ephemeris, so there is nothing to score.'
  if (scores.status === 'unsupported') return 'Window scores need Web Workers, which this browser lacks.'
  if (!gridReady) return 'Window scores wait for the terrain grid.'
  if (scores.status === 'error') return `Scoring failed: ${scores.message}`
  if (scores.status === 'computing') return `Scoring the 2 km grid… ${Math.round(scores.progress * 100)} %`
  if (scores.status === 'ready') return `Scored the 2 km grid in ${(scores.elapsedMs / 1000).toFixed(1)} s.`
  return 'Scoring starts a moment after the window stops changing.'
}
