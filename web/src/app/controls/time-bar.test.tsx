import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { HOUR_MS, ScenarioProvider, createInitialState, useScenario } from '../state'
import { TimeBar, useTimeBarController } from './time-bar'

const T0 = Date.UTC(2026, 2, 1)
const initial = { ...createInitialState({ sites: fixtureSitesFile.sites, landingMs: T0 }), durationH: 24 * 4, slipH: 30 }

function Harness({ active = true, canPlay = true }: { active?: boolean; canPlay?: boolean }) {
  const controller = useTimeBarController({ active, canPlay })
  const { cursorMs } = useScenario()
  return (
    <>
      <TimeBar controller={controller} canPlay={canPlay} />
      <output data-testid="cursor">{cursorMs}</output>
    </>
  )
}
const renderBar = (props: Parameters<typeof Harness>[0] = {}) =>
  render(
    <ScenarioProvider initialState={initial}>
      <Harness {...props} />
    </ScenarioProvider>,
  )
const cursor = () => Number(screen.getByTestId('cursor').textContent)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TimeBar', () => {
  it('scrubs the shared cursor between the slipped landing and the mission end, in whole hours', () => {
    renderBar()
    const scrub = screen.getByRole('slider', { name: 'Time in mission' })
    const landing = T0 + 30 * HOUR_MS
    expect(scrub).toHaveAttribute('min', String(landing))
    expect(scrub).toHaveAttribute('max', String(landing + 4 * 24 * HOUR_MS))
    fireEvent.change(scrub, { target: { value: String(landing + 5 * HOUR_MS) } })
    expect(cursor()).toBe(landing + 5 * HOUR_MS)
    expect(scrub).toHaveAttribute('aria-valuetext', expect.stringContaining('L+0d 05h'))
  })

  it('shows the slip as a read-only readout, not a second slip control', () => {
    renderBar()
    expect(screen.getByText('Slip +1 d 6 h')).toBeInTheDocument()
    expect(screen.getAllByRole('slider')).toHaveLength(1)
  })

  it('Play moves the cursor at the chosen speed and Pause stops it', () => {
    renderBar()
    const landing = T0 + 30 * HOUR_MS
    fireEvent.click(screen.getByRole('button', { name: '1 d/s' }))
    expect(screen.getByRole('button', { name: '1 d/s' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    for (let t = 0; t < 1000; t += 16) act(() => void vi.advanceTimersByTime(16))
    expect((cursor() - landing) / HOUR_MS).toBeGreaterThan(20)
    expect((cursor() - landing) / HOUR_MS).toBeLessThan(28)
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const stopped = cursor()
    for (let t = 0; t < 500; t += 16) act(() => void vi.advanceTimersByTime(16))
    expect(cursor()).toBe(stopped)
  })

  it('cannot play without something to see', () => {
    renderBar({ canPlay: false })
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
  })
})
