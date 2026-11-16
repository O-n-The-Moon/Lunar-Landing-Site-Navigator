import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OBSERVER_HEIGHT_M, DEFAULT_VISIBILITY_OPTS, missionMetrics, siteContext } from '../../engine'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { DEFAULT_LANDING_MS, HOUR_MS } from '../state'
import { OUTLOOK_DAY_MIN, bestSlipIndex } from './slip-outlook'

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

  it('maps the first and last columns to −30 d and +90 d', async () => {
    const strips = await renderOutlook()
    const strip = strips[0]
    strip.getBoundingClientRect = () => ({ left: 0, width: 121, top: 0, height: 7, right: 121, bottom: 7, x: 0, y: 0, toJSON: () => ({}) })
    const days = screen.getByRole('slider', { name: /slip \(days\)/i })
    fireEvent.click(strip, { clientX: 120.9 })
    expect(days).toHaveValue('90')
    fireEvent.click(strip, { clientX: 0.1 })
    expect(days).toHaveValue('-30')
  })
})

describe('bestSlipIndex', () => {
  const N = 121
  const strip = (fill: number, set: Record<number, number> = {}) => Float32Array.from({ length: N }, (_, i) => set[i] ?? fill)
  const at = (day: number) => day - OUTLOOK_DAY_MIN

  it('picks the highest Both %', () => {
    expect(bestSlipIndex(strip(10, { [at(15)]: 80 }))).toBe(at(15))
  })

  it('breaks ties toward the slip nearest 0', () => {
    expect(bestSlipIndex(strip(0, { [at(-20)]: 50, [at(7)]: 50, [at(40)]: 50 }))).toBe(at(7))
    expect(bestSlipIndex(strip(0, { [at(-3)]: 50, [at(3)]: 50 }))).toBe(at(-3)) // equally near: the earlier one
  })

  it('recommends nothing for a strip that is all zero, all equal, or not computed', () => {
    expect(bestSlipIndex(strip(0))).toBeNull()
    expect(bestSlipIndex(strip(100))).toBeNull()
    expect(bestSlipIndex(strip(NaN))).toBeNull()
  })

  it('ignores slips that were not computed', () => {
    expect(bestSlipIndex(strip(NaN, { [at(2)]: 30, [at(5)]: 60 }))).toBe(at(5))
  })
})
