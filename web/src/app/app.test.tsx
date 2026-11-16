import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './app'
import { fixtureDataSource, type DataSource } from './data'

// Vitest runs without globals, so Testing Library can't auto-clean between tests.
afterEach(cleanup)

function renderApp(source: DataSource = fixtureDataSource()) {
  render(<App dataSources={{ source }} />)
  return screen.findByRole('heading', { name: 'Scenario' })
}

const siteList = () => within(screen.getByRole('group', { name: /sites/i })).getAllByRole('radio')

describe('App shell', () => {
  it('renders the title, a fixture-data warning, the tabs and every view placeholder', async () => {
    await renderApp()
    // 3D Terrain is the default tab; the other views mount when first opened.
    expect(screen.getByRole('tab', { name: '3D Terrain' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }))
    expect(screen.getByRole('heading', { name: /lunar landing site navigator/i })).toBeInTheDocument()
    expect(screen.getByText(/synthetic fixture data/i)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['3D Terrain', 'Compare', 'Opportunity Map', 'Validation'])
    for (const name of ['Compare', 'Timeline', 'Horizon panorama']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    for (const name of ['Slip', 'Custom site', 'Options']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
  })

  it('shows a clear message when data fails to load', async () => {
    const failing: DataSource = { ...fixtureDataSource(), loadCore: () => Promise.reject(new Error('sites.json: HTTP 404')) }
    render(<App dataSources={{ source: failing }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load mission data.*sites\.json: HTTP 404/i)
  })

  it('without WebGL the 3D Terrain tab says so and shows the 2D map; the grid loads once and the Map tab adds no second load', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadGrid: vi.fn(fixtures.loadGrid), loadGridHeights: vi.fn(fixtures.loadGridHeights) }
    await renderApp(source) // src/test-setup.ts: jsdom has no WebGL
    const terrain = screen.getByRole('tabpanel', { name: '3D Terrain' })
    expect(within(terrain).getByText(/needs WebGL 2/i)).toHaveTextContent(/showing the 2D opportunity map instead/i)
    await waitFor(() => expect(source.loadGrid).toHaveBeenCalledTimes(1))
    expect(source.loadGridHeights).not.toHaveBeenCalled() // no 3D scene, no 3D heights

    await userEvent.click(screen.getByRole('tab', { name: 'Opportunity Map' }))
    expect(await within(screen.getByRole('tabpanel', { name: 'Opportunity Map' })).findByText(/horizon grid loaded: 8 × 8 cells/i)).toBeInTheDocument()
    expect(source.loadGrid).toHaveBeenCalledTimes(1)
  })

  it('supports arrow-key tab navigation', async () => {
    await renderApp()
    const terrain = screen.getByRole('tab', { name: '3D Terrain' })
    terrain.focus()
    await userEvent.keyboard('{ArrowLeft}') // wraps from the first tab to the last
    const validation = screen.getByRole('tab', { name: 'Validation' })
    expect(validation).toHaveAttribute('aria-selected', 'true')
    expect(validation).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Validation' })).toBeVisible()
  })
})

describe('site picker', () => {
  it('starts with two curated sites, the first focused', async () => {
    await renderApp()
    const radios = siteList()
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Fixture Plateau'),
      expect.stringContaining('Fixture Ridge'),
    ])
    expect(radios[0]).toBeChecked()
  })

  it('changes focus, removes and re-adds a site', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(siteList()[1])
    expect(siteList()[1]).toBeChecked()

    await user.click(screen.getByRole('button', { name: /remove fixture ridge/i }))
    expect(siteList()).toHaveLength(1)
    expect(siteList()[0]).toBeChecked() // focus fell back to the remaining site

    const select = screen.getByLabelText('Add curated site')
    expect(within(select).getByRole('option', { name: /fixture plateau/i })).toBeDisabled()
    await user.selectOptions(select, 'fixture-ridge')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(siteList()).toHaveLength(2)
    expect(screen.getByRole('group', { name: /sites \(2\/3\)/i })).toBeInTheDocument()
  })
})

describe('date controls', () => {
  it('updates the landing time (UTC) and the derived mission end', async () => {
    await renderApp()
    const landing = screen.getByLabelText('Landing (UTC)')
    expect(landing).toHaveValue('2026-03-01T00:00')
    fireEvent.change(landing, { target: { value: '2026-03-02T06:30' } })
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('2026-03-02 06:30 UTC → 2026-03-16 06:30 UTC')
  })

  it('rejects a landing outside the ephemeris and flags missions that run past it', async () => {
    await renderApp()
    // The fixture ephemeris covers 48 h; the default 14-day mission runs past it.
    expect(screen.getByText(/part of the mission .* is outside the ephemeris/i)).toBeInTheDocument()

    const landing = screen.getByLabelText('Landing (UTC)')
    fireEvent.change(landing, { target: { value: '2040-01-01T00:00' } })
    expect(landing).toHaveAttribute('aria-invalid', 'true')
    expect(landing).toHaveAccessibleDescription(/outside the ephemeris \(2026-03-01 00:00 UTC → 2026-03-03 00:00 UTC\)/i)
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('2026-03-01 00:00 UTC →') // unchanged
  })

  it('updates the duration, flags out-of-range values and clamps them on blur', async () => {
    const user = userEvent.setup()
    await renderApp()
    const duration = screen.getByLabelText('Duration (days)')
    expect(duration).toHaveValue(14)

    await user.clear(duration)
    await user.type(duration, '3')
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('→ 2026-03-04 00:00 UTC')

    await user.clear(duration)
    await user.type(duration, '45')
    expect(duration).toHaveAccessibleDescription('Whole days, 1–30.')
    await user.tab()
    expect(duration).toHaveValue(30)
    expect(duration).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('→ 2026-03-31 00:00 UTC')
  })
})
