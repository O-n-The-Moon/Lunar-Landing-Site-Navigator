import { useId } from 'react'
import { horizonElevAt } from '../../engine'
import type { DayTick, MissionTracks, TrackPoint } from './tracks'

// Unrolled 360° horizon panorama for one site (SPEC-app P0-5), not a fisheye: at the pole everything sits within
// a few degrees of the horizon. x = azimuth over 360° (N at the edges unless re-centered), y = elevation −5…+12°, vertically exaggerated
// (labelled). Sun and Earth disks are drawn to angular scale on both axes, so they are tall ovals here.
// Prop-driven: positions, radii and lit state come from the engine (via the panel); this component does no physics.

/** Panorama elevation range, degrees. */
export const ELEV_MIN_DEG = -5
export const ELEV_MAX_DEG = 12
/** viewBox units per degree. The SVG keeps its aspect ratio, so the exaggeration below is exact on screen. */
export const AZ_UNITS_PER_DEG = 3
export const ELEV_UNITS_PER_DEG = 15
const EXAGGERATION = ELEV_UNITS_PER_DEG / AZ_UNITS_PER_DEG

const PLOT_W = 360 * AZ_UNITS_PER_DEG
const PLOT_H = (ELEV_MAX_DEG - ELEV_MIN_DEG) * ELEV_UNITS_PER_DEG
// Right padding fits half an azimuth label ("315°") at the right edge, which a re-centered view can put there.
const PAD = { left: 36, right: 20, top: 22, bottom: 26 }
const FONT = 12

/** x of an azimuth measured from the plot's left edge (0…360°). */
export const azToX = (azDeg: number) => azDeg * AZ_UNITS_PER_DEG
/** d mod 360 in [0, 360); exact (no round trip through +360) for d already in range. */
const mod360 = (d: number) => {
  const r = d % 360
  const v = r < 0 ? r + 360 : r
  return v >= 360 ? 0 : v // a tiny negative r rounds up to 360
}
/** Plot x of an azimuth, for a view whose left edge is at `leftAzDeg`: always in [0, PLOT_W). */
const screenX = (azDeg: number, leftAzDeg: number) => azToX(mod360(azDeg - leftAzDeg))
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
  /** Azimuth at the middle of the plot. Default 180° (S): N at both edges. */
  centerAzDeg?: number
  /** Sun / Earth tracks over the mission, with day ticks; omit to draw none. */
  tracks?: MissionTracks
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
] as const
const ELEV_TICKS = [-5, 0, 5, 10]
const fmtDeg = (d: number, digits = 1) => `${d < 0 ? '−' : ''}${Math.abs(d).toFixed(digits)}°`

const BODIES = [
  { key: 'sun', label: 'Sun', color: 'var(--warn)', on: 'lit', off: 'blocked' },
  { key: 'earth', label: 'Earth', color: 'var(--accent)', on: 'in view', off: 'not in view' },
] as const

/**
 * Filled silhouette, closed along the bottom edge: the horizon at the left edge, one point per mask bin strictly
 * inside the plot (left to right), and the same left-edge horizon again at the right edge (the 360° wrap).
 */
function terrainPath(maskDeg: ArrayLike<number>, azStepDeg: number, leftAzDeg: number): string {
  const y = (e: number) => elevToY(clampElev(e))
  const edgeY = y(horizonElevAt(maskDeg, azStepDeg, leftAzDeg))
  const pts: [number, number][] = []
  for (let i = 0; i < maskDeg.length; i++) {
    const x = screenX(i * azStepDeg, leftAzDeg)
    if (x > 0 && x < PLOT_W) pts.push([x, y(maskDeg[i])])
  }
  pts.sort((a, b) => a[0] - b[0])
  let d = `M0,${edgeY}`
  for (const [x, py] of pts) d += ` L${x},${py}`
  return `${d} L${PLOT_W},${edgeY} L${PLOT_W},${PLOT_H} L0,${PLOT_H} Z`
}

/** Azimuth labels at their plot x; a label on the left edge is repeated on the right edge. */
function azTicks(leftAzDeg: number): { x: number; label: string }[] {
  const ticks: { x: number; label: string }[] = AZ_TICKS.map(([az, label]) => ({ x: screenX(az, leftAzDeg), label }))
  const atEdge = ticks.find((t) => t.x === 0)
  return atEdge ? [...ticks, { x: PLOT_W, label: atEdge.label }] : ticks
}

