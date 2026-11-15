import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { horizonElevAt } from '../../engine'
import { fixtureOutputs, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { elevToY } from './horizon-panorama'

afterEach(cleanup)

const H_MS = 3_600_000
const plateau = fixtureOutputs['fixture-plateau']
const plateauName = fixtureSitesFile.sites.find((s) => s.id === 'fixture-plateau')?.name ?? ''

describe('PanoramaPanel', () => {
  it('follows the scenario cursor: at a time the timeline marks Sun "blocked", the Sun disk is below the silhouette', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    const panel = await screen.findByRole('region', { name: 'Horizon panorama' })
    // The focused site is the first scenario site.
    expect(within(panel).getByText(plateauName)).toBeTruthy()

    // 2026-03-01 18:00 UTC: the plateau's Sun is fully behind terrain (between its two Sun windows).
    const blockedMs = Date.UTC(2026, 2, 1, 18)
    expect(plateau.windows.sun.some((w) => w.startMs <= blockedMs && blockedMs < w.endMs)).toBe(false)
    const timeline = screen.getByRole('region', { name: 'Timeline' })
    const slider = within(timeline).getAllByRole('slider')[0]
    const steps = (blockedMs - Number(slider.getAttribute('aria-valuenow'))) / H_MS
    expect(Number.isInteger(steps) && steps > 0).toBe(true)
    for (let k = 0; k < steps; k++) fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBe(blockedMs)

    expect(within(panel).getByText(/^Sun blocked/)).toBeTruthy()
    const sun = panel.querySelector('ellipse[data-body="sun"]')
    if (!sun) throw new Error('no Sun disk')
    const i = plateau.samples.tUtcMs.indexOf(blockedMs)
    const terrainY = elevToY(horizonElevAt(plateau.ctx.horizonMaskDeg, plateau.ctx.azStepDeg, plateau.samples.sunAzDeg[i]))
    const topY = Number(sun.getAttribute('cy')) - Number(sun.getAttribute('ry'))
    expect(topY).toBeGreaterThan(terrainY)
  })
})
