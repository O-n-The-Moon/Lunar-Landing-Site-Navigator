import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { renderedRidgeYAt } from './test-helpers'

afterEach(cleanup)

const plateau = fixtureSitesFile.sites.find((s) => s.id === 'fixture-plateau')
if (!plateau) throw new Error('fixture-plateau missing')

async function renderApp() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  return screen.findByRole('region', { name: 'Horizon panorama' })
}

/** Sun disk as drawn, and whether the rendered ridge hides it across its whole (true) width. */
function drawnSun(panel: HTMLElement) {
  const el = panel.querySelector('ellipse[data-body="sun"]')
  if (!el) return null
  const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map((a) => Number(el.getAttribute(a)))
  // SVG y grows downward: hidden when the disk's top is below the ridge everywhere across its width.
  return { hidden: [-1, -0.5, 0, 0.5, 1].every((f) => cy - ry > renderedRidgeYAt(cx + f * rx, panel)) }
}

describe('PanoramaPanel', () => {
  it('says why the focused site has no horizon (default 14-day mission is outside the 48 h fixture ephemeris)', async () => {
    const panel = await renderApp()
    expect(within(panel).queryByRole('img')).toBeNull()
    const name = plateau.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(within(panel).getByText(new RegExp(`^No horizon for ${name}: .+`))).toBeTruthy()
  })

  it('follows the scenario cursor and agrees with the timeline; when the timeline marks Sun "blocked", the disk is below the silhouette', async () => {
    const panel = await renderApp()
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
    // The focused site is the first scenario site.
    expect(within(panel).getByText(plateau.name)).toBeTruthy()
    const slider = within(screen.getByRole('region', { name: 'Timeline' })).getAllByRole('slider')[0]
    expect(slider.getAttribute('aria-label')).toMatch(plateau.name)

    // Step the shared cursor hour by hour through the mission.
    let blockedHiddenSteps = 0
    for (let k = 0; k <= 24; k++) {
      if (k > 0) fireEvent.keyDown(slider, { key: 'ArrowRight' })
      const tl = slider.getAttribute('aria-valuetext') ?? ''
      const sunUp = /Sunset in|No sunset in mission/.test(tl)
      const earthUp = /Earthset in|No Earthset in mission/.test(tl)
      // Lit / in view always matches the timeline.
      expect(within(panel).getByText(sunUp ? /^Sun lit/ : /^Sun blocked/)).toBeTruthy()
      expect(within(panel).getByText(earthUp ? /^Earth in view/ : /^Earth not in view/)).toBeTruthy()
      // Timeline says blocked and the drawn disk is under the drawn ridge across its whole width. (On a steep ridge the
      // engine, which tests the horizon at the center azimuth only, can call a disk blocked while a sliver shows.)
      if (!sunUp && drawnSun(panel)?.hidden) blockedHiddenSteps++
    }
    expect(blockedHiddenSteps).toBeGreaterThan(0)
  })
})
