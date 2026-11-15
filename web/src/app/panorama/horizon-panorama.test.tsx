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
import { missionTracks, type MissionTracks, type TrackPoint } from './tracks'

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

describe('HorizonPanorama re-centering', () => {
  const plotW = azToX(360)
  const renderCentered = (centerAzDeg: number, sun: Partial<PanoramaBody> = {}) =>
    render(
      <HorizonPanorama
        siteName="Fixture plateau"
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={{ ...bodyAt(0, 'sun'), ...sun }}
        earth={bodyAt(0, 'earth')}
        centerAzDeg={centerAzDeg}
      />,
    )

  it('draws the body at the center azimuth in the middle of the plot', () => {
    renderCentered(37.3, { azDeg: 37.3 })
    expect(disk('sun').cx).toBeCloseTo(plotW / 2, 9)
    cleanup()
    renderCentered(300, { azDeg: 37.3 }) // left edge 120°: 37.3° is 277.3° to its right
    expect(disk('sun').cx).toBeCloseTo(azToX(277.3), 9)
  })

  it('rotates the terrain silhouette with the view, seamless at both edges', () => {
    const centerAzDeg = 123.25 // left edge 303.25°, between mask bins
    const leftAzDeg = centerAzDeg + 180
    renderCentered(centerAzDeg)
    const ridge = renderedRidge()
    const clamp = (e: number) => Math.min(ELEV_MAX_DEG, Math.max(ELEV_MIN_DEG, e))
    expect(ridge[0][0]).toBe(0)
    expect(ridge.at(-1)?.[0]).toBe(plotW)
    expect(ridge[0][1]).toBeCloseTo(ridge.at(-1)?.[1] ?? NaN, 9)
    // One vertex per mask bin plus the two edge points; x strictly increasing.
    expect(ridge).toHaveLength(ctx.horizonMaskDeg.length + 2)
    for (let k = 1; k < ridge.length; k++) expect(ridge[k][0]).toBeGreaterThan(ridge[k - 1][0])
    for (const [x, y] of ridge) {
      const az = leftAzDeg + x / AZ_UNITS_PER_DEG
      expect(y).toBeCloseTo(elevToY(clamp(horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, az))), 6)
    }
  })

  it('moves the azimuth labels with the view', () => {
    renderCentered(90) // left edge 270° (W), so N is a quarter of the way across
    const n = screen.getAllByText('N')
    expect(n).toHaveLength(1)
    expect(Number(n[0].getAttribute('x'))).toBeCloseTo(azToX(90), 9)
    expect(screen.getAllByText('W').map((el) => Number(el.getAttribute('x')))).toEqual([0, plotW])
  })
})

describe('HorizonPanorama mission tracks', () => {
  const plotW = azToX(360)
  const fullTracks = missionTracks(samples, windows, { startMs: samples.tUtcMs[0], endMs: samples.tUtcMs.at(-1) ?? 0 })
  const renderTracks = (tracks: MissionTracks, centerAzDeg?: number) =>
    render(
      <HorizonPanorama
        siteName="Fixture plateau"
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={bodyAt(0, 'sun')}
        earth={bodyAt(0, 'earth')}
        tracks={tracks}
        centerAzDeg={centerAzDeg}
      />,
    )
  /** Subpaths of a rendered track path, as point lists. */
  const subpaths = (sel: string) =>
    (document.querySelector(sel)?.getAttribute('d') ?? '')
      .split('M')
      .filter((s) => s.trim())
      .map((s) => [...s.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]))

  it.each(['sun', 'earth'] as const)('draws the %s track: solid where visible, dashed where not, every sample on it', (body) => {
    renderTracks(fullTracks)
    const pts = fullTracks[body]
    const on = subpaths(`path[data-track="${body}-visible"]`)
    const off = subpaths(`path[data-track="${body}-hidden"]`)
    expect(document.querySelector(`path[data-track="${body}-hidden"]`)?.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(document.querySelector(`path[data-track="${body}-visible"]`)?.getAttribute('stroke-dasharray')).toBeNull()
    // Each subpath is a run of consecutive samples; each segment [i, i+1] is drawn once, styled by sample i's state.
    const near = (q: number[], i: number) =>
      Math.abs(q[0] - azToX(pts[i].azDeg)) < 0.006 && Math.abs(q[1] - elevToY(pts[i].elevDeg)) < 0.006
    const drawn = new Set<number>()
    let segments = 0
    for (const [style, paths] of [[true, on], [false, off]] as const) {
      for (const sp of paths) {
        const start = pts.findIndex((_, i) => i + sp.length <= pts.length && sp.every((q, k) => near(q, i + k)))
        expect(start).toBeGreaterThan(-1)
        for (let k = 0; k + 1 < sp.length; k++) {
          expect(pts[start + k].visible).toBe(style)
          drawn.add(start + k)
          segments++
        }
      }
    }
    expect(drawn.size).toBe(segments)
    const wraps = pts.slice(1).filter((p, i) => Math.abs(p.azDeg - pts[i].azDeg) > 180).length
    expect(segments).toBe(pts.length - 1 - wraps)
  })

  it('breaks a track where it crosses the plot edge instead of drawing a line across the plot', () => {
    const p = (azDeg: number, visible: boolean): TrackPoint => ({ tUtcMs: 0, azDeg, elevDeg: 1, horizonDeg: 0, visible })
    renderTracks({ sun: [p(359.8, true), p(359.9, true), p(0.05, true), p(0.15, true)], earth: [], dayTicks: [] })
    const sp = subpaths('path[data-track="sun-visible"]')
    expect(sp).toHaveLength(2)
    for (const s of sp) expect(Math.abs(s[0][0] - s[1][0])).toBeLessThan(plotW / 2)
  })

  it('marks landing and each mission day on the Sun track', () => {
    renderTracks(fullTracks)
    const ticks = document.querySelectorAll('line[data-day-tick]')
    expect(ticks).toHaveLength(fullTracks.dayTicks.length)
    expect(fullTracks.dayTicks.length).toBeGreaterThanOrEqual(2)
    const t1 = fullTracks.dayTicks[1]
    expect(Number(ticks[1].getAttribute('x1'))).toBeCloseTo(azToX(t1.azDeg), 1)
    expect(screen.getByText('L')).toBeTruthy()
    expect(screen.getByText('L+1d')).toBeTruthy()
    expect(screen.getByText(/days after landing/)).toBeTruthy()
  })

  const r2 = (v: number) => Math.round(v * 100) / 100
  it('moves the tracks with a re-centered view', () => {
    const first = fullTracks.sun[0]
    renderTracks(fullTracks, first.azDeg)
    // The first sample starts a subpath (in whichever style it has), at the middle of the plot.
    const style = first.visible ? 'visible' : 'hidden'
    expect(subpaths(`path[data-track="sun-${style}"]`)[0][0]).toEqual([plotW / 2, r2(elevToY(first.elevDeg))])
  })
})
