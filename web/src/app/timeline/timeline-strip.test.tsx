import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { nextEvents, type DetectedWindows } from '../../engine'
import { fixtureOutputs, fixtureScenario } from '../../engine/__fixtures__'
import type { CursorReadout } from './cursor-readout'
import { timeScale } from './scales'
import { STRIP_VIEW_W, TimelineStrip, formatInH } from './timeline-strip'

afterEach(cleanup)

const H_MS = 3_600_000
const { windows } = fixtureOutputs['fixture-plateau']
const range = {
  startMs: fixtureScenario.baselineLandingMs,
  endMs: fixtureScenario.baselineLandingMs + fixtureScenario.durationH * H_MS,
}

function renderStrip(
  cursorMs = range.startMs,
  w: DetectedWindows = windows,
  extra: { ghost?: DetectedWindows; readout?: CursorReadout } = {},
) {
  return render(<TimelineStrip siteName="Plateau" windows={w} range={range} cursorMs={cursorMs} {...extra} />)
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

  it('is display-only: the one shared cursor lives in the panel, not in each strip', () => {
    const { container } = renderStrip()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(container.querySelector('line')).toBeNull()
  })

  it('shows Sun elevation and clearance at the cursor, with the sign made explicit', () => {
    renderStrip(range.startMs, windows, { readout: { sunElevDeg: 3.456, sunClearanceDeg: -1.04 } })
    expect(screen.getByText('Sun elev 3.5°')).toBeInTheDocument()
    expect(screen.getByText('clearance −1.0°')).toBeInTheDocument()
    cleanup()
    renderStrip(range.startMs, windows, { readout: { sunElevDeg: 0.2, sunClearanceDeg: 0.04 } })
    expect(screen.getByText('clearance +0.0°')).toBeInTheDocument()
  })

  it('omits the elevation readouts when none is given', () => {
    renderStrip()
    expect(screen.queryByText(/Sun elev/)).toBeNull()
  })
})

describe('TimelineStrip baseline ghost', () => {
  // Sun up hours 6–12 of 24 when slipped; the ghost (baseline, already shifted onto this strip's time axis) is up
  // hours 3–15, so hours 3–6 and 12–15 are time the slip lost.
  const slipped: DetectedWindows = {
    sun: [{ startMs: range.startMs + 6 * H_MS, endMs: range.startMs + 12 * H_MS, clippedStart: false, clippedEnd: false }],
    earth: [],
    both: [],
  }
  const ghost: DetectedWindows = {
    sun: [{ startMs: range.startMs + 3 * H_MS, endMs: range.startMs + 15 * H_MS, clippedStart: false, clippedEnd: false }],
    earth: [{ startMs: range.startMs - 5 * H_MS, endMs: range.startMs + 2 * H_MS, clippedStart: false, clippedEnd: false }],
    both: [],
  }
  const ghostRects = (container: HTMLElement, band: string) =>
    [...container.querySelectorAll(`[data-ghost="${band}"]`)].map((r) => ({
      x: Number(r.getAttribute('x')),
      w: Number(r.getAttribute('width')),
    }))

  it('draws the baseline windows at hand-computed x (hours 3–15 of 24 → 125…625 of 1000)', () => {
    const { container } = renderStrip(range.startMs, slipped, { ghost })
    expect(ghostRects(container, 'sun')).toEqual([{ x: 125, w: 500 }])
  })

  it('clips ghost windows to the mission range (earth hours −5…2 → 0…83.3)', () => {
    const { container } = renderStrip(range.startMs, slipped, { ghost })
    const [g] = ghostRects(container, 'earth')
    expect(g.x).toBe(0)
    expect(g.w).toBeCloseTo((2 / 24) * STRIP_VIEW_W, 9)
  })

  it('leaves the real bands where they were, drawn after (on top of) the ghost in the same row', () => {
    const { container } = renderStrip(range.startMs, slipped, { ghost })
    expect(bandRects(container, 'sun')).toEqual([{ x: 250, w: 250 }])
    const ghostEl = container.querySelector('[data-ghost="sun"]')!
    const bandEl = container.querySelector('[data-band="sun"]')!
    // Same row (y), and the real band follows the ghost in document order so it paints over it.
    expect(ghostEl.getAttribute('y')).toBe(bandEl.getAttribute('y'))
    expect(ghostEl.compareDocumentPosition(bandEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is much fainter than the real band', () => {
    const { container } = renderStrip(range.startMs, slipped, { ghost })
    const opacity = (sel: string) => Number(container.querySelector(sel)!.getAttribute('fill-opacity') ?? 1)
    expect(opacity('[data-ghost="sun"]')).toBeLessThanOrEqual(0.35)
    expect(opacity('[data-band="sun"]')).toBe(1)
  })

  it('draws no ghost without a baseline (slip 0)', () => {
    const { container } = renderStrip(range.startMs, slipped)
    expect(container.querySelectorAll('[data-ghost]')).toHaveLength(0)
  })
})

describe('formatInH', () => {
  it('formats hours as "Xh Ym", rounding to the minute', () => {
    expect(formatInH(5.2)).toBe('5h 12m')
    expect(formatInH(0.999)).toBe('1h 0m')
    expect(formatInH(30.5)).toBe('30h 30m')
  })
})
