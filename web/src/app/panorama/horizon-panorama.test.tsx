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

afterEach(cleanup)

const plateau = fixtureOutputs['fixture-plateau']
const { samples, ctx, windows } = plateau
const isIn = (ws: Window[], t: number) => ws.some((w) => w.startMs <= t && t < w.endMs)

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
  })

  it('draws round Sun and Earth disks, to angular scale in elevation', () => {
    renderAt(0)
    const sun = bodyAt(0, 'sun')
    const earth = bodyAt(0, 'earth')
    expect(sun.radiusDeg * 2).toBeCloseTo(0.53, 2)
    expect(earth.radiusDeg * 2).toBeCloseTo(1.9, 1)
    for (const [name, b] of [['sun', sun], ['earth', earth]] as const) {
      const d = disk(name)
      expect(d.cx).toBeCloseTo(azToX(b.azDeg), 6)
      expect(d.cy).toBeCloseTo(elevToY(b.elevDeg), 6)
      // Vertical extent is the true angular size (what decides lit / blocked against the terrain); the disk is round.
      expect(d.ry).toBeCloseTo(b.radiusDeg * ELEV_UNITS_PER_DEG, 6)
      expect(d.rx).toBe(d.ry)
    }
    expect(screen.getByText(/disk size to scale in elevation/)).toBeTruthy()
  })

  it('colors Earth (ocean gradient + land) while in view, outline only when not', () => {
    renderAt(0)
    expect(bodyAt(0, 'earth').visible).toBe(true)
    const fill = document.querySelector('circle[fill^="url(#"]')
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
    expect(document.querySelector('circle[fill^="url(#"]')).toBeNull()
    expect(document.querySelector('ellipse[data-body="earth"]')?.getAttribute('stroke-dasharray')).toBe('2 2')
  })

  it('at a time the timeline marks Sun "blocked", draws the Sun disk below the silhouette', () => {
    // A sample inside a gap between Sun windows (the timeline shows "not lit"), mid-gap so the disk is fully hidden
    // (near the gap edges it is partly above the terrain), and above the bottom of the plot so it is drawn.
    const i = samples.tUtcMs.findIndex(
      (t, k) => !isIn(windows.sun, t) && samples.sunFraction[k] === 0 && samples.sunElevDeg[k] > ELEV_MIN_DEG,
    )
    expect(i).toBeGreaterThan(-1)
    renderAt(i)
    const sun = bodyAt(i, 'sun')
    const d = disk('sun')
    const terrainY = elevToY(horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, sun.azDeg))
    // SVG y grows downward: the whole disk (top edge) is below the terrain line.
    expect(d.cy - d.ry).toBeGreaterThan(terrainY)
    expect(screen.getByRole('img', { name: /Fixture plateau horizon/ })).toBeTruthy()
    expect(within(screen.getByRole('figure')).getByText(/Sun.*blocked/i)).toBeTruthy()
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
})
