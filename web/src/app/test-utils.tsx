import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from './app'
import { fixtureDataSource, type DataSource } from './data'

/**
 * Renders the App on fixture data and opens the Details drawer (the full metric table and timeline live there).
 * The default tab is 3D Terrain; the drawer opens over whichever view is showing.
 */
export async function renderAppWithDetails(source: DataSource = fixtureDataSource()) {
  render(<App dataSources={{ source }} />)
  const deck = await screen.findByRole('region', { name: 'Mission deck' })
  fireEvent.click(within(deck).getByRole('button', { name: 'Details' }))
  await screen.findByRole('dialog', { name: 'Details' })
}
