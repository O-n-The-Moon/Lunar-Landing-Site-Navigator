import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'

afterEach(cleanup)

describe('TimelinePanel', () => {
  it('mounts a strip per site whose cursor drives the scenario cursor', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    const panel = await screen.findByRole('region', { name: 'Timeline' })
    // The fixture ephemeris covers 48 h, so the default 14-day mission has no results; use 1 day.
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
    const sliders = within(panel).getAllByRole('slider')
    // ≥ 2 strips, or "all strips move together" below proves nothing.
    expect(sliders.length).toBeGreaterThanOrEqual(2)
    const before = Number(sliders[0].getAttribute('aria-valuenow'))
    fireEvent.keyDown(sliders[0], { key: 'ArrowRight' })
    // Every strip reads the one scenario cursor, so all of them move.
    for (const s of within(panel).getAllByRole('slider')) {
      expect(Number(s.getAttribute('aria-valuenow'))).toBe(before + 3_600_000)
    }
  })
})
