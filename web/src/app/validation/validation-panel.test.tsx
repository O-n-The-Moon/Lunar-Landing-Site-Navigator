import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PgdaValidation, PgdaValidationRow, ValidationFile } from '../../engine'
import { fixtureEphemerisManifest, fixtureSitesFile, fixtureValidation } from '../../engine/__fixtures__'
import { ValidationReport, fmtAngle, fmtErr, fmtPp } from './validation-panel'

afterEach(cleanup)

const renderReport = (validation: ValidationFile = fixtureValidation) =>
  render(<ValidationReport validation={validation} sitesFile={fixtureSitesFile} ephemerisManifest={fixtureEphemerisManifest} />)

const badges = () => within(screen.getByRole('list', { name: /validation summary/i })).getAllByRole('listitem')
const badgeParts = (li: HTMLElement) => Array.from(li.children).map((c) => c.textContent)
const tableRows = (name: RegExp) => within(screen.getByRole('region', { name })).getAllByRole('row').slice(1)
const cellTexts = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
const definition = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling

const fixturePgda = fixtureValidation.pgda!
const pgdaRow = (over: Partial<PgdaValidationRow>): PgdaValidationRow => ({ ...fixturePgda.rows[0], ...over })
const withPgda = (rows: PgdaValidationRow[], summary: Partial<PgdaValidation['summary']> = {}): ValidationFile => ({
  ...fixtureValidation,
  pgda: { rows, summary: { ...fixturePgda.summary, sitesWithinThreshold: rows.length, sitesTotal: rows.length, ...summary } },
})

describe('formatting', () => {
  it('never shows a small non-zero error as zero', () => {
    expect(fmtErr(0.00001)).toBe('0.000010°')
    expect(fmtErr(0.0035)).toBe('0.0035°')
    expect(fmtErr(0.01)).toBe('0.010°')
    expect(fmtErr(0)).toBe('0°')
  })

  it('uses one minus sign and never prints -0', () => {
    expect(fmtAngle(-0.287)).toBe('−0.2870°')
    expect(fmtAngle(-0.00001)).toBe('0.0000°')
    expect(fmtPp(-0.04, 5)).toBe('0.0 pp')
    expect(fmtPp(0.04, 5)).toBe('0.0 pp')
    expect(fmtPp(-6.8, 5)).toBe('−6.8 pp')
    expect(fmtPp(1.5, 5)).toBe('+1.5 pp')
  })

  it('adds decimals so a value near the threshold never displays as the threshold', () => {
    expect(fmtPp(5.04, 5)).toBe('+5.04 pp')
    expect(fmtPp(4.96, 5)).toBe('+4.96 pp')
    expect(fmtPp(4.9999, 5)).toBe('+4.9999 pp')
    expect(fmtPp(5, 5)).toBe('+5.0 pp')
    expect(fmtPp(-5.04, 5, false)).toBe('−5.04 pp')
  })
})

