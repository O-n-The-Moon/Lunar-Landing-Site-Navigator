import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'

afterEach(cleanup)

describe('TimelinePanel', () => {
  it('mounts a strip per site whose cursor drives the scenario cursor', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    const panel = await screen.findByRole('region', { name: 'Timeline' })
    const sliders = within(panel).getAllByRole('slider')
    expect(sliders.length).toBeGreaterThan(0)
    const before = Number(sliders[0].getAttribute('aria-valuenow'))
    fireEvent.keyDown(sliders[0], { key: 'ArrowRight' })
    // Every strip reads the one scenario cursor, so all of them move.
    for (const s of within(panel).getAllByRole('slider')) {
      expect(Number(s.getAttribute('aria-valuenow'))).toBe(before + 3_600_000)
    }
  })
})
