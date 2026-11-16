import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OBSERVER_HEIGHT_M, DEFAULT_VISIBILITY_OPTS, missionMetrics, siteContext } from '../../engine'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { DEFAULT_LANDING_MS, HOUR_MS } from '../state'

afterEach(cleanup)

/** The App on fixture data with a 1-day mission: the 48 h fixture ephemeris covers only the slips 0 and +1 d. */
async function renderOutlook() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  await screen.findByRole('heading', { name: 'Scenario' })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  const strips = await screen.findAllByRole('img', { name: /power \+ comms/i })
  return strips
}

const titleOf = (strip: Element, day: string) => within(strip as HTMLElement).getByText(new RegExp(`^${day}: `)).textContent

describe('slip outlook', () => {
  it('draws one strip per site, with Both % from missionMetrics for each covered slip and n/a for the rest', async () => {
    const strips = await renderOutlook()
    expect(strips).toHaveLength(2) // the first two fixture sites
    const ctx = siteContext(fixtureEphemeris, fixtureSitesFile.sites[0], fixtureSitesFile.azStepDeg, DEFAULT_OBSERVER_HEIGHT_M)
    const both = (slipD: number) => missionMetrics(ctx, DEFAULT_LANDING_MS + slipD * 24 * HOUR_MS, 24, DEFAULT_VISIBILITY_OPTS).bothPct
    await waitFor(() => expect(titleOf(strips[0], '0 d')).toBe(`0 d: ${both(0).toFixed(1)} %`))
    expect(titleOf(strips[0], '\\+1 d')).toBe(`+1 d: ${both(1).toFixed(1)} %`)
    expect(titleOf(strips[0], '\\+2 d')).toBe('+2 d: n/a')
    expect(titleOf(strips[0], '−30 d')).toBe('−30 d: n/a')
  })

  it('jumps to a slip when a column is clicked', async () => {
    const strips = await renderOutlook()
    const strip = strips[0]
    strip.getBoundingClientRect = () => ({ left: 0, width: 121, top: 0, height: 7, right: 121, bottom: 7, x: 0, y: 0, toJSON: () => ({}) })
    // Column i spans [i, i + 1) of 121: i = 31 is day +1.
    fireEvent.click(strip, { clientX: 31.5 })
    expect(screen.getByRole('slider', { name: /days/i })).toHaveValue('1')
    expect(screen.getByText('+1 d', { selector: '.slip-total' })).toBeInTheDocument()
  })
})
