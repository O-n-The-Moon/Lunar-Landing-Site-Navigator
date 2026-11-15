import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { angularRadiusDeg, horizonElevAt, type Window } from '../../engine'
import { fixtureOutputs } from '../../engine/__fixtures__'
import {
  AZ_UNITS_PER_DEG,
  ELEV_MAX_DEG,
  ELEV_MIN_DEG,
  ELEV_UNITS_PER_DEG,
  HorizonPanorama,
  azToX,
  elevToY,
  type PanoramaBody,
} from './horizon-panorama'
import { renderedRidge, renderedRidgeYAt } from './test-helpers'

afterEach(cleanup)

const plateau = fixtureOutputs['fixture-plateau']
const { samples, ctx, windows } = plateau
/** The timeline's rule: half-open [start, end), except a window clipped at the range end includes that end. */
const isIn = (ws: Window[], t: number) =>
  ws.some((w) => w.startMs <= t && (t < w.endMs || (w.clippedEnd && t === w.endMs)))

function bodyAt(i: number, body: 'sun' | 'earth'): PanoramaBody {
  const azDeg = body === 'sun' ? samples.sunAzDeg[i] : samples.earthAzDeg[i]
  const elevDeg = body === 'sun' ? samples.sunElevDeg[i] : samples.earthElevDeg[i]
  const horizonDeg = body === 'sun' ? samples.sunHorizonDeg[i] : samples.earthHorizonDeg[i]
  // Fixture distances: Sun ~1 AU, Earth ~383,000 km.
  const radiusDeg = angularRadiusDeg(body, body === 'sun' ? 149_600_000 : 383_000)
  const t = samples.tUtcMs[i]
  return { azDeg, elevDeg, horizonDeg, radiusDeg, visible: isIn(body === 'sun' ? windows.sun : windows.earth, t) }
}

function renderAt(i: number) {
  return render(
    <HorizonPanorama
      siteName="Fixture plateau"
      horizonMaskDeg={ctx.horizonMaskDeg}
      azStepDeg={ctx.azStepDeg}
      observerHeightM={ctx.observerHeightM}
      sun={bodyAt(i, 'sun')}
      earth={bodyAt(i, 'earth')}
    />,
  )
}

