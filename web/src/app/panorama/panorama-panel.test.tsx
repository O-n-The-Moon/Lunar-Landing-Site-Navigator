import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { horizonElevAt, visibleDiskFraction } from '../../engine'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { AZ_UNITS_PER_DEG, ELEV_MAX_DEG, ELEV_UNITS_PER_DEG, elevToY } from './horizon-panorama'

afterEach(cleanup)

const plateau = fixtureSitesFile.sites.find((s) => s.id === 'fixture-plateau')
if (!plateau) throw new Error('fixture-plateau missing')
const mask = plateau.horizonElevDeg['2']

async function renderApp() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  return screen.findByRole('region', { name: 'Horizon panorama' })
}

/** Sun disk as drawn: center elevation, radius (deg) and the terrain under it, read back from the SVG. */
function drawnSun(panel: HTMLElement) {
  const el = panel.querySelector('ellipse[data-body="sun"]')
  if (!el) return null
  const cx = Number(el.getAttribute('cx'))
  const cy = Number(el.getAttribute('cy'))
  const r = Number(el.getAttribute('ry'))
  const azDeg = cx / AZ_UNITS_PER_DEG
  const elevDeg = ELEV_MAX_DEG - cy / ELEV_UNITS_PER_DEG
  const radiusDeg = r / ELEV_UNITS_PER_DEG
  const terrainDeg = horizonElevAt(mask, fixtureSitesFile.azStepDeg, azDeg)
  return { topY: cy - r, terrainY: elevToY(terrainDeg), fraction: visibleDiskFraction(elevDeg, terrainDeg, radiusDeg) }
}

describe('PanoramaPanel', () => {
  it('says why the focused site has no horizon (default 14-day mission is outside the 48 h fixture ephemeris)', async () => {
    const panel = await renderApp()
    expect(within(panel).queryByRole('img')).toBeNull()
    const name = plateau.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(within(panel).getByText(new RegExp(`^No horizon for ${name}: .+`))).toBeTruthy()
  })

  it('follows the scenario cursor: at a time the timeline marks Sun "blocked", the Sun disk is below the silhouette', async () => {
    const panel = await renderApp()
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
    // The focused site is the first scenario site.
    expect(within(panel).getByText(plateau.name)).toBeTruthy()
    const slider = within(screen.getByRole('region', { name: 'Timeline' })).getAllByRole('slider')[0]
    expect(slider.getAttribute('aria-label')).toMatch(plateau.name)

    // Step the shared cursor hour by hour through the mission; stop at a time the timeline says the Sun is down
    // and the drawn disk is fully hidden (near sunset/sunrise, hysteresis allows a partly visible disk).
    let found = false
    for (let k = 0; k <= 24 && !found; k++) {
      if (k > 0) fireEvent.keyDown(slider, { key: 'ArrowRight' })
      const timelineSaysDown = /Sunrise in|No sunrise in mission/.test(slider.getAttribute('aria-valuetext') ?? '')
      const sun = drawnSun(panel)
      if (!timelineSaysDown || !sun || sun.fraction > 0) continue
      found = true
      expect(within(panel).getByText(/^Sun blocked/)).toBeTruthy()
      // SVG y grows downward: the whole disk (top edge) is below the terrain line.
      expect(sun.topY).toBeGreaterThan(sun.terrainY)
    }
    expect(found).toBe(true)
  })
})
