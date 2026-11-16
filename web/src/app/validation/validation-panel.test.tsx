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
    expect(fmtErr(0.00004999)).toBe('0.000050°')
    expect(fmtErr(0.0035)).toBe('0.0035°')
    expect(fmtErr(0.01)).toBe('0.0100°')
    expect(fmtErr(0)).toBe('0.0000°')
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
    expect(badgeParts(eph).slice(0, 2)).toEqual(['Ephemeris vs JPL Horizons', 'max 0.0100° az · 0.0060° el (n = 8)'])
    expect(badgeParts(pgda).slice(0, 2)).toEqual(['Terrain vs PGDA', '1/2 sites within ±5 pp'])
  })

  it('shows a pass/fail verdict per badge against the targets in the file, with the target stated', () => {
    renderReport()
    const [eph, pgda] = badges()
    expect(badgeParts(eph)[2]).toBe('Pass: target ≤ 0.02°')
    expect(eph).toHaveClass('good')
    expect(badgeParts(pgda)[2]).toBe('Not met: target ≥ 80% of sites')
    expect(pgda).toHaveClass('warn')
  })

  it('states the claim label next to the PGDA numbers, in the badge and in the section', () => {
    renderReport()
    const label = fixturePgda.method!.claimLabel
    expect(badgeParts(badges()[1])).toContain(label)
    expect(within(screen.getByRole('region', { name: /pgda method/i })).getByText(label)).toBeInTheDocument()
  })

  it('shows the PGDA method from the file: height as an assumption, sensitivity heights and definitions', () => {
    renderReport()
    const method = screen.getByRole('region', { name: /pgda method/i })
    const def = (term: string) => within(method).getByText(term, { selector: 'dt' }).nextElementSibling
    expect(def('Observer height')).toHaveTextContent('0 m (assumption, see limits)')
    expect(def('Sensitivity runs')).toHaveTextContent('2 m, 10 m')
    expect(def('Sun')).toHaveTextContent(fixturePgda.method!.sunDefinition)
    expect(def('Earth')).toHaveTextContent(fixturePgda.method!.earthDefinition)
    expect(def('PGDA product 69')).toHaveTextContent(fixturePgda.method!.pgdaDefinition)
    expect(def('Sampling')).toHaveTextContent(fixturePgda.method!.sampling)
    expect(def('Limits')).toHaveTextContent(fixturePgda.method!.notes)
  })

  it('fails the Horizons verdict when either max error exceeds the target, and passes exactly at it', () => {
    const horizons = fixtureValidation.horizons!
    const withMax = (maxAzErrDeg: number, maxElevErrDeg: number): ValidationFile => ({
      ...fixtureValidation,
      horizons: { ...horizons, summary: { ...horizons.summary, maxAzErrDeg, maxElevErrDeg } },
    })
    renderReport(withMax(0.02, 0.02))
    expect(badges()[0]).toHaveClass('good')
    cleanup()
    renderReport(withMax(0.0100, 0.0201))
    expect(badgeParts(badges()[0])[2]).toBe('Not met: target ≤ 0.02°')
    expect(badges()[0]).toHaveClass('warn')
  })

  it('passes the PGDA verdict when the share of sites reaches the target', () => {
    renderReport(withPgda(fixturePgda.rows, { sitesWithinThreshold: 4, sitesTotal: 5, targetFractionWithin: 0.8 }))
    expect(badgeParts(badges()[1])[2]).toBe('Pass: target ≥ 80% of sites')
    expect(badges()[1]).toHaveClass('good')
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

  it('keeps the badge neutral and gives no verdict for an empty PGDA comparison', () => {
    renderReport(withPgda([]))
    expect(badges()[1]).toHaveAttribute('class', 'validation-badge')
    expect(badgeParts(badges()[1])).not.toContainEqual(expect.stringMatching(/^(Pass|Not met)/))
  })

  describe('older validation.json without targets or method', () => {
    const hzSummary = { ...fixtureValidation.horizons!.summary }
    delete hzSummary.targetMaxErrDeg
    const pgdaSummary = { ...fixturePgda.summary }
    delete pgdaSummary.targetFractionWithin
    const older: ValidationFile = {
      schemaVersion: 1,
      horizons: { ...fixtureValidation.horizons!, summary: hzSummary },
      pgda: { rows: fixturePgda.rows, summary: pgdaSummary },
    }

    it('renders the numbers without a verdict, a target or a method section', () => {
      renderReport(older)
      expect(badges().map(badgeParts)).toEqual([
        ['Ephemeris vs JPL Horizons', 'max 0.0100° az · 0.0060° el (n = 8)'],
        ['Terrain vs PGDA', '1/2 sites within ±5 pp'],
      ])
      expect(screen.queryByRole('region', { name: /pgda method/i })).not.toBeInTheDocument()
      expect(screen.getByText(/method is not recorded in validation\.json/i)).toBeInTheDocument()
    })

    it('also tolerates an explicit null method', () => {
      renderReport({ ...older, pgda: { ...older.pgda!, method: null } })
      expect(screen.queryByRole('region', { name: /pgda method/i })).not.toBeInTheDocument()
    })

    it('shows an unknown observer height as unknown, not as 0 m', () => {
      const method = { ...fixturePgda.method!, observerHeightM: null }
      renderReport({ ...fixtureValidation, pgda: { ...fixturePgda, method } })
      const region = screen.getByRole('region', { name: /pgda method/i })
      expect(within(region).getByText('Observer height', { selector: 'dt' }).nextElementSibling).toHaveTextContent('unknown')
    })
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
