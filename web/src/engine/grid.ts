// Grid scoring and cell lookup. Implemented by T25.
import type { Ephemeris, Grid, GridCellRef, GridScores, VisibilityOpts } from './types'
import { notImplemented } from './types'

/** Sun / Earth / both % per cell over [startMs, endMs): hourly samples at startMs, startMs + 1 h, …, each standing for one hour. */
export function scoreGrid(grid: Grid, eph: Ephemeris, startMs: number, endMs: number, opts: VisibilityOpts): GridScores {
  return notImplemented('scoreGrid', grid, eph, startMs, endMs, opts)
}

/** Grid cell whose center is nearest to (lat, lon), or null outside coverage. */
export function nearestGridCell(grid: Grid, latDeg: number, lonDeg: number): GridCellRef | null {
  return notImplemented('nearestGridCell', grid, latDeg, lonDeg)
}
