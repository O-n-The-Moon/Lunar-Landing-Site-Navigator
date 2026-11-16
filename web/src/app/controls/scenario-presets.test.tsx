import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource, type DataSource } from '../data'
import { DEMO_SCENARIOS } from './demo-scenarios'

afterEach(cleanup)

/** Fixture data whose catalog also has the demo scenarios' sites (clones of a fixture site; the engine data stays 48 h). */
function sourceWithDemoSites(): DataSource {
  const base = fixtureDataSource()
  const ids = [...new Set(DEMO_SCENARIOS.flatMap((s) => s.siteIds))]
  return {
    ...base,
    async loadCore() {
      const core = await base.loadCore()
      const clones = ids.map((id) => ({ ...fixtureSitesFile.sites[0], id, name: `Demo ${id}` }))
      return { ...core, sitesFile: { ...core.sitesFile, sites: [...core.sitesFile.sites, ...clones] } }
    },
  }
}

const renderApp = async (source: DataSource) => {
  render(<App dataSources={{ source }} />)
  await screen.findByRole('heading', { name: 'Scenario' })
}
const railToggle = () => screen.getByRole('button', { name: /scenario panel/i })
const deckSites = () => within(screen.getByRole('list', { name: 'Site numbers' }))

describe('demo scenario presets', () => {
  it('are not offered when the catalog lacks their sites (fixture data)', async () => {
    await renderApp(fixtureDataSource())
    expect(screen.queryByRole('group', { name: 'Demo scenarios' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^try/i })).not.toBeInTheDocument()
  })

  it('load a preset’s sites and landing, fold the rail, then "Try" applies the story’s slip', async () => {
    const user = userEvent.setup()
    await renderApp(sourceWithDemoSites())
    const group = screen.getByRole('group', { name: 'Demo scenarios' })
    expect(within(group).getAllByRole('button')).toHaveLength(DEMO_SCENARIOS.length)
    expect(railToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /^try/i })).not.toBeInTheDocument()

    await user.click(within(group).getByRole('button', { name: /athena vs ridge/i }))
    expect(railToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(deckSites().getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Demo mons-mouton-im2'),
      expect.stringContaining('Demo connecting-ridge'),
    ])
    // The folded rail is hidden from assistive tech, so look for its button with `hidden`.
    expect(within(group).getByRole('button', { name: /athena vs ridge/i, hidden: true })).toHaveAttribute('aria-pressed', 'true')

    const days = screen.getByRole('slider', { name: /days/i })
    expect(days).toHaveValue('0')
    const tryButton = screen.getByRole('button', { name: 'Try +15 d' })
    await user.click(tryButton)
    expect(days).toHaveValue('15')
    expect(tryButton).toBeDisabled()
    // Back at the baseline, Try is available again.
    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(days).toHaveValue('0')
    expect(screen.getByRole('button', { name: 'Try +15 d' })).toBeEnabled()
  })

  it('stop being the active preset (no Try) once the user changes the mission', async () => {
    const user = userEvent.setup()
    await renderApp(sourceWithDemoSites())
    await user.click(screen.getByRole('button', { name: /athena goes dark/i }))
    expect(screen.getByRole('button', { name: 'Try +14 d' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '7' } })
    expect(screen.queryByRole('button', { name: /^try/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /athena goes dark/i, hidden: true })).toHaveAttribute('aria-pressed', 'false')
  })
})