describe('ValidationReport (fixture validation.json)', () => {
  it('shows summary badges read from the file', () => {
    renderReport()
    const [eph, pgda] = badges()
    expect(badgeParts(eph)).toEqual(['Ephemeris vs JPL Horizons', 'max 0.010° az · 0.0060° el (n = 8)'])
    expect(badgeParts(pgda)).toEqual(['Terrain vs PGDA', '1/2 sites within ±5 pp'])
    expect(pgda).toHaveClass('warn')
  })

  it('renders one Horizons row per comparison with site names, epochs and errors', () => {
    renderReport()
    const rows = tableRows(/horizons comparison/i)
    expect(rows).toHaveLength(8)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('Fixture Plateau (synthetic)')
    expect(cellTexts(rows[0])).toEqual(['2026-03-01 06:00:00', 'Sun', '76.9111° / 2.3859°', '76.9131° / 2.3849°', '0.0020°', '0.0010°'])
    expect(cellTexts(rows[5])).toEqual(['2026-03-01 06:00:00', 'Earth', '139.9476° / −0.2870°', '139.9566° / −0.2910°', '0.0090°', '0.0040°'])
  })

  it('renders the PGDA table, flags the outlier without relying on colour, and lists its explanation', () => {
    renderReport()
    const [plateau, ridge] = tableRows(/pgda comparison/i)
    expect(within(plateau).getByRole('rowheader')).toHaveTextContent('Fixture Plateau (synthetic)')
    expect(within(plateau).getByRole('rowheader')).not.toHaveTextContent(/outlier/i)
    expect(cellTexts(plateau)).toEqual(['60.4%', '58.0%', '+2.4 pp', '62.9%', '64.0%', '−1.1 pp'])

    expect(within(ridge).getByRole('rowheader')).toHaveTextContent('Fixture Ridge (synthetic) outlier')
    expect(cellTexts(ridge)).toEqual(['74.2%', '81.0%', '−6.8 pp ▲ (beyond ±5 pp)', '43.5%', '42.0%', '+1.5 pp'])

    const outliers = within(screen.getByRole('list', { name: /outliers/i })).getAllByRole('listitem')
    expect(outliers.map((li) => li.textContent)).toEqual([`Fixture Ridge (synthetic): ${fixturePgda.rows[1].explanation}`])
    expect(screen.queryByText(/inconsistent/i)).not.toBeInTheDocument()
  })

  it('lists the methods: frame, kernels, DEMs and definitions with their defaults', () => {
    renderReport()
    expect(definition('Frame')).toHaveTextContent(/^MOON_ME \(mean Earth/)
    expect(definition('Ephemeris')).toHaveTextContent('NAIF SPICE kernels: synthetic-fixture. Aberration correction LT+S.')
    expect(definition('Terrain')).toHaveTextContent(/LDEM_80S_80M.*every 0\.5° of azimuth for observers 2 m, 10 m above the surface; 2 m by default/)
    expect(definition('Sun visibility')).toHaveTextContent(/reaches 55% and stays sunlit until it drops to 45% \(threshold 50% ± 5% hysteresis\)/)
    expect(definition('Earth link')).toHaveTextContent(/^Geometric DTE: Earth center elevation ≥ terrain horizon \+ 1° margin, with ±0\.1° hysteresis/)
    expect(definition('Horizons check')).toHaveTextContent(/does not test terrain/)
  })
})

describe('ValidationReport edge cases', () => {
  it('says when a section has not been produced yet instead of showing numbers', () => {
    renderReport({ schemaVersion: 1, horizons: null, pgda: null })
    expect(badges().map(badgeParts)).toEqual([
      ['Ephemeris vs JPL Horizons', 'not yet produced'],
      ['Terrain vs PGDA', 'not yet produced'],
    ])
    expect(badges()[1]).toHaveAttribute('class', 'validation-badge')
    expect(screen.getByText(/no horizons comparison/i)).toBeInTheDocument()
    expect(screen.getByText(/no pgda comparison/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a good badge and "None." when every site is within the threshold, including exactly at it', () => {
    renderReport(withPgda([pgdaRow({ siteId: 'fixture-plateau', sunDiffPp: 5, earthDiffPp: -5 })]))
    expect(badges()[1]).toHaveClass('good')
    expect(screen.getByText('None.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /outliers/i })).not.toBeInTheDocument()
    expect(cellTexts(tableRows(/pgda comparison/i)[0])).toContain('+5.0 pp')
  })

  it('keeps the badge neutral for an empty PGDA comparison', () => {
    renderReport(withPgda([]))
    expect(badges()[1]).toHaveAttribute('class', 'validation-badge')
  })

  it('warns when the file summary disagrees with its rows', () => {
    renderReport(withPgda(fixturePgda.rows, { sitesWithinThreshold: 2, sitesTotal: 2 }))
    expect(screen.getByText(/validation\.json is inconsistent/i)).toHaveTextContent('summary says 2/2 sites are within ±5 pp, but its rows give 1/2')
  })

  it('reports an outlier with a missing explanation and falls back to the site id for unknown sites', () => {
    renderReport(withPgda([pgdaRow({ siteId: 'unknown-site', sunDiffPp: 9, explanation: null })], { sitesWithinThreshold: 0 }))
    expect(screen.getByText(/no explanation in validation\.json/i)).toBeInTheDocument()
    expect(within(tableRows(/pgda comparison/i)[0]).getByRole('rowheader')).toHaveTextContent('unknown-site')
  })

  it('does not crash on an invalid epoch', () => {
    const horizons = fixtureValidation.horizons!
    renderReport({ ...fixtureValidation, horizons: { ...horizons, rows: [{ ...horizons.rows[0], tUtcMs: Number.NaN }] } })
    expect(cellTexts(tableRows(/horizons comparison/i)[0])[0]).toBe('invalid time')
  })
})
