import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    expect(screen.getByRole('heading', { name: /lunar landing site navigator/i })).toBeInTheDocument()
    expect(screen.getByText(/synthetic fixture data/i)).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Compare', 'Opportunity Map', 'Validation'])
    for (const name of ['Compare', 'Timeline', 'Horizon panorama', 'Slip', 'Custom site', 'Options']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('shows a clear message when data fails to load', async () => {
    const failing: DataSource = { ...fixtureDataSource(), loadCore: () => Promise.reject(new Error('sites.json: HTTP 404')) }
    render(<App dataSources={{ source: failing }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load mission data.*sites\.json: HTTP 404/i)
  })

  it('loads the grid only when the Opportunity Map tab first opens', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadGrid: vi.fn(fixtures.loadGrid) }
    await renderApp(source)
    expect(source.loadGrid).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('tab', { name: 'Opportunity Map' }))
    expect(await screen.findByText(/horizon grid loaded: 8 × 8 cells/i)).toBeInTheDocument()
    expect(source.loadGrid).toHaveBeenCalledTimes(1)
  })

  it('supports arrow-key tab navigation', async () => {
    await renderApp()
    const compare = screen.getByRole('tab', { name: 'Compare' })
    compare.focus()
    await userEvent.keyboard('{ArrowLeft}')
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
    fireEvent.change(landing, { target: { value: '2026-04-10T06:30' } })
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('2026-04-10 06:30 UTC → 2026-04-24 06:30 UTC')
  })

  it('updates the duration and ignores out-of-range values', async () => {
    const user = userEvent.setup()
    await renderApp()
    const duration = screen.getByLabelText('Duration (days)')
    expect(duration).toHaveValue(14)

    await user.clear(duration)
    await user.type(duration, '3')
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('→ 2026-03-04 00:00 UTC')

    await user.clear(duration)
    await user.type(duration, '45')
    expect(screen.getByText(/baseline mission/i)).toHaveTextContent('→ 2026-03-05 00:00 UTC') // "4" applied, "45" rejected
    await user.tab()
    expect(duration).toHaveValue(4)
  })
})
