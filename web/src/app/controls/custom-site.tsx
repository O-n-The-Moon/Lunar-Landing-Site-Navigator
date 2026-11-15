// Custom site (SPEC-app P0-2): a typed lat/lon snapped to the nearest terrain-grid cell. Its horizon is that cell's
// (2 m observer, grid-approximate); curated sites never use the grid. The ~12 MB grid loads once the user types here.
import { useId, useState, type FormEvent } from 'react'
import { nearestGridCell, type Grid } from '../../engine'
import { useGrid } from '../data'
import { MAX_SITES, customSiteId, useScenario, useScenarioDispatch, type ScenarioAction, type ScenarioSite } from '../state'
import { customSiteName } from '../use-scenario-results'

/** "Custom 85.12°S 30.40°E (snapped 0.8 km)": the point as entered and its distance to the grid cell used. */
export const customSiteLabel = (latDeg: number, lonDeg: number, snapDistKm: number) =>
  `${customSiteName(latDeg, lonDeg)} (snapped ${snapDistKm.toFixed(1)} km)`

type Outcome = { kind: 'error'; text: string } | { kind: 'added'; text: string }

/** Parses and range-checks the inputs; longitude may be given 0–360 and comes back in −180…180. */
function parseLatLon(latText: string, lonText: string): { latDeg: number; lonDeg: number } | string {
  const latDeg = Number(latText)
  const lonDeg = Number(lonText)
  if (latText.trim() === '' || lonText.trim() === '' || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    return 'Enter latitude and longitude in decimal degrees.'
  }
  if (Math.abs(latDeg) > 90) return 'Latitude must be between −90° and 90°.'
  if (lonDeg < -180 || lonDeg > 360) return 'Longitude must be between −180° and 360° (east-positive).'
  return { latDeg, lonDeg: lonDeg > 180 ? lonDeg - 360 : lonDeg }
}

type SnapResult = { error: string } | { action: Extract<ScenarioAction, { type: 'addCustomSite' }>; label: string }

/** Snaps the point and returns the action to add it, or why it can't be added. */
function snap(grid: Grid, sites: readonly ScenarioSite[], latDeg: number, lonDeg: number): SnapResult {
  const cell = nearestGridCell(grid, latDeg, lonDeg)
  if (!cell) {
    const sign = latDeg > 0 ? ' South latitudes are negative.' : ''
    return { error: `Outside the terrain grid (about 84°S to the pole), or no terrain data there.${sign}` }
  }
  if (sites.some((x) => x.id === customSiteId(cell))) return { error: 'That grid cell is already in the scenario.' }
  return { action: { type: 'addCustomSite', latDeg, lonDeg, cell }, label: customSiteLabel(latDeg, lonDeg, cell.snapDistKm) }
}

export function CustomSite() {
  const { sites } = useScenario()
  const dispatch = useScenarioDispatch()
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // The grid starts loading on the first keystroke (or submit): not at startup, and not when tabbing past.
  const [wanted, setWanted] = useState(false)
  const { state: grid, retry } = useGrid(wanted)
  const latId = useId()
  const lonId = useId()
  const messageId = useId()

  const full = sites.length >= MAX_SITES
  const gridReady = grid.status === 'ready'

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setWanted(true)
    if (full) return
    const point = parseLatLon(latText, lonText)
    if (typeof point === 'string') return setOutcome({ kind: 'error', text: point })
    if (!gridReady) return setOutcome({ kind: 'error', text: 'The terrain grid is still loading. Try again in a moment.' })
    const result = snap(grid.data, sites, point.latDeg, point.lonDeg)
    if ('error' in result) return setOutcome({ kind: 'error', text: result.error })
    dispatch(result.action)
    setOutcome({ kind: 'added', text: `Added ${result.label}` })
    setLatText('')
    setLonText('')
  }

  /** Typing starts the grid load and clears the last message (it would be stale). */
  const onEdit = (set: (v: string) => void, v: string) => {
    set(v)
    setWanted(true)
    setOutcome(null)
  }

  const invalid = outcome?.kind === 'error'
  const inputProps = {
    type: 'number',
    step: 'any',
    disabled: full,
    'aria-invalid': invalid,
    'aria-describedby': invalid ? messageId : undefined,
  } as const

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset className="control">
        <legend>Custom site</legend>
        <label htmlFor={latId}>Latitude (°, south negative)</label>
        <input
          id={latId}
          {...inputProps}
          placeholder="-85.12"
          value={latText}
          onChange={(e) => onEdit(setLatText, e.target.value)}
        />
        <label htmlFor={lonId}>Longitude (°E)</label>
        <input
          id={lonId}
          {...inputProps}
          placeholder="30.40"
          value={lonText}
          onChange={(e) => onEdit(setLonText, e.target.value)}
        />
        <button type="submit" disabled={full || (wanted && !gridReady)}>
          Snap &amp; add
        </button>

        {full ? (
          <p className="hint">Maximum {MAX_SITES} sites. Remove one to add a custom site.</p>
        ) : (
          <p className="hint">Snaps to the nearest terrain-grid cell; 2 m observer, grid-approximate terrain.</p>
        )}
        {grid.status === 'loading' && (
          <p className="hint" role="status">
            Loading terrain grid{grid.progress === null ? '…' : ` ${Math.round(grid.progress * 100)}%`}
          </p>
        )}
        {grid.status === 'error' && (
          <div className="row">
            <p className="hint error" role="alert">
              Could not load the terrain grid: {grid.message}
            </p>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        )}
        {outcome?.kind === 'error' && (
          <p id={messageId} className="hint error" role="alert">
            {outcome.text}
          </p>
        )}
        <p className="hint num" role="status">
          {outcome?.kind === 'added' ? outcome.text : ''}
        </p>
      </fieldset>
    </form>
  )
}
