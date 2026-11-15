// Unrolled 360° horizon panorama for one site (SPEC-app P0-5), not a fisheye: at the pole everything sits within
// a few degrees of the horizon. x = azimuth 0–360 (N at the left), y = elevation −5…+12°, vertically exaggerated
// (labelled). Sun and Earth disks are drawn to angular scale on both axes, so they are ellipses here.
// Prop-driven: positions, radii and lit state come from the engine (via the panel); this component does no physics.
// Mission tracks, hover readout and re-centering come in T22 #23.

/** Panorama elevation range, degrees. */
export const ELEV_MIN_DEG = -5
export const ELEV_MAX_DEG = 12
/** viewBox units per degree. The SVG keeps its aspect ratio, so the exaggeration below is exact on screen. */
export const AZ_UNITS_PER_DEG = 3
export const ELEV_UNITS_PER_DEG = 15
const EXAGGERATION = ELEV_UNITS_PER_DEG / AZ_UNITS_PER_DEG

const PLOT_W = 360 * AZ_UNITS_PER_DEG
const PLOT_H = (ELEV_MAX_DEG - ELEV_MIN_DEG) * ELEV_UNITS_PER_DEG
const PAD = { left: 36, right: 8, top: 22, bottom: 26 }
const FONT = 12

export const azToX = (azDeg: number) => azDeg * AZ_UNITS_PER_DEG
export const elevToY = (elevDeg: number) => (ELEV_MAX_DEG - elevDeg) * ELEV_UNITS_PER_DEG
const clampElev = (e: number) => Math.min(ELEV_MAX_DEG, Math.max(ELEV_MIN_DEG, e))

/** One body at the cursor time. */
export interface PanoramaBody {
  azDeg: number
  elevDeg: number
  /** Terrain horizon elevation at the body's azimuth. */
  horizonDeg: number
  /** Apparent angular radius (Sun ≈ 0.27°, Earth ≈ 0.95°). */
  radiusDeg: number
  /** Whether the timeline counts it as visible at the cursor (Sun lit / Earth in view). */
  visible: boolean
}

export interface HorizonPanoramaProps {
  siteName: string
  /** Terrain horizon elevation per azimuth bin, for the observer height below. */
  horizonMaskDeg: ArrayLike<number>
  azStepDeg: number
  observerHeightM: number
  sun: PanoramaBody
  earth: PanoramaBody
}

const AZ_TICKS = [
  [0, 'N'],
  [45, '45°'],
  [90, 'E'],
  [135, '135°'],
  [180, 'S'],
  [225, '225°'],
  [270, 'W'],
  [315, '315°'],
  [360, 'N'],
] as const
const ELEV_TICKS = [-5, 0, 5, 10]
const fmtDeg = (d: number, digits = 1) => `${d < 0 ? '−' : ''}${Math.abs(d).toFixed(digits)}°`

const BODIES = [
  { key: 'sun', label: 'Sun', color: 'var(--warn)', on: 'lit', off: 'blocked' },
  { key: 'earth', label: 'Earth', color: 'var(--accent)', on: 'in view', off: 'not in view' },
] as const

/** Filled silhouette: one point per mask bin plus the 360° wrap, closed along the bottom edge. */
function terrainPath(maskDeg: ArrayLike<number>, azStepDeg: number): string {
  const y = (e: number) => elevToY(clampElev(e))
  let d = `M0,${y(maskDeg[0])}`
  for (let i = 1; i < maskDeg.length; i++) d += ` L${azToX(i * azStepDeg)},${y(maskDeg[i])}`
  return `${d} L${PLOT_W},${y(maskDeg[0])} L${PLOT_W},${PLOT_H} L0,${PLOT_H} Z`
}

