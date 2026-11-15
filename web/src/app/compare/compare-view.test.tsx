import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { createInitialState, scenarioReducer, type ScenarioAction } from '../state'
import { computeScenarioResults } from '../use-scenario-results'

afterEach(cleanup)

/** What the engine gives for the App's default scenario with a 1-day mission and the given slip. */
function expected(slipH: number) {
  const actions: ScenarioAction[] = [
    { type: 'setDuration', durationH: 24 },
    { type: 'setSlip', slipH },
  ]
  const s = actions.reduce(scenarioReducer, createInitialState({ sites: fixtureSitesFile.sites }))
  const [plateau] = computeScenarioResults(s, { ephemeris: fixtureEphemeris, sitesFile: fixtureSitesFile }).sites
  return plateau
}

/** The App on fixture data with a 1-day mission (the fixture ephemeris covers 48 h). */
async function renderCompare() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  const compare = await screen.findByRole('region', { name: 'Compare' })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  const slip = screen.getByRole('group', { name: /^slip/i })
  return {
    table: () => within(compare).getByRole('table', { name: /mission metrics/i }),
    days: within(slip).getByRole('slider', { name: /days/i }),
    fine: within(slip).getByRole('slider', { name: /fine/i }),
    reset: within(slip).getByRole('button', { name: /reset/i }),
  }
}

/** The "Sunlit" cell of the first site (the plateau). */
const plateauSunlit = (table: HTMLElement) => within(table).getByRole('rowheader', { name: /^sunlit/i }).closest('tr')!.children[1]

describe('CompareView with the slip slider', () => {
  it('shows each metric with a Δ vs the baseline once the slip is moved, and hides it at slip 0', async () => {
    const { table, fine, reset } = await renderCompare()
    const atZero = expected(0)
    expect(plateauSunlit(table())).toHaveTextContent(`${atZero.baseline.metrics.sunlitPct.toFixed(1)} %`)
    expect(table().querySelectorAll('.delta')).toHaveLength(0)

    fireEvent.change(fine, { target: { value: '12' } })
    const { slipped, delta } = expected(12)
    const cell = plateauSunlit(table())
    expect(cell).toHaveTextContent(`${slipped.metrics.sunlitPct.toFixed(1)} %`)
    expect(delta!.sunlitPct).toBeLessThan(-0.05) // the fixture loses sunlight at +12 h
    expect(cell).toHaveTextContent(`−${Math.abs(delta!.sunlitPct).toFixed(1)} pp`)
    expect(cell.querySelector('.delta')).toHaveClass('worse')
    // Every metric row gets a Δ (slope doesn't depend on the date).
    expect(table().querySelectorAll('.delta').length).toBeGreaterThanOrEqual(8)
    expect(within(table()).getByText(/mission metrics/i)).toHaveTextContent(/slip \+12 h/)

    fireEvent.click(reset)
    expect(plateauSunlit(table())).toHaveTextContent(`${atZero.baseline.metrics.sunlitPct.toFixed(1)} %`)
    expect(table().querySelectorAll('.delta')).toHaveLength(0)
  })

  it('shows sites whose slipped mission leaves the ephemeris as unavailable, not as stale numbers', async () => {
    const { table, days } = await renderCompare()
    fireEvent.change(days, { target: { value: '2' } })
    expect(plateauSunlit(table())).toHaveTextContent(/no data.*slipped run is outside the ephemeris/i)
  })
})
