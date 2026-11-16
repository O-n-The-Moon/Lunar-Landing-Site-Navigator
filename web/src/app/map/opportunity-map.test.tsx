import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpportunityMap, type MapMarker } from './opportunity-map'
import { NO_DATA } from './pgda-raster'
import { latLonToKm, MOON_RADIUS_KM } from './projection'

afterEach(cleanup)
// jsdom has no canvas 2D context; the component must still render (and draw nothing).
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

// 4 × 4 raster of 100 km cells around the pole: x, y ∈ [−200, 200). Top row = highest y.
const geom = { originKm: [-200, -200] as const, cellKm: 100, nx: 4, ny: 4 }
const values = Uint8Array.from([
  10, 11, 12, 13, //
  20, 21, 22, 23, //
  30, 31, 32, NO_DATA, //
  40, 41, 42, 43,
])
const markers: MapMarker[] = [
  { id: 'shackleton', name: 'Shackleton rim', latDeg: -89.7, lonDeg: 120, selected: true },
  { id: 'nobile', name: 'Nobile rim', latDeg: -85.4, lonDeg: 31.5, selected: false },
]

function renderMap(over: Partial<React.ComponentProps<typeof OpportunityMap>> = {}) {
  const onPickPoint = vi.fn()
  const onLayerChange = vi.fn()
  render(
    <OpportunityMap
      geom={geom}
      layer="sun"
      onLayerChange={onLayerChange}
      values={values}
      markers={markers}
      onPickPoint={onPickPoint}
      sourceNote="synthetic test fixture"
      {...over}
    />,
  )
  // The plot is 400 km wide on a 400 px box, so 1 px = 1 km, origin at the top-left corner (x = −200, y = +200).
  const plot = screen.getByRole('img', { name: /opportunity map/i })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 10, top: 20, width: 400, height: 400, right: 410, bottom: 420, x: 10, y: 20, toJSON: () => ({}),
  })
  /** Client position of a map point in km. */
  const at = (xKm: number, yKm: number) => ({ clientX: 10 + (xKm + 200), clientY: 20 + (200 - yKm) })
  return { plot, at, onPickPoint, onLayerChange }
}

describe('OpportunityMap', () => {
  it('draws the 85° and 88° rings and the longitude spokes, labelled', () => {
    renderMap()
    expect(screen.getByText('85°S')).toBeInTheDocument()
    expect(screen.getByText('88°S')).toBeInTheDocument()
    expect(screen.getByText('0°')).toBeInTheDocument()
    expect(screen.getByText('90°E')).toBeInTheDocument()
    expect(screen.getByText('90°W')).toBeInTheDocument()
    expect(screen.getByText('180°')).toBeInTheDocument()
  })

  it('places a marker at its projected position, y up', () => {
    renderMap()
    const m = screen.getByTestId('marker-nobile')
    const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, -85.4, 31.5)
    // viewBox is in km with y flipped: svg y = −yKm
    expect(Number(m.getAttribute('cx'))).toBeCloseTo(xKm, 6)
    expect(Number(m.getAttribute('cy'))).toBeCloseTo(-yKm, 6)
  })

  it('names every marker and marks the ones in the scenario in text, not just color', () => {
    renderMap()
    expect(within(screen.getByTestId('marker-shackleton')).getByText(/Shackleton rim.*in scenario/i)).toBeInTheDocument()
    expect(within(screen.getByTestId('marker-nobile')).getByText('Nobile rim')).toBeInTheDocument()
  })

  it('shows the lat/lon and PGDA value under the pointer', () => {
    const { plot, at } = renderMap()
    fireEvent.pointerMove(plot, at(150, 150)) // column 3, top row → 13
    const readout = screen.getByRole('status')
    expect(readout).toHaveTextContent(/PGDA Sun average 13 ?%/)
    expect(readout).toHaveTextContent(/°S/)
  })

  it('says "no data" over a no-data cell and clears the readout when the pointer leaves', () => {
    const { plot, at } = renderMap()
    fireEvent.pointerMove(plot, at(150, -50)) // column 3, third row → 255
    expect(screen.getByRole('status')).toHaveTextContent(/no data/i)
    fireEvent.pointerLeave(plot)
    expect(screen.getByRole('status')).toHaveTextContent(/hover the map/i)
  })

  it('reports the point under a click as lat/lon (round trip of the projection)', () => {
    const { plot, at, onPickPoint } = renderMap()
    const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, -86, 45)
    fireEvent.click(plot, at(xKm, yKm))
    expect(onPickPoint).toHaveBeenCalledTimes(1)
    const [lat, lon] = onPickPoint.mock.calls[0]
    expect(lat).toBeCloseTo(-86, 6)
    expect(lon).toBeCloseTo(45, 6)
  })

  it('does not report clicks outside the raster', () => {
    const { plot, onPickPoint } = renderMap()
    fireEvent.click(plot, { clientX: 5, clientY: 5 })
    expect(onPickPoint).not.toHaveBeenCalled()
  })

  it('switches the layer with a labelled control and says which layer is shown', () => {
    const { onLayerChange } = renderMap()
    const group = screen.getByRole('radiogroup', { name: /layer/i })
    expect(within(group).getByRole('radio', { name: /sun/i })).toBeChecked()
    fireEvent.click(within(group).getByRole('radio', { name: /earth/i }))
    expect(onLayerChange).toHaveBeenCalledWith('earth')
  })

  it('states what the layer is: PGDA, not our terrain-aware window result', () => {
    renderMap()
    expect(screen.getByText(/synthetic test fixture/)).toBeInTheDocument()
    expect(screen.getByText(/long-term average/i)).toBeInTheDocument()
  })

  it('renders without a decoded raster (readout then has no value)', () => {
    const { plot, at } = renderMap({ values: null })
    fireEvent.pointerMove(plot, at(0, 0))
    expect(screen.getByRole('status')).not.toHaveTextContent(/PGDA Sun average/)
  })
})
