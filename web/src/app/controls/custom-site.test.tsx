import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderAppOnCompare } from '../test-utils'
import { fixtureDataSource, type DataSource } from '../data'
import { customSiteLabel } from './custom-site'

afterEach(cleanup)

/**
 * The App on fixture data with a 1-day mission (the fixture ephemeris covers 48 h). The fixture grid is 8 × 8 cells
 * of 2 km around the pole: (−89.97°, 30°E) lands in cell (4, 4), 0.6 km from its center; (−89.67°, 45°E) is the
 * no-data cell (7, 7); −85° is outside the grid.
 */
async function renderCustomSite(source: DataSource = fixtureDataSource()) {
  const user = userEvent.setup()
  await renderAppOnCompare(source)
  const group = await screen.findByRole('group', { name: /custom site/i })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  const lat = within(group).getByLabelText(/latitude/i)
  const lon = within(group).getByLabelText(/longitude/i)
  const add = within(group).getByRole('button', { name: /add/i })
  const enter = async (latText: string, lonText: string) => {
    await user.clear(lat)
    if (latText) await user.type(lat, latText)
    await user.clear(lon)
    if (lonText) await user.type(lon, lonText)
    await waitFor(() => expect(add).toBeEnabled()) // the grid loads once the inputs are used
    await user.click(add)
  }
  return { user, group, lat, lon, add, enter }
}

const siteNames = () => within(screen.getByRole('group', { name: /^sites/i })).getAllByRole('radio').map((r) => r.closest('label')?.textContent)

describe('customSiteLabel', () => {
  it('formats the entered point and the snap distance', () => {
    expect(customSiteLabel(-85.123, 30.4, 0.84)).toBe('Custom 85.12°S 30.40°E (snapped 0.8 km)')
    expect(customSiteLabel(-89.5, -120, 1.04)).toBe('Custom 89.50°S 120.00°W (snapped 1.0 km)')
  })
})

