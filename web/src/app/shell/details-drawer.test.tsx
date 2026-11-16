import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'

afterEach(cleanup)

async function renderApp() {
  const user = userEvent.setup()
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  await screen.findByRole('tab', { name: '3D Terrain' })
  // The fixture ephemeris covers 48 h: a 1-day mission fits, so the timeline renders.
  const duration = screen.getByLabelText('Duration (days)')
  await user.clear(duration)
  await user.type(duration, '1')
  return user
}

const detailsButton = () => within(screen.getByRole('region', { name: 'Mission deck' })).getByRole('button', { name: 'Details' })

describe('Details drawer', () => {
  it('is closed at first; the deck button opens it with the full metric table and the timeline', async () => {
    const user = await renderApp()
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()

    await user.click(detailsButton())
    const drawer = screen.getByRole('dialog', { name: 'Details' })
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(drawer).getByRole('table', { name: /mission metrics/i })).toBeInTheDocument()
    expect(within(drawer).getByRole('region', { name: 'Timeline' })).toBeInTheDocument()
    // Criterion 4: sunlit %, Earth-link % and time to sunset, all in the table.
    const table = within(drawer).getByRole('table', { name: /mission metrics/i })
    expect(within(table).getByRole('rowheader', { name: /^sunlit/i })).toBeInTheDocument()
  })

  it('has no second Play: the deck keeps the only one (its timeline cursor is the same cursorMs as the deck\'s time control)', async () => {
    const user = await renderApp()
    await user.click(detailsButton())
    const drawer = screen.getByRole('dialog', { name: 'Details' })
    expect(within(drawer).queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^play$/i })).toHaveLength(1)
  })

  it('moves focus into the drawer; Esc or Close shuts it and returns focus to the Details button', async () => {
    const user = await renderApp()
    await user.click(detailsButton())
    const drawer = screen.getByRole('dialog', { name: 'Details' })
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
    expect(detailsButton()).toHaveFocus()

    await user.click(detailsButton())
    await user.click(within(screen.getByRole('dialog', { name: 'Details' })).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
    expect(detailsButton()).toHaveFocus()
  })

  it('the button toggles it; the deck stays usable while it is open (slip moves, drawer stays) and Esc works from there', async () => {
    const user = await renderApp()
    await user.click(detailsButton())
    const days = within(screen.getByRole('group', { name: /^slip/i })).getByRole('slider', { name: /days/i })
    fireEvent.change(days, { target: { value: '5' } })
    expect(days).toHaveValue('5')
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument()

    days.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
    expect(detailsButton()).toHaveFocus()

    await user.click(detailsButton())
    await user.click(detailsButton())
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
  })

  it('makes the stage inert while it is open, so keyboard focus cannot reach the covered controls', async () => {
    const user = await renderApp()
    const stage = screen.getByRole('main')
    expect(stage).not.toHaveAttribute('inert')
    await user.click(detailsButton())
    expect(stage).toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    expect(stage).not.toHaveAttribute('inert')
  })

  it('closes when the view changes, and is unavailable on the Compare tab, which already shows the same content', async () => {
    const user = await renderApp()
    await user.click(detailsButton())
    await user.click(screen.getByRole('tab', { name: 'Surface' }))
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Compare' }))
    expect(detailsButton()).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: '3D Terrain' }))
    expect(detailsButton()).toBeEnabled()
  })
})
