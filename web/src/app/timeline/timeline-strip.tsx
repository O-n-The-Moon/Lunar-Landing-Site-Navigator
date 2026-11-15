// One site's timeline (SPEC-app P0-4): Sun / Earth / Both bands across the mission, a draggable,
// keyboard-operable cursor, and "sunset in / Earthset in" readouts from the engine's nextEvents.
// Prop-driven: windows come from detectWindows (or fixtures); this component does no physics.
import type { KeyboardEvent, PointerEvent } from 'react'
import { nextEvents, type DetectedWindows, type Window } from '../../engine'
import { timeScale, type TimeRange, type TimeScale } from './scales'

const H_MS = 3_600_000
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

export interface TimelineStripProps {
  siteName: string
  windows: DetectedWindows
  /** Mission range shown across the strip. */
  range: TimeRange
  cursorMs: number
  onCursorChange: (cursorMs: number) => void
}

/** "5h 12m", rounded to the minute; null → null. */
export function formatInH(h: number | null): string | null {
  if (h === null) return null
  const totalMin = Math.round(h * 60)
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
}

const formatUtc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
/** Half-open [start, end), except a window clipped at the range end still includes that end. */
const isIn = (ws: Window[], t: number) =>
  ws.some((w) => w.startMs <= t && (t < w.endMs || (w.clippedEnd && t === w.endMs)))
const KEY_STEP_MS: Record<string, number> = {
  ArrowRight: H_MS,
  ArrowUp: H_MS,
  ArrowLeft: -H_MS,
  ArrowDown: -H_MS,
  PageUp: 12 * H_MS,
  PageDown: -12 * H_MS,
}

/** "Sunset in 5h 12m" while up, "Sunrise in …" while down, or "No sunset in mission". */
function eventText(up: boolean, inH: number | null, setName: string, riseName: string): string {
  const name = up ? setName : riseName
  const t = formatInH(inH)
  // "No sunset" but "No Earthset": Earth is a proper noun.
  return t === null ? `No ${name.replace(/^Sun/, 'sun')} in mission` : `${name} in ${t}`
}

function BandRow({ windows, scale, range, y, color, band }: {
  windows: Window[]
  scale: TimeScale
  range: TimeRange
  y: number
  color: string
  band: string
}) {
  return (
    <g>
      <rect x={0} y={y} width={STRIP_VIEW_W} height={ROW_H} fill="var(--surface-2)" />
      {windows
        .filter((w) => w.endMs > range.startMs && w.startMs < range.endMs)
        .map((w) => {
          const x0 = scale.x(Math.max(w.startMs, range.startMs))
          const x1 = scale.x(Math.min(w.endMs, range.endMs))
          return <rect key={w.startMs} data-band={band} x={x0} y={y} width={x1 - x0} height={ROW_H} fill={color} />
        })}
    </g>
  )
}

export function TimelineStrip({ siteName, windows, range, cursorMs, onCursorChange }: TimelineStripProps) {
  const scale = timeScale(range, { x0: 0, x1: STRIP_VIEW_W })
  const clampMs = (t: number) => Math.min(range.endMs, Math.max(range.startMs, t))
  const ev = nextEvents(windows, cursorMs)
  const sunUp = isIn(windows.sun, cursorMs)
  const earthUp = isIn(windows.earth, cursorMs)

  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width > 0) onCursorChange(scale.t(((e.clientX - r.left) / r.width) * STRIP_VIEW_W))
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    moveTo(e)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) moveTo(e)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (e.key in KEY_STEP_MS) next = clampMs(cursorMs + KEY_STEP_MS[e.key])
    else if (e.key === 'Home') next = range.startMs
    else if (e.key === 'End') next = range.endMs
    if (next === null) return
    e.preventDefault()
    onCursorChange(next)
  }

  const cursorX = scale.x(clampMs(cursorMs))
  const sunText = eventText(sunUp, sunUp ? ev.sunsetInH : ev.sunriseInH, 'Sunset', 'Sunrise')
  const earthText = eventText(earthUp, earthUp ? ev.earthsetInH : ev.earthriseInH, 'Earthset', 'Earthrise')

  return (
    <figure aria-label={`${siteName} timeline`} style={{ margin: 0 }}>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'baseline' }}>
        <strong>{siteName}</strong>
        <span className="num">{sunText}</span>
        <span className="num">{earthText}</span>
      </figcaption>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2)', alignItems: 'center' }}>
        <div className="muted" aria-hidden="true" style={{ display: 'grid', gap: ROW_GAP, fontSize: '0.75rem', lineHeight: `${ROW_H}px` }}>
          {BANDS.map((b) => <span key={b.key}>{b.label}</span>)}
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${siteName} timeline cursor`}
          aria-valuemin={range.startMs}
          aria-valuemax={range.endMs}
          aria-valuenow={cursorMs}
          aria-valuetext={`${formatUtc(cursorMs)}. ${sunText}. ${earthText}.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          style={{ touchAction: 'none', cursor: 'ew-resize' }}
        >
          <svg viewBox={`0 0 ${STRIP_VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" width="100%" height={VIEW_H} aria-hidden="true" style={{ display: 'block' }}>
            {BANDS.map((b, i) => (
              <BandRow key={b.key} band={b.key} windows={windows[b.key]} scale={scale} range={range} y={i * (ROW_H + ROW_GAP)} color={b.color} />
            ))}
            <line x1={cursorX} x2={cursorX} y1={0} y2={VIEW_H} stroke="var(--text)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
    </figure>
  )
}
