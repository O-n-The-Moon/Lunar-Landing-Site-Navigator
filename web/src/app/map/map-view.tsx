// Placeholder from T13 (#7). Owned and replaced by T27 (#28) and T28 (#29).
// Calling useGrid() here starts the lazy grid load the first time the Map tab opens.
import { useGrid } from '../data'

export function MapView() {
  const grid = useGrid()
  return (
    <section className="placeholder" aria-label="Opportunity map">
      <h3>Opportunity map</h3>
      <p>Polar map with PGDA layers and window scores. Coming in T27 #28 and T28 #29.</p>
      <p role="status">
        {grid.status === 'loading' &&
          `Loading horizon grid${grid.progress === null ? '…' : ` ${Math.round(grid.progress * 100)}%`}`}
        {grid.status === 'ready' && `Horizon grid loaded: ${grid.data.manifest.nx} × ${grid.data.manifest.ny} cells`}
        {grid.status === 'error' && `Could not load the horizon grid: ${grid.message}`}
      </p>
    </section>
  )
}
