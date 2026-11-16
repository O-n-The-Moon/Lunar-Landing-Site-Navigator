// One site's timeline (SPEC-app P0-4): Sun / Earth / Both bands across the mission, a faint ghost of the
// unslipped baseline behind each band, and the readouts at the cursor time ("sunset in / Earthset in" from the
// engine's nextEvents, plus Sun elevation and clearance). The cursor itself is the panel's one shared
// `TimelineCursor`, drawn over all strips. Prop-driven: windows come from detectWindows (or fixtures); this
// component does no physics.
import { nextEvents, type DetectedWindows, type Window } from '../../engine'
import type { CursorReadout } from './cursor-readout'
import { timeScale, type TimeRange, type TimeScale } from './scales'
import './timeline.css'

/** viewBox width. The SVG stretches to its container, so band x values are exact fractions of the range. */
export const STRIP_VIEW_W = 1000
const ROW_H = 12
const ROW_GAP = 4
const BANDS = [
  { key: 'sun', label: 'Sun', color: 'var(--warn)' },
  { key: 'earth', label: 'Earth', color: 'var(--accent)' },
  { key: 'both', label: 'Both', color: 'var(--good)' },
] as const
const VIEW_H = BANDS.length * ROW_H + (BANDS.length - 1) * ROW_GAP
/** Ghost fill opacity: visible enough to read a loss, faint enough never to be mistaken for a window. */
const GHOST_OPACITY = 0.3

export interface TimelineStripProps {
  siteName: string
  windows: DetectedWindows
  /**
   * The unslipped baseline, already moved onto this strip's time axis (see `shiftWindows`), drawn faint behind
   * each band. Omit at slip 0.
   */
  ghost?: DetectedWindows
  /** Mission range shown across the strip. */
  range: TimeRange
  /** Time the readouts are for (the shared cursor). */
  cursorMs: number
  /** Sun elevation and clearance at `cursorMs`; omitted if unavailable. */
  readout?: CursorReadout
}

/** "5h 12m", rounded to the minute; null → null. */
export function formatInH(h: number | null): string | null {
  if (h === null) return null
  const totalMin = Math.round(h * 60)
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

/** Half-open [start, end), except a window clipped at the range end still includes that end. */
const isIn = (ws: Window[], t: number) =>
  ws.some((w) => w.startMs <= t && (t < w.endMs || (w.clippedEnd && t === w.endMs)))

/** "Sunset in 5h 12m" while up, "Sunrise in …" while down, or "No sunset in mission". */
function eventText(up: boolean, inH: number | null, setName: string, riseName: string): string {
  const name = up ? setName : riseName
  const t = formatInH(inH)
  // "No sunset" but "No Earthset": Earth is a proper noun.
  return t === null ? `No ${name.replace(/^Sun/, 'sun')} in mission` : `${name} in ${t}`
}

/** The Sun and Earth readouts at `cursorMs`, e.g. "Sunset in 5h 12m" and "Earthrise in 30h 0m". */
export function eventTexts(windows: DetectedWindows, cursorMs: number): { sunText: string; earthText: string } {
  const ev = nextEvents(windows, cursorMs)
  const sunUp = isIn(windows.sun, cursorMs)
  const earthUp = isIn(windows.earth, cursorMs)
  return {
    sunText: eventText(sunUp, sunUp ? ev.sunsetInH : ev.sunriseInH, 'Sunset', 'Sunrise'),
    earthText: eventText(earthUp, earthUp ? ev.earthsetInH : ev.earthriseInH, 'Earthset', 'Earthrise'),
  }
}

/** "3.5°", or "+3.5°" / "−1.0°" when `signed` (U+2212 minus, like the metric cards). */
function formatDeg(deg: number, signed: boolean): string {
  const r = Math.round(deg * 10) / 10
  const body = `${Math.abs(r).toFixed(1)}°`
  if (r < 0) return `−${body}`
  return signed ? `+${body}` : body
}

/** One rect per window overlapping the range, clipped to it. */
function WindowRects({ windows, scale, range, y, color, dataAttr, band, opacity }: {
  windows: Window[]
  scale: TimeScale
  range: TimeRange
  y: number
  color: string
  dataAttr: 'data-band' | 'data-ghost'
  band: string
  opacity?: number
}) {
  return (
    <>
      {windows
        .filter((w) => w.endMs > range.startMs && w.startMs < range.endMs)
        .map((w) => {
          const x0 = scale.x(Math.max(w.startMs, range.startMs))
          const x1 = scale.x(Math.min(w.endMs, range.endMs))
          const attrs = { [dataAttr]: band }
          return <rect key={w.startMs} {...attrs} x={x0} y={y} width={x1 - x0} height={ROW_H} fill={color} fillOpacity={opacity} />
        })}
    </>
  )
}

/** Track, then the baseline ghost, then the real windows on top: whatever stays faint is time the slip lost. */
function BandRow({ windows, ghost, scale, range, y, color, band }: {
  windows: Window[]
  ghost: Window[] | undefined
  scale: TimeScale
  range: TimeRange
  y: number
  color: string
  band: string
}) {
  return (
    <g>
      <rect x={0} y={y} width={STRIP_VIEW_W} height={ROW_H} fill="var(--surface-2)" />
      {ghost && <WindowRects windows={ghost} scale={scale} range={range} y={y} color={color} dataAttr="data-ghost" band={band} opacity={GHOST_OPACITY} />}
      <WindowRects windows={windows} scale={scale} range={range} y={y} color={color} dataAttr="data-band" band={band} />
    </g>
  )
}

export function TimelineStrip({ siteName, windows, ghost, range, cursorMs, readout }: TimelineStripProps) {
  const scale = timeScale(range, { x0: 0, x1: STRIP_VIEW_W })
  const { sunText, earthText } = eventTexts(windows, cursorMs)

  return (
    <figure aria-label={`${siteName} timeline`} style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'baseline' }}>
        <strong>{siteName}</strong>
        <span className="num">{sunText}</span>
        <span className="num">{earthText}</span>
        {readout && (
          <>
            <span className="num">Sun elev {formatDeg(readout.sunElevDeg, false)}</span>
            <span className="num">clearance {formatDeg(readout.sunClearanceDeg, true)}</span>
          </>
        )}
      </figcaption>
      <div className="timeline-strip-body">
        <div className="muted" aria-hidden="true" style={{ display: 'grid', gap: ROW_GAP, fontSize: '0.75rem', lineHeight: `${ROW_H}px` }}>
          {BANDS.map((b) => <span key={b.key}>{b.label}</span>)}
        </div>
        <svg viewBox={`0 0 ${STRIP_VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" width="100%" height={VIEW_H} aria-hidden="true" style={{ display: 'block' }}>
          {BANDS.map((b, i) => (
            <BandRow key={b.key} band={b.key} windows={windows[b.key]} ghost={ghost?.[b.key]} scale={scale} range={range} y={i * (ROW_H + ROW_GAP)} color={b.color} />
          ))}
        </svg>
      </div>
    </figure>
  )
}
