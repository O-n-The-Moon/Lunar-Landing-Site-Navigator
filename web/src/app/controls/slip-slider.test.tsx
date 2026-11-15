import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { formatSlipH, splitSlipH } from './slip-slider'

afterEach(cleanup)

describe('splitSlipH', () => {
  it.each([
    [0, 0, 0],
    [12, 0, 12],
    [-12, 0, -12],
    [13, 1, -11],
    [36, 1, 12],
    [66, 3, -6],
    [-30, -1, -6],
    [-720, -30, 0],
    [2160, 90, 0],
  ])('%i h → %i d %i h (fine part within ±12 h)', (slipH, days, hours) => {
    expect(splitSlipH(slipH)).toEqual({ days, hours })
  })
})

describe('formatSlipH', () => {
  it.each([
    [0, '0 h'],
    [6, '+6 h'],
    [72, '+3 d'],
    [66, '+2 d 18 h'],
    [-30, '−1 d 6 h'],
    [-720, '−30 d'],
  ])('%i h → %s', (slipH, text) => {
    expect(formatSlipH(slipH)).toBe(text)
  })
})

/** The App on fixture data with a 1-day mission: the 48 h fixture ephemeris then covers slips of 0…+24 h. */
async function renderSlip() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  const group = await screen.findByRole('group', { name: /^slip/i })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  const days = within(group).getByRole('slider', { name: /days/i })
  const fine = within(group).getByRole('slider', { name: /fine/i })
  const reset = within(group).getByRole('button', { name: /reset/i })
  return { group, days, fine, reset }
}

describe('SlipSlider', () => {
  it('has a −30…+90 day slider in 1-day steps and a ±12 h fine slider, starting at the baseline', async () => {
    const { group, days, fine, reset } = await renderSlip()
    expect(days).toHaveAttribute('min', '-30')
    expect(days).toHaveAttribute('max', '90')
    expect(days).toHaveAttribute('step', '1')
    expect(days).toHaveValue('0')
    expect(fine).toHaveAttribute('min', '-12')
    expect(fine).toHaveAttribute('max', '12')
    expect(fine).toHaveAttribute('step', '1')
    expect(fine).toHaveValue('0')
    expect(group).toHaveTextContent(/no slip/i)
    expect(reset).toBeDisabled()
  })

  it('combines days and fine hours into one slip and shows the slipped landing', async () => {
    const { group, days, fine } = await renderSlip()
    fireEvent.change(days, { target: { value: '3' } })
    expect(group).toHaveTextContent('+3 d')
    expect(group).toHaveTextContent('2026-03-04 00:00 UTC')
    expect(days).toHaveAttribute('aria-valuetext', '+3 days')

    fireEvent.change(fine, { target: { value: '-6' } })
    expect(group).toHaveTextContent('+2 d 18 h')
    expect(group).toHaveTextContent('2026-03-03 18:00 UTC')
    expect(days).toHaveValue('3')
    expect(fine).toHaveValue('-6')
    expect(fine).toHaveAttribute('aria-valuetext', '−6 hours')

    // Moving the days keeps the fine offset.
    fireEvent.change(days, { target: { value: '-2' } })
    expect(group).toHaveTextContent('−2 d 6 h')
    expect(fine).toHaveValue('-6')
  })

  it('stops the fine slider at the ends of the slip range', async () => {
    const { days, fine } = await renderSlip()
    fireEvent.change(days, { target: { value: '90' } })
    expect(fine).toHaveAttribute('max', '0')
    expect(fine).toHaveAttribute('min', '-12')
    fireEvent.change(days, { target: { value: '-30' } })
    expect(fine).toHaveAttribute('min', '0')
    expect(fine).toHaveAttribute('max', '12')
  })

  it('resets to the baseline', async () => {
    const { group, days, fine, reset } = await renderSlip()
    fireEvent.change(days, { target: { value: '1' } })
    fireEvent.change(fine, { target: { value: '5' } })
    expect(reset).toBeEnabled()
    fireEvent.click(reset)
    expect(days).toHaveValue('0')
    expect(fine).toHaveValue('0')
    expect(group).toHaveTextContent(/no slip/i)
  })

  it('warns, with the covered slips, when the slipped mission leaves the ephemeris', async () => {
    const { group, days, fine } = await renderSlip()
    const warning = () => within(group).queryByText(/outside the ephemeris/i)
    fireEvent.change(fine, { target: { value: '12' } })
    expect(warning()).toBeNull()
    fireEvent.change(days, { target: { value: '1' } })
    fireEvent.change(fine, { target: { value: '0' } })
    expect(warning()).toBeNull()

    fireEvent.change(days, { target: { value: '2' } })
    expect(warning()).toHaveAttribute('role', 'status')
    expect(warning()).toHaveTextContent(/covered slips: 0 h … \+1 d/i)
    expect(group).toHaveAccessibleDescription(/outside the ephemeris/i)
  })
})