const disk = (body: string) => {
  const el = document.querySelector(`ellipse[data-body="${body}"]`)
  if (!el) throw new Error(`no ${body} disk`)
  return { cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')), rx: Number(el.getAttribute('rx')), ry: Number(el.getAttribute('ry')) }
}

describe('HorizonPanorama', () => {
  it('shows azimuth 0–360 and elevation −5…+12° with a vertical-exaggeration label', () => {
    renderAt(0)
    expect(azToX(0)).toBe(0)
    expect(azToX(360)).toBe(360 * AZ_UNITS_PER_DEG)
    expect(elevToY(ELEV_MAX_DEG)).toBe(0)
    expect(elevToY(ELEV_MIN_DEG)).toBe((ELEV_MAX_DEG - ELEV_MIN_DEG) * ELEV_UNITS_PER_DEG)
    expect(ELEV_MIN_DEG).toBe(-5)
    expect(ELEV_MAX_DEG).toBe(12)
    const exaggeration = ELEV_UNITS_PER_DEG / AZ_UNITS_PER_DEG
    expect(screen.getByText(`Vertical exaggeration ${exaggeration}×`)).toBeTruthy()
  })

  it('draws a filled terrain silhouette from the mask', () => {
    renderAt(0)
    const path = document.querySelector('path[data-terrain]')
    expect(path?.getAttribute('fill')).not.toBe('none')
    // One point per bin plus the 360° wrap, then the two bottom corners.
    expect(path?.getAttribute('d')?.match(/L/g)?.length).toBe(ctx.horizonMaskDeg.length + 2)
    // Every ridge vertex sits at bin i's azimuth and (clamped) mask elevation; the 360° point repeats bin 0.
    const ridge = renderedRidge()
    const n = ctx.horizonMaskDeg.length
    expect(ridge).toHaveLength(n + 1)
    const clamp = (e: number) => Math.min(ELEV_MAX_DEG, Math.max(ELEV_MIN_DEG, e))
    for (let i = 0; i <= n; i++) {
      expect(ridge[i][0]).toBeCloseTo(azToX(i * ctx.azStepDeg), 9)
      expect(ridge[i][1]).toBeCloseTo(elevToY(clamp(ctx.horizonMaskDeg[i % n])), 9)
    }
  })

  it('draws Sun and Earth disks to angular scale on both axes', () => {
    renderAt(0)
    const sun = bodyAt(0, 'sun')
    const earth = bodyAt(0, 'earth')
    expect(sun.radiusDeg * 2).toBeCloseTo(0.53, 2)
    expect(earth.radiusDeg * 2).toBeCloseTo(1.9, 1)
    for (const [name, b] of [['sun', sun], ['earth', earth]] as const) {
      const d = disk(name)
      expect(d.cx).toBeCloseTo(azToX(b.azDeg), 6)
      expect(d.cy).toBeCloseTo(elevToY(b.elevDeg), 6)
      expect(d.rx).toBeCloseTo(b.radiusDeg * AZ_UNITS_PER_DEG, 6)
      expect(d.ry).toBeCloseTo(b.radiusDeg * ELEV_UNITS_PER_DEG, 6)
    }
    expect(screen.getByText(/to angular scale on both axes/)).toBeTruthy()
  })

  it('colors Earth (ocean gradient + land) while in view, outline only when not', () => {
    renderAt(0)
    expect(bodyAt(0, 'earth').visible).toBe(true)
    const fill = document.querySelector('ellipse[fill^="url(#"]')
    const id = fill?.getAttribute('fill')?.slice(5, -1) ?? ''
    expect(document.getElementById(id)?.tagName.toLowerCase()).toBe('radialgradient')
    cleanup()
    render(
      <HorizonPanorama
        siteName="Fixture plateau"
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={bodyAt(0, 'sun')}
        earth={{ ...bodyAt(0, 'earth'), visible: false }}
      />,
    )
    expect(document.querySelector('ellipse[fill^="url(#"]')).toBeNull()
    expect(document.querySelector('ellipse[data-body="earth"]')?.getAttribute('stroke-dasharray')).toBe('2 2')
  })

  it('at a time the timeline marks Sun "blocked", draws the Sun disk below the silhouette', () => {
    // A sample inside a gap between Sun windows (the timeline shows "not lit") where the terrain hides the disk across
    // its whole true width. (The engine tests the horizon at the disk's center azimuth only, so on a steep ridge a
    // "0 %" disk can still show a sliver at one edge; the true-width drawing shows that, so avoid such samples here.)
    const hiddenAcrossWidth = (k: number) => {
      const az = samples.sunAzDeg[k]
      const elev = samples.sunElevDeg[k]
      const r = bodyAt(k, 'sun').radiusDeg
      return [-1, -0.5, 0, 0.5, 1].every((f) => elev + r < horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, az + f * r))
    }
    const i = samples.tUtcMs.findIndex(
      (t, k) => !isIn(windows.sun, t) && samples.sunElevDeg[k] > ELEV_MIN_DEG && hiddenAcrossWidth(k),
    )
    expect(i).toBeGreaterThan(-1)
    renderAt(i)
    const d = disk('sun')
    // SVG y grows downward: the disk's top is below the rendered ridge across the disk's width.
    for (const x of [d.cx - d.rx, d.cx, d.cx + d.rx]) expect(d.cy - d.ry).toBeGreaterThan(renderedRidgeYAt(x))
    expect(document.querySelector('ellipse[data-fill="sun"]')).toBeNull()
    expect(screen.getByRole('img', { name: /Fixture plateau horizon/ })).toBeTruthy()
    expect(within(screen.getByRole('figure')).getByText(/^Sun blocked/)).toBeTruthy()
  })

  it('marks a body outside the elevation range at the edge instead of drawing it off-scale', () => {
    render(
      <HorizonPanorama
        siteName="Fixture plateau"
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={{ ...bodyAt(0, 'sun'), elevDeg: -20 }}
        earth={bodyAt(0, 'earth')}
      />,
    )
    expect(document.querySelector('ellipse[data-body="sun"]')).toBeNull()
    expect(screen.getByText(/Sun below −5°/)).toBeTruthy()
  })

  it('draws visible fills under the terrain and outlines over it, so the ridge cuts into a partly blocked disk', () => {
    renderAt(0)
    expect(bodyAt(0, 'sun').visible).toBe(true)
    const terrain = document.querySelector('path[data-terrain]')
    const sunFill = document.querySelector('ellipse[data-fill="sun"]')
    const earthFill = document.querySelector('ellipse[fill^="url(#"]')
    const sunOutline = document.querySelector('ellipse[data-body="sun"]')
    if (!terrain || !sunFill || !earthFill || !sunOutline) throw new Error('missing element')
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(before(sunFill, terrain)).toBe(true)
    expect(before(earthFill, terrain)).toBe(true)
    expect(before(terrain, sunOutline)).toBe(true)
    expect(sunOutline.getAttribute('fill')).toBe('none')
  })

  const renderBodies = (sun: Partial<PanoramaBody>, earth: Partial<PanoramaBody>) =>
    render(
      <HorizonPanorama
        siteName="Fixture plateau"
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={{ ...bodyAt(0, 'sun'), ...sun }}
        earth={{ ...bodyAt(0, 'earth'), ...earth }}
      />,
    )
  const plotW = azToX(360)
  const plotH = elevToY(ELEV_MIN_DEG)

  it('clips disks to the plot area', () => {
    renderBodies({}, {})
    for (const el of document.querySelectorAll('ellipse[data-body]')) {
      const g = el.closest('g[clip-path]')
      const id = g?.getAttribute('clip-path')?.slice(5, -1) ?? ''
      const rect = document.getElementById(id)?.querySelector('rect')
      expect([rect?.getAttribute('x'), rect?.getAttribute('y'), rect?.getAttribute('width'), rect?.getAttribute('height')]).toEqual(
        ['0', '0', String(plotW), String(plotH)],
      )
    }
  })

  it('wraps a disk that crosses 0°/360° to the other edge', () => {
    renderBodies({ azDeg: 0.1 }, { azDeg: 359.5 })
    const xs = (body: string) =>
      [...document.querySelectorAll(`ellipse[data-body="${body}"]`)].map((el) => Number(el.getAttribute('cx'))).sort((a, b) => a - b)
    expect(xs('earth')).toEqual([azToX(359.5) - plotW, azToX(359.5)])
    expect(xs('sun')).toEqual([azToX(0.1), azToX(0.1) + plotW])
    // Well inside the plot: no copy.
    cleanup()
    renderBodies({ azDeg: 180 }, { azDeg: 90 })
    expect(document.querySelectorAll('ellipse[data-body]')).toHaveLength(2)
  })

  it('draws a disk whose limb is in range even when its center is not', () => {
    const r = bodyAt(0, 'earth').radiusDeg
    renderBodies({}, { elevDeg: ELEV_MIN_DEG - r / 2 })
    expect(document.querySelector('ellipse[data-body="earth"]')).toBeTruthy()
    expect(screen.queryByText(/Earth below/)).toBeNull()
    cleanup()
    renderBodies({}, { elevDeg: ELEV_MIN_DEG - r * 1.5 })
    expect(document.querySelector('ellipse[data-body="earth"]')).toBeNull()
    expect(screen.getByText(/Earth below −5°/)).toBeTruthy()
  })

  it('keeps body and off-range labels inside the plot', () => {
    renderBodies({ elevDeg: 11.9 }, { azDeg: 0.2, elevDeg: -20 })
    const sunLabel = screen.getByText('Sun')
    const y = Number(sunLabel.getAttribute('y'))
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThanOrEqual(plotH)
    const off = screen.getByText(/Earth below −5°/)
    expect(off.getAttribute('text-anchor')).toBe('start')
    expect(Number(off.getAttribute('x'))).toBeGreaterThanOrEqual(0)
  })
})
