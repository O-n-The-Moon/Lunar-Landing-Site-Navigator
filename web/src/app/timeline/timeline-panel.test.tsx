import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEphemeris, fixtureSitesFile } from '../../engine/__fixtures__'
import { App } from '../app'
import { fixtureDataSource } from '../data'
import { createInitialState, scenarioReducer, type ScenarioAction } from '../state'
import { computeScenarioResults } from '../use-scenario-results'
import { cursorReadout } from './cursor-readout'
import { shiftWindows } from './ghost'
import { timeScale } from './scales'
import { STRIP_VIEW_W, eventTexts } from './timeline-strip'

afterEach(cleanup)

const H_MS = 3_600_000

/** The App on fixture data with a 1-day mission (the fixture ephemeris covers 48 h). */
async function renderPanel() {
  render(<App dataSources={{ source: fixtureDataSource() }} />)
  const panel = await screen.findByRole('region', { name: 'Timeline' })
  fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '1' } })
  const fine = within(screen.getByRole('group', { name: /^slip/i })).getByRole('slider', { name: /fine/i })
  return { panel, fine }
}

/** What the engine gives for the default fixture scenario, 1-day mission, at a slip. */
function expected(slipH: number) {
  const actions: ScenarioAction[] = [
    { type: 'setDuration', durationH: 24 },
    { type: 'setSlip', slipH },
  ]
  const s = actions.reduce(scenarioReducer, createInitialState({ sites: fixtureSitesFile.sites }))
  return { state: s, results: computeScenarioResults(s, { ephemeris: fixtureEphemeris, sitesFile: fixtureSitesFile }) }
}

const rects = (root: Element, attr: string, band: string) =>
  [...root.querySelectorAll(`[${attr}="${band}"]`)].map((r) => ({ x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')) }))
const total = (rs: { w: number }[]) => rs.reduce((a, r) => a + r.w, 0)

describe('TimelinePanel', () => {
  it('has one cursor slider for all strips, and moving it moves every strip’s readouts', async () => {
    const { panel } = await renderPanel()
    const strips = within(panel).getAllByRole('figure')
    // ≥ 2 strips, or "shared across strips" proves nothing.
    expect(strips.length).toBeGreaterThanOrEqual(2)
    const sliders = within(panel).getAllByRole('slider')
    expect(sliders).toHaveLength(1)
    expect(panel.querySelectorAll('[data-cursor-line]')).toHaveLength(1)

    const before = Number(sliders[0].getAttribute('aria-valuenow'))
    fireEvent.keyDown(sliders[0], { key: 'ArrowRight' })
    expect(Number(within(panel).getByRole('slider').getAttribute('aria-valuenow'))).toBe(before + H_MS)
    // The cursor line is one element over the plot column, so it sits at the same fraction in every strip.
    expect(panel.querySelector('[data-cursor-line]')).toHaveStyle({ left: `${(1 / 24) * 100}%` })
    // And every strip's readouts are for that one time.
    const { state, results } = expected(0)
    results.sites.forEach((site, i) => {
      const { sunText, earthText } = eventTexts(site.slipped.windows, state.landingMs + H_MS)
      expect(strips[i]).toHaveTextContent(sunText)
      expect(strips[i]).toHaveTextContent(earthText)
    })
  })

  it('shows each site’s Sun elevation and clearance at the shared cursor, matching the engine', async () => {
    const { panel } = await renderPanel()
    fireEvent.keyDown(within(panel).getByRole('slider'), { key: 'ArrowRight' })
    fireEvent.keyDown(within(panel).getByRole('slider'), { key: 'ArrowRight' })
    const { state, results } = expected(0)
    const cursorMs = state.landingMs + 2 * H_MS
    const strips = within(panel).getAllByRole('figure')
    results.sites.forEach((site, i) => {
      const r = cursorReadout(site.ctx, cursorMs)
      const text = strips[i].textContent ?? ''
      expect(text).toContain(`Sun elev ${r.sunElevDeg.toFixed(1)}°`)
      expect(text).toMatch(/clearance [+−]\d+\.\d°/)
    })
  })

  it('draws no baseline ghost at slip 0', async () => {
    const { panel } = await renderPanel()
    expect(panel.querySelectorAll('[data-ghost]')).toHaveLength(0)
    expect(within(panel).queryByText(/unslipped baseline/i)).toBeNull()
  })

  it('draws each site’s unslipped baseline faintly under its bands once slipped, and loses sunlit time visibly', async () => {
    const { panel, fine } = await renderPanel()
    fireEvent.change(fine, { target: { value: '12' } })
    const { state, results } = expected(12)
    expect(within(panel).getByText(/unslipped baseline/i)).toBeInTheDocument()

    const range = { startMs: results.slippedLandingMs, endMs: results.slippedLandingMs + 24 * H_MS }
    const scale = timeScale(range, { x0: 0, x1: STRIP_VIEW_W })
    const strips = within(panel).getAllByRole('figure')
    expect(strips).toHaveLength(results.sites.length)
    results.sites.forEach((site, i) => {
      const shifted = shiftWindows(site.baseline.windows, results.slippedLandingMs - state.landingMs)
      for (const band of ['sun', 'earth', 'both'] as const) {
        const want = shifted[band]
          .filter((w) => w.endMs > range.startMs && w.startMs < range.endMs)
          .map((w) => ({ x: scale.x(Math.max(w.startMs, range.startMs)), x1: scale.x(Math.min(w.endMs, range.endMs)) }))
        const got = rects(strips[i], 'data-ghost', band)
        expect(got).toHaveLength(want.length)
        got.forEach((g, k) => {
          expect(Math.abs(g.x - want[k].x)).toBeLessThanOrEqual(1)
          expect(Math.abs(g.x + g.w - want[k].x1)).toBeLessThanOrEqual(1)
        })
      }
    })
    // Slipping +12 h loses sunlight at the first site: more ghost than real sun, i.e. visible faint-only stretches.
    expect(results.sites[0].delta!.sunlitPct).toBeLessThan(-0.05)
    expect(total(rects(strips[0], 'data-ghost', 'sun'))).toBeGreaterThan(total(rects(strips[0], 'data-band', 'sun')))
  })

  it('removes the ghost again when the slip is reset', async () => {
    const { panel, fine } = await renderPanel()
    fireEvent.change(fine, { target: { value: '12' } })
    expect(panel.querySelectorAll('[data-ghost]').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(panel.querySelectorAll('[data-ghost]')).toHaveLength(0)
  })

  it('keeps the cursor at the same mission-elapsed time when the slip changes', async () => {
    const { panel, fine } = await renderPanel()
    fireEvent.keyDown(within(panel).getByRole('slider'), { key: 'ArrowRight' })
    fireEvent.change(fine, { target: { value: '12' } })
    const { results } = expected(12)
    expect(Number(within(panel).getByRole('slider').getAttribute('aria-valuenow'))).toBe(results.slippedLandingMs + H_MS)
  })

  it('says what the cursor reads for screen readers, for every site', async () => {
    const { panel } = await renderPanel()
    const text = within(panel).getByRole('slider').getAttribute('aria-valuetext') ?? ''
    expect(text).toContain('2026-03-01 00:00 UTC')
    for (const s of fixtureSitesFile.sites.slice(0, 2)) expect(text).toContain(s.name)
    expect(text).toMatch(/(Sunset|Sunrise|No sunset|No sunrise)/)
  })
})
