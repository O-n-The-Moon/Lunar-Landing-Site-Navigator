import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app'
import { fixtureDataSource, type DataSource } from '../data'

afterEach(cleanup)

async function renderApp(source: DataSource = fixtureDataSource()) {
  render(<App dataSources={{ source }} />)
  await screen.findByRole('tab', { name: '3D Terrain' })
}

const rail = () => screen.getByRole('complementary', { name: 'Scenario' })
const railToggle = () => within(rail()).getByRole('button', { name: /scenario panel/i })

describe('console shell', () => {
  it('puts the five view tabs, the mission clock and the data chip in the top bar', async () => {
    await renderApp()
    const top = screen.getByRole('banner')
    expect(within(top).getByRole('heading', { level: 1, name: 'Lunar Landing Site Navigator' })).toBeInTheDocument()
    expect(within(top).getAllByRole('tab')).toHaveLength(5)
    // The cursor starts at the (unslipped) landing: 2026-03-01 00:00 UTC on fixtures.
    expect(within(top).getByText('L+0d 00h · 1 Mar 2026 00:00 UTC')).toHaveAttribute('datetime', '2026-03-01T00:00:00.000Z')
    expect(within(top).getByText(/synthetic fixture data, not real lunar data/i)).toBeInTheDocument()
    expect(within(top).queryByText(/LOLA terrain/)).not.toBeInTheDocument()
  })

  it('names the real data sources when the app runs on real data', async () => {
    await renderApp({ ...fixtureDataSource(), kind: 'data' })
    expect(within(screen.getByRole('banner')).getByText('LOLA terrain · SPICE ephemeris')).toBeInTheDocument()
    expect(screen.queryByText(/synthetic fixture data/i)).not.toBeInTheDocument()
  })

  it('the clock follows the time cursor', async () => {
    const user = userEvent.setup()
    await renderApp()
    // The fixture ephemeris covers 48 h: a 1-day mission fits, so the timeline (and its cursor) renders.
    const duration = screen.getByLabelText('Duration (days)')
    await user.clear(duration)
    await user.type(duration, '1')
    await user.click(screen.getByRole('tab', { name: 'Compare' }))
    const scrub = await within(screen.getByRole('region', { name: 'Timeline' })).findByRole('slider')
    scrub.focus()
    await user.keyboard('{End}')
    expect(within(screen.getByRole('banner')).getByText(/^L\+/)).toHaveTextContent('L+1d 00h · 2 Mar 2026 00:00 UTC')
  })
})

describe('scenario rail', () => {
  it('starts open and folds with its chevron; the controls keep their state while folded', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(railToggle()).toHaveAttribute('aria-expanded', 'true')
    const duration = screen.getByLabelText('Duration (days)')
    await user.clear(duration)
    await user.type(duration, '3')

    await user.click(railToggle())
    expect(railToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(railToggle()).toHaveAccessibleName('Show scenario panel')
    expect(screen.getByLabelText('Duration (days)')).not.toBeVisible() // still mounted, but hidden
    expect(rail()).toBeInTheDocument() // the folded strip still names itself

    await user.click(railToggle())
    expect(screen.getByLabelText('Duration (days)')).toHaveValue(3)
  })

  it('toggles with [ but not while typing in a field', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByLabelText('Duration (days)'))
    await user.keyboard('[[')
    expect(railToggle()).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('tab', { name: 'Validation' }))
    await user.keyboard('[[')
    expect(railToggle()).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('[[')
    expect(railToggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('has a top-bar menu button (the narrow-screen drawer) that drives the same rail', async () => {
    const user = userEvent.setup()
    await renderApp()
    const menu = screen.getByRole('button', { name: 'Scenario menu' })
    expect(menu).toHaveAttribute('aria-controls', railToggle().getAttribute('aria-controls'))
    await user.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(railToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts closed on a narrow screen, where it is a drawer over the stage', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 768px)' }))
    try {
      await renderApp()
      expect(screen.getByRole('button', { name: 'Scenario menu' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByLabelText('Duration (days)')).not.toBeVisible()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