function BodyMark({ b, label, color }: { b: PanoramaBody; label: string; color: string }) {
  const x = azToX(b.azDeg)
  if (b.elevDeg < ELEV_MIN_DEG || b.elevDeg > ELEV_MAX_DEG) {
    const below = b.elevDeg < ELEV_MIN_DEG
    return (
      <text x={x} y={below ? PLOT_H - 4 : FONT} textAnchor="middle" fontSize={FONT} fill={color}>
        {below ? `${label} below ${fmtDeg(ELEV_MIN_DEG, 0)} ↓` : `${label} above +${ELEV_MAX_DEG}° ↑`}
      </text>
    )
  }
  const cy = elevToY(b.elevDeg)
  const ry = b.radiusDeg * ELEV_UNITS_PER_DEG
  return (
    <g>
      {/* Not visible: dashed outline only, so the disk stays findable behind the terrain. */}
      <ellipse
        data-body={label.toLowerCase()}
        cx={x}
        cy={cy}
        rx={b.radiusDeg * AZ_UNITS_PER_DEG}
        ry={ry}
        fill={b.visible ? color : 'none'}
        stroke={color}
        strokeWidth={1}
        strokeDasharray={b.visible ? undefined : '2 2'}
        vectorEffect="non-scaling-stroke"
      />
      <text x={x} y={cy - ry - 4} textAnchor="middle" fontSize={FONT} fill={color}>
        {label}
      </text>
    </g>
  )
}

export function HorizonPanorama({ siteName, horizonMaskDeg, azStepDeg, observerHeightM, sun, earth }: HorizonPanoramaProps) {
  const bodies = { sun, earth }
  const status = BODIES.map(({ key, label, on, off }) => {
    const b = bodies[key]
    return `${label} ${b.visible ? on : off}: az ${fmtDeg(b.azDeg)}, elev ${fmtDeg(b.elevDeg, 2)}, terrain ${fmtDeg(b.horizonDeg, 2)}`
  })

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'baseline' }}>
        <strong>{siteName}</strong>
        {status.map((s) => (
          <span key={s} className="num">
            {s}
          </span>
        ))}
      </figcaption>
      <svg
        role="img"
        aria-label={`${siteName} horizon panorama at the cursor time. ${status.join('. ')}.`}
        viewBox={`${-PAD.left} ${-PAD.top} ${PLOT_W + PAD.left + PAD.right} ${PLOT_H + PAD.top + PAD.bottom}`}
        width="100%"
        style={{ display: 'block', height: 'auto' }}
      >
        <rect x={0} y={0} width={PLOT_W} height={PLOT_H} fill="var(--surface-2)" />
        {ELEV_TICKS.map((e) => (
          <g key={e}>
            <line
              x1={0}
              x2={PLOT_W}
              y1={elevToY(e)}
              y2={elevToY(e)}
              stroke="var(--border)"
              strokeDasharray={e === 0 ? undefined : '4 4'}
              vectorEffect="non-scaling-stroke"
            />
            <text x={-6} y={elevToY(e) + FONT / 3} textAnchor="end" fontSize={FONT} fill="var(--text-muted)">
              {fmtDeg(e, 0)}
            </text>
          </g>
        ))}
        {AZ_TICKS.map(([az, label]) => (
          <text key={az} x={azToX(az)} y={PLOT_H + FONT + 6} textAnchor="middle" fontSize={FONT} fill="var(--text-muted)">
            {label}
          </text>
        ))}
        <path data-terrain="" d={terrainPath(horizonMaskDeg, azStepDeg)} fill="var(--border)" stroke="var(--text-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {BODIES.map(({ key, label, color }) => (
          <BodyMark key={key} b={bodies[key]} label={label} color={color} />
        ))}
        <text x={0} y={-8} fontSize={FONT} fill="var(--text-muted)">
          Vertical exaggeration {EXAGGERATION}×
        </text>
        <text x={PLOT_W} y={-8} textAnchor="end" fontSize={FONT} fill="var(--text-muted)">
          Terrain horizon at {observerHeightM} m observer height · elevation 0° = local spherical horizontal
        </text>
      </svg>
    </figure>
  )
}
