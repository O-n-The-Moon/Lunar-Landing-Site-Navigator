import { cleanup, render, screen, within } from '@testing-library/react'
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

  it('has no second Play or time control: the deck keeps the only ones', async () => {
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

  it('the button toggles it, and the deck stays usable while it is open', async () => {
    const user = await renderApp()
    await user.click(detailsButton())
    expect(screen.getByRole('group', { name: /^slip/i })).toBeVisible()
    await user.click(detailsButton())
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
  })
})