/** Earth fill: a lit blue sphere with a green landmass, clipped to the disk. Only drawn while Earth is in view. */
function EarthFill({ id, cx, cy, rx, ry }: { id: string; cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-ocean`} cx="35%" cy="35%" r="75%">
          <stop offset="0%" style={{ stopColor: 'var(--text)' }} />
          <stop offset="45%" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.7 }} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
        </clipPath>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}-ocean)`} />
      <g clipPath={`url(#${id}-clip)`} fill="var(--good)" opacity={0.85}>
        <ellipse cx={cx - rx * 0.25} cy={cy + ry * 0.1} rx={rx * 0.35} ry={ry * 0.55} />
        <ellipse cx={cx + rx * 0.45} cy={cy - ry * 0.35} rx={rx * 0.2} ry={ry * 0.15} />
      </g>
    </g>
  )
}

/** Day ticks: ±this many viewBox units around the track; at most this many labelled. */
const DAY_TICK_HALF = 6
const MAX_DAY_LABELS = 16
const TRACK_DASH = '5 3'
const dayLabel = (day: number) => (day === 0 ? 'L' : `L+${day}d`)
const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * A track as two path strings: segments starting at a visible sample (`visible`) and the rest (`hidden`). Segment
 * [i, i+1] takes sample i's state (state is known per sample only). A segment that would jump across the plot (the
 * track crossing the 0°/360° edge of the view) is left out, so the line breaks at the edge.
 */
function trackPaths(pts: readonly TrackPoint[], leftAzDeg: number): { visible: string; hidden: string } {
  const out = { visible: '', hidden: '' }
  let prev: 'visible' | 'hidden' | null = null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const xa = screenX(a.azDeg, leftAzDeg)
    const xb = screenX(b.azDeg, leftAzDeg)
    if (Math.abs(xb - xa) > PLOT_W / 2) {
      prev = null
      continue
    }
    const style = a.visible ? 'visible' : 'hidden'
    if (style !== prev) out[style] += `M${r2(xa)},${r2(elevToY(a.elevDeg))}`
    out[style] += `L${r2(xb)},${r2(elevToY(b.elevDeg))}`
    prev = style
  }
  return out
}

function Track({ pts, body, color, leftAzDeg }: { pts: readonly TrackPoint[]; body: 'sun' | 'earth'; color: string; leftAzDeg: number }) {
  const { visible, hidden } = trackPaths(pts, leftAzDeg)
  return (
    <g fill="none" stroke={color}>
      <path data-track={`${body}-hidden`} d={hidden} strokeWidth={1.25} strokeDasharray={TRACK_DASH} strokeOpacity={0.85} vectorEffect="non-scaling-stroke" />
      <path data-track={`${body}-visible`} d={visible} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </g>
  )
}

