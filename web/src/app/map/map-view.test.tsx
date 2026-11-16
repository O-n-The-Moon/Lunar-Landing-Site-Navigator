import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { MOON_RADIUS_KM, latLonToKm } from './projection'

afterEach(cleanup)
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

/**
 * The App on fixture data, Map tab open. The fixture PGDA raster is 8 × 8 cells of 2 km: x, y ∈ [−8, 8) km. The map is mocked
 * to 160 px wide, so 1 px = 0.1 km. The fixture grid is the same 8 × 8: (−89.97°, 30°E) is in cell (4, 4), and the
 * no-data cell is (7, 7).
 */
async function openMap() {
  const user = userEvent.setup()
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  await user.click(await screen.findByRole('tab', { name: /opportunity map/i }))
  const plot = await screen.findByRole('img', { name: /opportunity map/i })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 160, height: 160, right: 160, bottom: 160, x: 0, y: 0, toJSON: () => ({}),
  })
  const clickAt = (latDeg: number, lonDeg: number) => {
    const { xKm, yKm } = latLonToKm(MOON_RADIUS_KM, latDeg, lonDeg)
    fireEvent.click(plot, { clientX: (xKm + 8) * 10, clientY: (8 - yKm) * 10 })
  }
  const siteNames = () => within(screen.getByRole('group', { name: /^sites/i })).getAllByRole('radio').map((r) => r.closest('label')?.textContent)
  return { user, plot, clickAt, siteNames }
}

describe('MapView', () => {
  it('shows the map with the layer control and the PGDA provenance once the layers load', async () => {
    await openMap()
    expect(screen.getByRole('radiogroup', { name: /layer/i })).toBeInTheDocument()
    expect(screen.getByText(/Source: synthetic test fixture/)).toBeInTheDocument()
    expect(screen.getByText(/observer height not documented by PGDA/)).toBeInTheDocument()
  })

  it('adds a clicked point as a custom site, snapped to its grid cell', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30)
    expect(await screen.findByText(/Added Custom 89\.97°S 30\.\d+°E \(snapped/)).toBeInTheDocument()
    expect(siteNames()).toContainEqual(expect.stringContaining('Custom 89.97°S'))
    expect(screen.getByTestId(/^marker-custom-4-4$/)).toHaveClass('marker-selected')
  })

  it('says so when the clicked cell has no terrain data', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    const before = siteNames().length
    clickAt(-89.67, 45) // cell (7, 7): no data
    expect(await screen.findByText(/No terrain data at that point/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(before)
  })

  it('does not add the same grid cell twice', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30)
    await screen.findByText(/Added Custom/)
    const after = siteNames().length
    clickAt(-89.97, 30)
    expect(await screen.findByText(/already in the scenario/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(after)
  })

  it('refuses a fourth site with a message instead of adding it', async () => {
    const { clickAt, siteNames } = await openMap()
    await waitFor(() => expect(screen.getByText(/Horizon grid loaded/)).toBeInTheDocument())
    clickAt(-89.97, 30) // the default scenario has 2 sites, so this fills it
    await screen.findByText(/Added Custom/)
    clickAt(-89.97, -150) // a different, valid cell
    expect(await screen.findByText(/already has 3 sites/)).toBeInTheDocument()
    expect(siteNames()).toHaveLength(3)
  })

  it('keeps the chosen layer in the scenario, so it survives switching tabs', async () => {
    const { user } = await openMap()
    await user.click(within(screen.getByRole('radiogroup', { name: /layer/i })).getByRole('radio', { name: /earth/i }))
    await user.click(screen.getByRole('tab', { name: /compare/i }))
    await user.click(screen.getByRole('tab', { name: /opportunity map/i }))
    const group = await screen.findByRole('radiogroup', { name: /layer/i })
    expect(within(group).getByRole('radio', { name: /earth/i })).toBeChecked()
  })
})
