import { fireEvent, render, screen } from '@testing-library/react'
import { App } from './app'
import { fixtureDataSource, type DataSource } from './data'

/** Renders the App on fixture data and opens the Compare tab (the default tab is 3D Terrain). */
export async function renderAppOnCompare(source: DataSource = fixtureDataSource()) {
  render(<App dataSources={{ source }} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Compare' }))
}
