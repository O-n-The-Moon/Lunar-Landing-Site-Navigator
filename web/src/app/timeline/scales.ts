// Linear time <-> x scale for the timeline strips. Hand-rolled: no D3 dependency for one linear map.

export interface TimeRange {
  startMs: number
  endMs: number
}

export interface PixelRange {
  x0: number
  x1: number
}

export interface TimeScale {
  /** Pixel x for a UTC ms time. Not clamped, so windows overhanging the range can be clipped by the caller. */
  x: (tUtcMs: number) => number
  /** UTC ms time for a pixel x, clamped to the range (for cursor dragging). */
  t: (x: number) => number
}

export function timeScale(range: TimeRange, px: PixelRange): TimeScale {
  const spanMs = range.endMs - range.startMs
  const spanPx = px.x1 - px.x0
  if (!(spanMs > 0)) throw new RangeError(`time range must be non-empty, got ${range.startMs}…${range.endMs}`)
  if (!(spanPx > 0)) throw new RangeError(`pixel range must be non-empty, got ${px.x0}…${px.x1}`)
  return {
    x: (tUtcMs) => px.x0 + ((tUtcMs - range.startMs) / spanMs) * spanPx,
    t: (x) => {
      const tUtcMs = range.startMs + ((x - px.x0) / spanPx) * spanMs
      return Math.min(range.endMs, Math.max(range.startMs, tUtcMs))
    },
  }
}
