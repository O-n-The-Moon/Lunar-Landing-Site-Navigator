import { useEffect, useId, useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import { colorizeRaster, rampCssGradient, rasterValueAt, type PgdaLayer } from './pgda-raster'
import { MOON_RADIUS_KM, gridExtentKm, kmToLatLon, latLonToKm, ringRadiusKm, type GridExtentInput } from './projection'

// Opportunity map v0 (SPEC-app P0-6): polar-stereographic view of the south pole, PGDA average Sun / Earth raster
// underneath, lat rings, lon spokes and site markers on top. Prop-driven: no engine, no data loading, no scenario state.
// Layers: a <canvas> holds the raster (one pixel per PGDA cell, scaled by CSS); an SVG in map-km units sits on top, so
// rings, markers and the pointer math share one coordinate system. Map y points up, SVG y points down: svg y = −yKm.

export interface MapMarker {
  id: string
  name: string
  latDeg: number
  lonDeg: number
  /** In the current scenario: drawn filled and labelled, and named as such in its title. */
  selected: boolean
}

export interface OpportunityMapProps {
  /** Raster placement (the PGDA manifest's originKm, cellKm, nx, ny). */
  geom: GridExtentInput
  layer: PgdaLayer
  onLayerChange: (layer: PgdaLayer) => void
  /** Decoded 8-bit raster of the shown layer (percent, 255 = no data); null until decoded. */
  values: ArrayLike<number> | null
  markers: readonly MapMarker[]
  /** A click inside the raster: the planetocentric lat/lon (east-positive) under it. */
  onPickPoint: (latDeg: number, lonDeg: number) => void
  /** Provenance line under the map (product, resolution, observer height). */
  sourceNote: string
}

const RING_LATS_DEG = [-85, -88]
const SPOKES: { lonDeg: number; label: string }[] = [
  { lonDeg: 0, label: '0°' },
  { lonDeg: 45, label: '45°E' },
  { lonDeg: 90, label: '90°E' },
  { lonDeg: 135, label: '135°E' },
  { lonDeg: 180, label: '180°' },
  { lonDeg: -135, label: '135°W' },
  { lonDeg: -90, label: '90°W' },
  { lonDeg: -45, label: '45°W' },
]
const LAYER_LABELS: Record<PgdaLayer, string> = { sun: 'Sun average', earth: 'Earth average' }

/** Unit direction of a meridian on the map (lon 0 = +y, east = +x). */
const spokeDir = (lonDeg: number) => ({ dx: Math.sin((lonDeg * Math.PI) / 180), dy: Math.cos((lonDeg * Math.PI) / 180) })

/** "85.12°S 30.40°E" */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(2)}°${latDeg < 0 ? 'S' : 'N'}`
  const lon = `${Math.abs(lonDeg).toFixed(2)}°${lonDeg < 0 ? 'W' : 'E'}`
  return `${lat} ${lon}`
}

export function OpportunityMap({ geom, layer, onLayerChange, values, markers, onPickPoint, sourceNote }: OpportunityMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ xKm: number; yKm: number } | null>(null)
  const layerName = useId()

  const ext = gridExtentKm(geom)
  const widthKm = ext.maxXKm - ext.minXKm
  const heightKm = ext.maxYKm - ext.minYKm
  const halfKm = Math.min(widthKm, heightKm) / 2
  const fontKm = widthKm / 40
  const markerKm = widthKm / 110

  // One pixel per PGDA cell, scaled to the box by CSS. Repainted when the layer or the decoded raster changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, geom.nx, geom.ny) // never leave the previous layer's pixels under the new layer's legend
    if (values) ctx.putImageData(new ImageData(colorizeRaster(values, layer), geom.nx, geom.ny), 0, 0)
  }, [values, layer, geom.nx, geom.ny])

  /** Map km under a pointer event, or null outside the plot or the raster. */
  const toKm = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const u = (e.clientX - rect.left) / rect.width
    const v = (e.clientY - rect.top) / rect.height
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null
    return { xKm: ext.minXKm + u * widthKm, yKm: ext.maxYKm - v * heightKm }
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(toKm(e))
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const p = toKm(e)
    if (!p) return
    const { latDeg, lonDeg } = kmToLatLon(MOON_RADIUS_KM, p.xKm, p.yKm)
    onPickPoint(latDeg, lonDeg)
  }

  let readout = 'Hover the map to read a position.'
  if (hover) {
    const { latDeg, lonDeg } = kmToLatLon(MOON_RADIUS_KM, hover.xKm, hover.yKm)
    readout = formatLatLon(latDeg, lonDeg)
    if (values) {
      const v = rasterValueAt(values, geom, hover.xKm, hover.yKm)
      readout += v === null ? ' · no data' : ` · PGDA ${LAYER_LABELS[layer]} ${v} %`
    }
  }

  return (
    <div className="opportunity-map">
      <div className="map-toolbar">
        <div role="radiogroup" aria-label="Layer" className="map-layers">
          {(Object.keys(LAYER_LABELS) as PgdaLayer[]).map((l) => (
            <label key={l}>
              <input type="radio" name={layerName} checked={layer === l} onChange={() => onLayerChange(l)} /> {LAYER_LABELS[l]}
            </label>
          ))}
        </div>
        <div className="map-legend">
          <span>0 %</span>
          <span className="map-legend-bar" style={{ background: rampCssGradient(layer) }} aria-hidden="true" />
          <span>100 %</span>
        </div>
      </div>

      <div className="map-plot">
        <canvas ref={canvasRef} width={geom.nx} height={geom.ny} className="map-raster" aria-hidden="true" />
        <svg
          className="map-overlay"
          viewBox={`${ext.minXKm} ${-ext.maxYKm} ${widthKm} ${heightKm}`}
          role="img"
          aria-label="Opportunity map of the lunar south pole, polar view, with the PGDA average layer, latitude rings and site markers"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={onClick}
        >
          <g className="map-grid" fill="none">
            {SPOKES.map((s) => {
              const { dx, dy } = spokeDir(s.lonDeg)
              const lenKm = halfKm * 1.45 // past the corners; the SVG clips it
              return <line key={s.lonDeg} x1={0} y1={0} x2={dx * lenKm} y2={-dy * lenKm} vectorEffect="non-scaling-stroke" />
            })}
            {RING_LATS_DEG.map((lat) => (
              <circle key={lat} cx={0} cy={0} r={ringRadiusKm(MOON_RADIUS_KM, lat)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <g className="map-labels" fontSize={fontKm} textAnchor="middle" dominantBaseline="central">
            {SPOKES.map((s) => {
              const { dx, dy } = spokeDir(s.lonDeg)
              return (
                <text key={s.lonDeg} x={dx * halfKm * 0.92} y={-dy * halfKm * 0.92}>
                  {s.label}
                </text>
              )
            })}
            {RING_LATS_DEG.map((lat) => {
              const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, lat, 202.5)
              return (
                <text key={lat} x={xKm} y={-yKm}>
                  {`${Math.abs(lat)}°S`}
                </text>
              )
            })}
          </g>
          <g className="map-markers" fontSize={fontKm}>
            {markers.map((m) => {
              const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, m.latDeg, m.lonDeg)
              return (
                <g key={m.id}>
                  <circle
                    data-testid={`marker-${m.id}`}
                    className={m.selected ? 'marker marker-selected' : 'marker'}
                    cx={xKm}
                    cy={-yKm}
                    r={m.selected ? markerKm * 1.6 : markerKm}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{m.selected ? `${m.name} (in scenario)` : m.name}</title>
                  </circle>
                  {m.selected && (
                    <text x={xKm + markerKm * 2.4} y={-yKm} dominantBaseline="central" aria-hidden="true">
                      {m.name}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <p className="map-readout" role="status" aria-live="off">
        {readout}
      </p>
      <p className="hint">
        Click the map to add that point as a custom site, or type a position under Custom site. Static PGDA long-term average,
        independent of the landing date. {sourceNote}
      </p>
    </div>
  )
}
