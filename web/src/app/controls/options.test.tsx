import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { ScenarioProvider, createInitialState, scenarioReducer, useScenario } from '../state'
import { Options } from './options'

afterEach(cleanup)

/** Options alone, with a probe that prints the scenario's option values. */
function renderOptions(withCustomSite = false) {
  let state = createInitialState({ sites: fixtureSitesFile.sites })
  if (withCustomSite) {
    state = scenarioReducer(state, { type: 'addCustomSite', latDeg: -89.97, lonDeg: 30, cell: { ix: 4, iy: 4, snapDistKm: 0.6 } })
  }
  function Probe() {
    const { observerHeightM, sunThreshold, earthMarginDeg } = useScenario()
    return <p data-testid="probe">{JSON.stringify({ observerHeightM, sunThreshold, earthMarginDeg })}</p>
  }
  render(
    <ScenarioProvider initialState={state}>
      <Options />
      <Probe />
    </ScenarioProvider>,
  )
  const probe = () => JSON.parse(screen.getByTestId('probe').textContent ?? '{}')
  const group = screen.getByRole('group', { name: /^options/i })
  return { group, probe }
}

describe('Options', () => {
  it('sets the observer height (2 m by default)', async () => {
    const { group, probe } = renderOptions()
    const height = within(group).getByRole('radiogroup', { name: /observer height/i })
    expect(within(height).getByRole('radio', { name: '2 m' })).toBeChecked()
    await userEvent.click(within(height).getByRole('radio', { name: '10 m' }))
    expect(probe().observerHeightM).toBe(10)
    expect(within(height).getByRole('radio', { name: '10 m' })).toBeChecked()
  })

  it('does not warn about custom sites at 10 m when the scenario has none', async () => {
    const { group } = renderOptions()
    await userEvent.click(within(group).getByRole('radio', { name: '10 m' }))
    expect(within(group).queryByText(/custom sites still use/i)).toBeNull()
  })

  it('says custom (grid) sites stay at 2 m, and stresses it when one is in the scenario at 10 m', async () => {
    const { group } = renderOptions(true)
    expect(within(group).getByText(/custom.*grid.*2 m only/i)).toBeInTheDocument()
    await userEvent.click(within(group).getByRole('radio', { name: '10 m' }))
    expect(within(group).getByText(/custom sites still use 2 m/i)).toBeInTheDocument()
  })

  it('sets the Sun threshold as a visible-disk fraction (0–1)', () => {
    const { group, probe } = renderOptions()
    const slider = within(group).getByRole('slider', { name: /sun threshold/i })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveValue('0.5')
    fireEvent.change(slider, { target: { value: '0.7' } })
    expect(probe().sunThreshold).toBe(0.7)
    expect(within(group).getByText('0.70')).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/70 % of the Sun.s disk/i))
  })

  it('sets the Earth margin in degrees (0–10)', () => {
    const { group, probe } = renderOptions()
    const slider = within(group).getByRole('slider', { name: /earth margin/i })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '10')
    expect(slider).toHaveValue('1')
    fireEvent.change(slider, { target: { value: '2.5' } })
    expect(probe().earthMarginDeg).toBe(2.5)
    expect(within(group).getByText('2.5°')).toBeInTheDocument()
  })

  it('drives the engine: the metric cards follow the options', async () => {
    render(<App dataSources={{ source: fixtureDataSource() }} />)
    const group = await screen.findByRole('group', { name: /^options/i })
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
    fireEvent.change(within(group).getByRole('slider', { name: /earth margin/i }), { target: { value: '3' } })
    fireEvent.change(within(group).getByRole('slider', { name: /sun threshold/i }), { target: { value: '0.8' } })
    await userEvent.click(within(group).getByRole('radio', { name: '10 m' }))
    const assumptions = screen.getByText(/sunlit: at least/i) // the metric cards' assumptions line
    expect(assumptions).toHaveTextContent(/geometric DTE.*3\.0°/)
    expect(assumptions).toHaveTextContent(/80 % of the Sun disk/)
    expect(screen.getAllByRole('columnheader', { name: /fixture/i })[0]).toHaveTextContent(/observer 10 m/)
  })
})
