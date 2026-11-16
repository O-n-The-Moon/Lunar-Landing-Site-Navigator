import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_OBSERVER_HEIGHT_M, DEFAULT_VISIBILITY_OPTS, missionMetrics, siteContext, type Window } from '../../engine'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { HOUR_MS, DEFAULT_LANDING_MS } from '../state'
import { bandSegments, formatPct, formatPoints } from './site-rows'

afterEach(cleanup)

const win = (startMs: number, endMs: number): Window => ({ startMs, endMs, clippedStart: false, clippedEnd: false })

describe('formatPoints / formatPct', () => {
  it.each([
    [0, '±0'],
    [0.4, '±0'],
    [-0.4, '±0'],
    [12.6, '+13'],
    [-47.5, '−48'],
  ])('%f points → %s', (v, text) => expect(formatPoints(v)).toBe(text))

  it('rounds percentages to whole numbers', () => {
    expect(formatPct(33.6)).toBe('34 %')
    expect(formatPct(0)).toBe('0 %')
  })
})

describe('bandSegments', () => {
  it('clips windows to the mission and returns fractions of it', () => {
    const segs = bandSegments([win(-50, 10), win(40, 60), win(90, 200), win(300, 400)], 0, 100)
    expect(segs).toEqual([
      { from: 0, to: 0.1 },
      { from: 0.4, to: 0.6 },
      { from: 0.9, to: 1 },
    ])
  })
})

describe('deck site rows', () => {
  it('show the slipped mission’s metrics for each site, and the Sun change from the baseline', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('heading', { name: 'Scenario' })
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } }) // the fixture ephemeris is 48 h
    fireEvent.change(screen.getByRole('slider', { name: /fine/i }), { target: { value: '6' } })

    const site = fixtureSitesFile.sites[0]
    const ctx = siteContext(fixtureEphemeris, site, fixtureSitesFile.azStepDeg, DEFAULT_OBSERVER_HEIGHT_M)
    const base = missionMetrics(ctx, DEFAULT_LANDING_MS, 24, DEFAULT_VISIBILITY_OPTS)
    const slipped = missionMetrics(ctx, DEFAULT_LANDING_MS + 6 * HOUR_MS, 24, DEFAULT_VISIBILITY_OPTS)

    const row = within(screen.getByRole('list', { name: 'Site numbers' })).getAllByRole('listitem')[0]
    expect(row).toHaveTextContent(formatPct(slipped.sunlitPct))
    const metric = (label: string) => within(row).getByText(label, { selector: 'small' }).parentElement
    expect(metric('Sun')).toHaveTextContent(`${formatPct(slipped.sunlitPct)}${formatPoints(slipped.sunlitPct - base.sunlitPct)}`)
    expect(metric('Earth')).toHaveTextContent(formatPct(slipped.earthPct))
    expect(metric('Both')).toHaveTextContent(formatPct(slipped.bothPct))
    expect(within(row).getByText(/^(Sunset|Sunrise) in |^No sun(set|rise) in mission/)).toBeInTheDocument()
  })

  it('show no change at slip 0 and say what is missing for a site the engine cannot run', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    await screen.findByRole('heading', { name: 'Scenario' })
    const row = within(screen.getByRole('list', { name: 'Site numbers' })).getAllByRole('listitem')[0]
    expect(row.querySelector('.metric-delta')).toBeNull()
    // A slip past the fixture ephemeris leaves every site without data, with the reason in the row.
    fireEvent.change(screen.getByRole('slider', { name: /days/i }), { target: { value: '30' } })
    const after = within(screen.getByRole('list', { name: 'Site numbers' })).getAllByRole('listitem')[0]
    expect(after).toHaveTextContent(/outside the ephemeris/i)
  })
})
