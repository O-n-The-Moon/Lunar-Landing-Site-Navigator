// The one cursor shared by every timeline strip (SPEC-app P0-4): a single line across the stacked strips, one
// slider to drag it (pointer) or step it (keyboard). It is an overlay over the strips' plot column, so its x is
// the same fraction of the range as the bands' x in every strip. The scenario state holds the time it edits.
import type { KeyboardEvent, PointerEvent } from 'react'
import { timeScale, type TimeRange } from './scales'
import './timeline.css'

const H_MS = 3_600_000
const KEY_STEP_MS: Record<string, number> = {
  ArrowRight: H_MS,
  ArrowUp: H_MS,
  ArrowLeft: -H_MS,
  ArrowDown: -H_MS,
  PageUp: 12 * H_MS,
  PageDown: -12 * H_MS,
}

export interface TimelineCursorProps {
  /** Mission range the strips show; the overlay must cover exactly their plot column. */
  range: TimeRange
  cursorMs: number
  onCursorChange: (cursorMs: number) => void
  /** Screen-reader description of the cursor time and what is true there. */
  valueText: string
}

export function TimelineCursor({ range, cursorMs, onCursorChange, valueText }: TimelineCursorProps) {
  const pixels = timeScale(range, { x0: 0, x1: 100 })
  const clampMs = (t: number) => Math.min(range.endMs, Math.max(range.startMs, t))

  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width > 0) onCursorChange(pixels.t(((e.clientX - r.left) / r.width) * 100))
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

  return (
    <div
      className="timeline-cursor"
      role="slider"
      tabIndex={0}
      aria-label="Timeline cursor"
      aria-valuemin={range.startMs}
      aria-valuemax={range.endMs}
      aria-valuenow={cursorMs}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="timeline-cursor-line" data-cursor-line style={{ left: `${pixels.x(clampMs(cursorMs))}%` }} />
    </div>
  )
}