/** Short vertical marks across the Sun track at landing and each mission day, labelled "L", "L+1d", … */
function DayTicks({ ticks, leftAzDeg }: { ticks: readonly DayTick[]; leftAzDeg: number }) {
  const every = Math.max(1, Math.ceil(ticks.length / MAX_DAY_LABELS))
  return (
    <g>
      {ticks.map((t) => {
        const x = screenX(t.azDeg, leftAzDeg)
        const y = elevToY(t.elevDeg)
        return (
          <g key={t.day}>
            <line data-day-tick={t.day} x1={x} x2={x} y1={y - DAY_TICK_HALF} y2={y + DAY_TICK_HALF} stroke="var(--text)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {t.day % every === 0 && (
              <text x={x} y={y - DAY_TICK_HALF - 2} textAnchor="middle" fontSize={FONT - 2} fill="var(--text)">
                {dayLabel(t.day)}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function LineSwatch({ color, dashed }: { color: string; dashed: boolean }) {
  return (
    <svg width="22" height="8" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
      <line x1={1} x2={21} y1={4} y2={4} stroke={color} strokeWidth={dashed ? 1.25 : 2} strokeDasharray={dashed ? TRACK_DASH : undefined} />
    </svg>
  )
}

/** Key for the track styles and day ticks (the dashes, not just the colors, carry the state). */
function TrackLegend() {
  return (
    <p className="muted" style={{ margin: 0, fontSize: '0.75rem', display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-3)' }}>
      <span>Tracks over the mission:</span>
      {BODIES.map(({ key, label, color, on, off }) => (
        <span key={key}>
          {label} <LineSwatch color={color} dashed={false} /> {on} <LineSwatch color={color} dashed /> {off}
        </span>
      ))}
      <span>Ticks: L = landing, L+Nd = N days after landing</span>
    </p>
  )
}

/** Disk semi-axes in viewBox units: true angular radius on both axes, so the terrain blocks it at its true width. */
const diskRadii = (b: PanoramaBody) => ({ rx: b.radiusDeg * AZ_UNITS_PER_DEG, ry: b.radiusDeg * ELEV_UNITS_PER_DEG })
/** Any part of the disk inside the elevation range (the plot clip trims the rest). */
const diskInRange = (b: PanoramaBody) => b.elevDeg + b.radiusDeg >= ELEV_MIN_DEG && b.elevDeg - b.radiusDeg <= ELEV_MAX_DEG

/** Disk center(s) on screen: a disk crossing 0°/360° is also drawn at the other edge. Null when off the plot. */
function diskCopies(b: PanoramaBody, leftAzDeg: number): { xs: number[]; cy: number; rx: number; ry: number } | null {
  if (!diskInRange(b)) return null
  const x = screenX(b.azDeg, leftAzDeg)
  const { rx, ry } = diskRadii(b)
  const xs = [x]
  if (x + rx > PLOT_W) xs.push(x - PLOT_W)
  if (x - rx < 0) xs.push(x + PLOT_W)
  return { xs, cy: elevToY(b.elevDeg), rx, ry }
}

/** Edge-label placement: anchored so text near the 0°/360° edges stays inside the plot. */
const EDGE_LABEL_UNITS = 60
function edgeAnchor(x: number): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (x < EDGE_LABEL_UNITS) return { x: Math.max(2, x), textAnchor: 'start' }
  if (x > PLOT_W - EDGE_LABEL_UNITS) return { x: Math.min(PLOT_W - 2, x), textAnchor: 'end' }
  return { x, textAnchor: 'middle' }
}

/** Disks are drawn inside the plot clip; this places the text labels, which are not clipped. */
function BodyLabel({ b, label, color, leftAzDeg }: { b: PanoramaBody; label: string; color: string; leftAzDeg: number }) {
  const x = screenX(b.azDeg, leftAzDeg)
  if (!diskInRange(b)) {
    const below = b.elevDeg < ELEV_MIN_DEG
    return (
      <text {...edgeAnchor(x)} y={below ? PLOT_H - 4 : FONT} fontSize={FONT} fill={color}>
        {below ? `${label} below ${fmtDeg(ELEV_MIN_DEG, 0)} ↓` : `${label} above +${ELEV_MAX_DEG}° ↑`}
      </text>
    )
  }
  const cy = elevToY(b.elevDeg)
  const { ry } = diskRadii(b)
  // Above the disk, or below it when that would leave the plot top; always inside the plot.
  const y = Math.min(PLOT_H - 4, Math.max(FONT, cy - ry - 4 - FONT >= 0 ? cy - ry - 4 : cy + ry + FONT))
  return (
    <text {...edgeAnchor(x)} y={y} fontSize={FONT} fill={color}>
      {label}
    </text>
  )
}

/**
 * Disk fill, drawn UNDER the terrain so a ridge visibly cuts into a partly blocked disk. Only while visible
 * (Sun lit / Earth in view); a not-visible disk has no fill.
 */
function BodyFill({ b, body, color, idPrefix, leftAzDeg }: {
  b: PanoramaBody
  body: 'sun' | 'earth'
  color: string
  idPrefix: string
  leftAzDeg: number
}) {
  const d = diskCopies(b, leftAzDeg)
  if (!d || !b.visible) return null
  return (
    <>
      {d.xs.map((cx, k) =>
        body === 'earth' ? (
          <EarthFill key={k} id={`${idPrefix}-earth-${k}`} cx={cx} cy={d.cy} rx={d.rx} ry={d.ry} />
        ) : (
          <ellipse key={k} data-fill={body} cx={cx} cy={d.cy} rx={d.rx} ry={d.ry} fill={color} />
        ),
      )}
    </>
  )
}

/** Disk outline, drawn OVER the terrain: solid when visible, dashed when not (so a hidden disk stays findable). */
function BodyOutline({ b, body, color, leftAzDeg }: { b: PanoramaBody; body: 'sun' | 'earth'; color: string; leftAzDeg: number }) {
  const d = diskCopies(b, leftAzDeg)
  if (!d) return null
  return (
    <>
      {d.xs.map((cx, k) => (
        <ellipse
          key={k}
          data-body={body}
          cx={cx}
          cy={d.cy}
          rx={d.rx}
          ry={d.ry}
          fill="none"
          stroke={color}
          strokeWidth={1}
          strokeDasharray={b.visible ? undefined : '2 2'}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}

export function HorizonPanorama({
  siteName,
  horizonMaskDeg,
  azStepDeg,
  observerHeightM,
  sun,
  earth,
  centerAzDeg = 180,
  tracks,
}: HorizonPanoramaProps) {
  const leftAzDeg = mod360(centerAzDeg - 180)
  // useId() contains characters that aren't safe in url(#…) references (":r0:" in React 18, "«r0»" in 19).
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const captionId = `${idPrefix}-caption`
  const bodies = { sun, earth }
  const status = BODIES.map(({ key, label, on, off }) => {
    const b = bodies[key]
    return `${label} ${b.visible ? on : off}: az ${fmtDeg(b.azDeg)}, elev ${fmtDeg(b.elevDeg, 2)}, terrain ${fmtDeg(b.horizonDeg, 2)}`
  })

  return (
    <figure style={{ margin: 0 }}>
      <figcaption id={captionId} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'baseline' }}>
        <strong>{siteName}</strong>
        {status.map((s) => (
          <span key={s} className="num">
            {s}
          </span>
        ))}
      </figcaption>
      <svg
        role="img"
        aria-label={`${siteName} horizon panorama`}
        aria-describedby={captionId}
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
        {azTicks(leftAzDeg).map(({ x, label }) => (
          <text key={`${label}-${x}`} x={x} y={PLOT_H + FONT + 6} textAnchor="middle" fontSize={FONT} fill="var(--text-muted)">
            {label}
          </text>
        ))}
        <defs>
          <clipPath id={`${idPrefix}-plot`}>
            <rect x={0} y={0} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${idPrefix}-plot)`}>
          {BODIES.map(({ key, color }) => (
            <BodyFill key={key} b={bodies[key]} body={key} color={color} idPrefix={idPrefix} leftAzDeg={leftAzDeg} />
          ))}
        </g>
        {/* Fill ~3:1 against the sky (--surface-2) and the ridge line well above, so the silhouette reads as a
            solid shape (WCAG 1.4.11), while dashed disks behind the terrain stay visible on it (Sun ~3:1, Earth ~2.4:1). */}
        <path
          data-terrain=""
          d={terrainPath(horizonMaskDeg, azStepDeg, leftAzDeg)}
          fill="var(--text-muted)"
          fillOpacity={0.65}
          stroke="var(--text)"
          strokeOpacity={0.8}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {tracks && (
          <g clipPath={`url(#${idPrefix}-plot)`}>
            {BODIES.map(({ key, color }) => (
              <Track key={key} pts={tracks[key]} body={key} color={color} leftAzDeg={leftAzDeg} />
            ))}
            <DayTicks ticks={tracks.dayTicks} leftAzDeg={leftAzDeg} />
          </g>
        )}
        <g clipPath={`url(#${idPrefix}-plot)`}>
          {BODIES.map(({ key, color }) => (
            <BodyOutline key={key} b={bodies[key]} body={key} color={color} leftAzDeg={leftAzDeg} />
          ))}
        </g>
        {BODIES.map(({ key, label, color }) => (
          <BodyLabel key={key} b={bodies[key]} label={label} color={color} leftAzDeg={leftAzDeg} />
        ))}
        <text x={0} y={-8} fontSize={FONT} fill="var(--text-muted)">
          Vertical exaggeration {EXAGGERATION}×
        </text>
        <text x={PLOT_W} y={-8} textAnchor="end" fontSize={FONT} fill="var(--text-muted)">
          Terrain horizon at {observerHeightM} m observer height · elevation 0° = local spherical horizontal
        </text>
      </svg>
      {tracks && <TrackLegend />}
      <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
        Sun / Earth disks to angular scale on both axes (ovals because of the {EXAGGERATION}× vertical exaggeration). Lit / in view
        follow the timeline's rules (Sun visible-disk threshold, Earth clearance margin, with hysteresis), so a disk can
        look partly clear of the terrain and still count as blocked.
      </p>
    </figure>
  )
}
