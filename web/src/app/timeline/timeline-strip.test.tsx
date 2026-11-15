import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextEvents, type DetectedWindows } from '../../engine'
import { fixtureOutputs, fixtureScenario } from '../../engine/__fixtures__'
import { timeScale } from './scales'
import { STRIP_VIEW_W, TimelineStrip, formatInH } from './timeline-strip'

afterEach(cleanup)

const H_MS = 3_600_000
const { windows } = fixtureOutputs['fixture-plateau']
const range = {
  startMs: fixtureScenario.baselineLandingMs,
  endMs: fixtureScenario.baselineLandingMs + fixtureScenario.durationH * H_MS,
}

function renderStrip(cursorMs = range.startMs, w: DetectedWindows = windows) {
  const onCursorChange = vi.fn()
  const view = render(
    <TimelineStrip siteName="Plateau" windows={w} range={range} cursorMs={cursorMs} onCursorChange={onCursorChange} />,
  )
  return { ...view, onCursorChange }
}

const bandRects = (container: HTMLElement, band: string) =>
  [...container.querySelectorAll(`[data-band="${band}"]`)].map((r) => ({
    x: Number(r.getAttribute('x')),
    w: Number(r.getAttribute('width')),
  }))

describe('TimelineStrip', () => {
  it('draws each band edge where the fixture windows are, clipped to the mission range (within 1 px)', () => {
    const { container } = renderStrip()
    const s = timeScale(range, { x0: 0, x1: STRIP_VIEW_W })
    for (const band of ['sun', 'earth', 'both'] as const) {
      const expected = windows[band]
        .filter((win) => win.endMs > range.startMs && win.startMs < range.endMs)
        .map((win) => {
          const x0 = s.x(Math.max(win.startMs, range.startMs))
          const x1 = s.x(Math.min(win.endMs, range.endMs))
          return { x: x0, w: x1 - x0 }
        })
      const got = bandRects(container, band)
      expect(got).toHaveLength(expected.length)
      got.forEach((r, i) => {
        expect(Math.abs(r.x - expected[i].x)).toBeLessThanOrEqual(1)
        expect(Math.abs(r.x + r.w - (expected[i].x + expected[i].w))).toBeLessThanOrEqual(1)
      })
    }
    // The fixture must actually exercise the bands, or this test proves nothing.
    expect(bandRects(container, 'sun').length + bandRects(container, 'earth').length).toBeGreaterThan(0)
  })

  it('shows readouts that match nextEvents at the cursor', () => {
    const cursorMs = range.startMs + 3 * H_MS
    renderStrip(cursorMs)
    const ev = nextEvents(windows, cursorMs)
    const inSun = windows.sun.some((w) => w.startMs <= cursorMs && cursorMs < w.endMs)
    const sunText = inSun ? `Sunset in ${formatInH(ev.sunsetInH)}` : `Sunrise in ${formatInH(ev.sunriseInH)}`
    expect(screen.getByText(sunText)).toBeInTheDocument()
    const inEarth = windows.earth.some((w) => w.startMs <= cursorMs && cursorMs < w.endMs)
    const earthText = inEarth ? `Earthset in ${formatInH(ev.earthsetInH)}` : `Earthrise in ${formatInH(ev.earthriseInH)}`
    expect(screen.getByText(earthText)).toBeInTheDocument()
  })

  it('places a known window at hand-computed x (hours 6–12 of 24 → 250…500 of 1000)', () => {
    const w: DetectedWindows = {
      sun: [{ startMs: range.startMs + 6 * H_MS, endMs: range.startMs + 12 * H_MS, clippedStart: false, clippedEnd: false }],
      earth: [],
      both: [],
    }
    const { container } = renderStrip(range.startMs, w)
    expect(STRIP_VIEW_W).toBe(1000)
    expect(bandRects(container, 'sun')).toEqual([{ x: 250, w: 250 }])
  })

  it('reads "Sunset in" while up and "Sunrise in" while down, at known times', () => {
    const w: DetectedWindows = {
      sun: [{ startMs: range.startMs + 6 * H_MS, endMs: range.startMs + 12 * H_MS, clippedStart: false, clippedEnd: false }],
      earth: [],
      both: [],
    }
    renderStrip(range.startMs + 2 * H_MS, w)
    expect(screen.getByText('Sunrise in 4h 0m')).toBeInTheDocument()
    cleanup()
    renderStrip(range.startMs + 9 * H_MS + 30 * 60_000, w)
    expect(screen.getByText('Sunset in 2h 30m')).toBeInTheDocument()
  })

  it('treats a window clipped at the mission end as still up when the cursor is at the end', () => {
    const w: DetectedWindows = {
      sun: [{ startMs: range.startMs + 20 * H_MS, endMs: range.endMs, clippedStart: false, clippedEnd: true }],
      earth: [{ startMs: range.startMs, endMs: range.endMs, clippedStart: true, clippedEnd: true }],
      both: [],
    }
    renderStrip(range.endMs, w)
    expect(screen.getByText('No sunset in mission')).toBeInTheDocument()
    expect(screen.getByText('No Earthset in mission')).toBeInTheDocument()
  })

  it('says when an event does not happen during the mission', () => {
    const always: DetectedWindows = {
      sun: [{ startMs: range.startMs, endMs: range.endMs, clippedStart: true, clippedEnd: true }],
      earth: [],
      both: [],
    }
    renderStrip(range.startMs, always)
    expect(screen.getByText('No sunset in mission')).toBeInTheDocument()
    expect(screen.getByText('No Earthrise in mission')).toBeInTheDocument()
  })

  it('exposes the cursor as a keyboard slider', () => {
    const cursorMs = range.startMs + 6 * H_MS
    const { onCursorChange } = renderStrip(cursorMs)
    const slider = screen.getByRole('slider', { name: /plateau.*cursor/i })
    expect(slider).toHaveAttribute('aria-valuenow', String(cursorMs))
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringContaining('2026-03-01 06:00 UTC'))
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCursorChange).toHaveBeenLastCalledWith(cursorMs + H_MS)
    fireEvent.keyDown(slider, { key: 'PageDown' })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs) // 06:00 − 12 h clamps to the mission start
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.endMs)
  })

  it('moves the cursor to where the pointer is', () => {
    const { onCursorChange } = renderStrip()
    const slider = screen.getByRole('slider')
    slider.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 40, right: 500, bottom: 40, x: 100, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1 })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs + 6 * H_MS)
  })
})

describe('formatInH', () => {
  it('formats hours as "Xh Ym", rounding to the minute', () => {
    expect(formatInH(5.2)).toBe('5h 12m')
    expect(formatInH(0.999)).toBe('1h 0m')
    expect(formatInH(30.5)).toBe('30h 30m')
  })
})
