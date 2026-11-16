// Colour overlays the 3D terrain can show in place of the live shadows (same layers and ramps as the 2D map).
import type { RampName } from '../map/colormaps'
import type { MapLayer } from '../state'

export interface OverlayOption {
  id: MapLayer
  label: string
  ramp: RampName
  source: 'window' | 'pgda'
  title: string
}

export const OVERLAYS: readonly OverlayOption[] = [
  { id: 'score-both', label: 'Both', ramp: 'both', source: 'window', title: 'Share of the mission with Sun and an Earth link at once' },
  { id: 'score-sun', label: 'Sun', ramp: 'sun', source: 'window', title: 'Share of the mission that is sunlit' },
  { id: 'score-earth', label: 'Earth', ramp: 'earth', source: 'window', title: 'Share of the mission with a direct-to-Earth line of sight' },
  { id: 'pgda-sun', label: 'PGDA Sun', ramp: 'sun', source: 'pgda', title: 'Long-term average Sun visibility (NASA PGDA)' },
  { id: 'pgda-earth', label: 'PGDA Earth', ramp: 'earth', source: 'pgda', title: 'Long-term average Earth visibility (NASA PGDA)' },
]