describe('CustomSite', () => {
  it('snaps a typed point to the nearest grid cell, adds it and shows the snap label', async () => {
    const { group, enter } = await renderCustomSite()
    await enter('-89.97', '30')
    expect(within(group).getByRole('status')).toHaveTextContent('Custom 89.97°S 30.00°E (snapped 0.6 km)')
    expect(siteNames()).toContainEqual(expect.stringContaining('Custom 89.97°S 30.00°E'))
    // Its metrics come from the grid cell and say so.
    const header = await screen.findByRole('columnheader', { name: /custom 89\.97°S/i })
    expect(header).toHaveTextContent(/grid-approximate \(2 km\)/)
    expect(header).toHaveTextContent(/observer 2 m · snapped 0\.6 km/)
  })

  // The 3D Terrain tab (the default) streams the horizon grid after first paint, so the grid load is already under way
  // when the form is first used; typing a coordinate must share that load, never start a second one.
  it('shares the one terrain-grid load: tabbing past or typing a coordinate does not start another', async () => {
    const fixtures = fixtureDataSource()
    const source: DataSource = { ...fixtures, loadGrid: vi.fn(fixtures.loadGrid) }
    const { user, lat, add } = await renderCustomSite(source)
    await user.click(lat)
    await user.tab()
    await user.type(lat, '-8') // a lone '-' is not a number yet, so the first digit is what the form reacts to
    await waitFor(() => expect(add).toBeEnabled())
    expect(source.loadGrid).toHaveBeenCalledTimes(1)
  })

  it('disables Add while the terrain grid loads, with progress', async () => {
    const fixtures = fixtureDataSource()
    let finish: () => void = () => {}
    const loadGrid: DataSource['loadGrid'] = (onProgress) =>
      new Promise((resolve) => {
        onProgress(0.4)
        finish = () => void fixtures.loadGrid(() => {}).then(resolve)
      })
    const { user, group, lat, add } = await renderCustomSite({ ...fixtures, loadGrid })
    await user.type(lat, '-89.97')
    expect(add).toBeDisabled()
    expect(within(group).getByText(/loading terrain grid 40%/i)).toBeInTheDocument()
    finish()
    await waitFor(() => expect(add).toBeEnabled())
  })

  it('shows an inline error outside the grid coverage and adds nothing', async () => {
    const { group, lat, enter } = await renderCustomSite()
    await enter('-85', '0')
    expect(within(group).getByRole('alert')).toHaveTextContent(/outside the terrain grid/i)
    expect(within(group).getByRole('alert')).not.toHaveTextContent(/negative/i) // that hint is for positive latitudes
    expect(lat).toHaveAttribute('aria-invalid', 'true')
    expect(siteNames()).toHaveLength(2)
  })

  it('treats a no-data grid cell as outside coverage', async () => {
    const { group, enter } = await renderCustomSite()
    await enter('-89.67', '45')
    expect(within(group).getByRole('alert')).toHaveTextContent(/outside the terrain grid/i)
    expect(siteNames()).toHaveLength(2)
  })

  it('hints that south latitudes are negative when a positive latitude misses the grid', async () => {
    const { group, enter } = await renderCustomSite()
    await enter('89.97', '30')
    expect(within(group).getByRole('alert')).toHaveTextContent(/south.*negative/i)
  })

  it('validates the numbers before snapping', async () => {
    const { group, enter } = await renderCustomSite()
    await enter('', '30')
    expect(within(group).getByRole('alert')).toHaveTextContent(/enter.*latitude.*longitude/i)
    await enter('-95', '30')
    expect(within(group).getByRole('alert')).toHaveTextContent(/latitude.*−90.*90/i)
    await enter('-89.97', '400')
    expect(within(group).getByRole('alert')).toHaveTextContent(/longitude/i)
  })

  it('accepts longitudes 180–360 (east-positive) and labels them in −180…180', async () => {
    const { group, enter } = await renderCustomSite()
    await enter('-89.97', '330')
    expect(within(group).getByRole('status')).toHaveTextContent('Custom 89.97°S 30.00°W')
  })

  it('clears the last message when the user edits the inputs again', async () => {
    const { user, group, lat, enter } = await renderCustomSite()
    await user.click(screen.getAllByRole('button', { name: /^remove/i })[0])
    await enter('-89.97', '30')
    expect(within(group).getByRole('status')).toHaveTextContent(/added/i)
    await user.type(lat, '-8')
    expect(within(group).queryByText(/added/i)).toBeNull()
  })

  it('refuses a grid cell that is already in the scenario', async () => {
    const { user, group, enter } = await renderCustomSite()
    await user.click(screen.getAllByRole('button', { name: /^remove/i })[0]) // room for two custom sites
    await enter('-89.97', '30')
    await enter('-89.975', '31') // same 2 km cell
    expect(within(group).getByRole('alert')).toHaveTextContent(/already in the scenario/i)
    expect(siteNames()).toHaveLength(2)
  })

  it('is disabled with a hint once 3 sites are chosen', async () => {
    const { group, add, enter } = await renderCustomSite()
    await enter('-89.97', '30')
    expect(add).toBeDisabled()
    expect(within(group).getByText(/maximum 3 sites/i)).toBeInTheDocument()
  })

  it('shows a grid load error with a retry', async () => {
    const fixtures = fixtureDataSource()
    let healthy = false // the 503 lasts until the user retries
    const loadGrid = vi.fn<DataSource['loadGrid']>((onProgress) =>
      healthy ? fixtures.loadGrid(onProgress) : Promise.reject(new Error('grid.json: HTTP 503')),
    )
    const { user, group, lat } = await renderCustomSite({ ...fixtures, loadGrid })
    await user.type(lat, '-8') // a lone '-' is not a number yet, so the first digit asks for the grid
    expect(await within(group).findByRole('alert')).toHaveTextContent(/grid\.json: HTTP 503/)
    healthy = true
    const before = loadGrid.mock.calls.length
    await user.click(within(group).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(within(group).getByRole('button', { name: /add/i })).toBeEnabled())
    expect(loadGrid.mock.calls.length).toBe(before + 1) // one retry, one more load
  })
})
