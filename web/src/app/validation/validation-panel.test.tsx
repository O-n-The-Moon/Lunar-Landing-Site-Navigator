import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEphemerisManifest, fixtureSitesFile, fixtureValidation } from '../../engine/__fixtures__'
import type { ValidationFile } from '../../engine'
import { ValidationReport } from './validation-panel'

afterEach(cleanup)

const renderReport = (validation: ValidationFile = fixtureValidation) =>
  render(<ValidationReport validation={validation} sitesFile={fixtureSitesFile} ephemerisManifest={fixtureEphemerisManifest} />)

const siteName = (id: string) => fixtureSitesFile.sites.find((s) => s.id === id)!.name
const table = (name: RegExp) => within(screen.getByRole('region', { name })).getByRole('table')

describe('ValidationReport (fixture validation.json)', () => {
  it('shows summary badges read from the file', () => {
    renderReport()
    const badges = within(screen.getByRole('list', { name: /validation summary/i })).getAllByRole('listitem')
    const { horizons, pgda } = fixtureValidation
    expect(badges[0]).toHaveTextContent(
      `Ephemeris vs JPL Horizonsmax ${horizons!.summary.maxAzErrDeg.toFixed(4)}° az · ${horizons!.summary.maxElevErrDeg.toFixed(4)}° el (n = ${horizons!.summary.n})`,
    )
    expect(badges[1]).toHaveTextContent(
      `Terrain vs PGDA${pgda!.summary.sitesWithinThreshold}/${pgda!.summary.sitesTotal} sites within ±${pgda!.summary.thresholdPp} pp`,
    )
  })

  it('renders one Horizons row per comparison with site names and errors', () => {
    renderReport()
    const rows = within(table(/horizons comparison/i)).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(fixtureValidation.horizons!.rows.length)
    const first = fixtureValidation.horizons!.rows[0]
    const cells = within(rows[0]).getAllByRole('cell')
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent(siteName(first.siteId))
    expect(cells.map((c) => c.textContent)).toEqual([
      new Date(first.tUtcMs).toISOString().slice(0, 16).replace('T', ' '),
      'Sun',
      `${first.oursAzDeg.toFixed(4)}° / ${first.oursElevDeg.toFixed(4)}°`,
      `${first.horizonsAzDeg.toFixed(4)}° / ${first.horizonsElevDeg.toFixed(4)}°`,
      `${first.azErrDeg.toFixed(4)}°`,
      `${first.elevErrDeg.toFixed(4)}°`,
    ])
  })

  it('renders the PGDA table, flags the outlier and lists its explanation', () => {
    renderReport()
    const rows = within(table(/pgda comparison/i)).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(fixtureValidation.pgda!.rows.length)
    const ridge = rows.find((r) => r.textContent?.includes(siteName('fixture-ridge')))!
    expect(within(ridge).getByRole('rowheader')).toHaveTextContent(/outlier/i)
    expect(within(ridge).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '74.2%',
      '81.0%',
      '−6.8 pp',
      '43.5%',
      '42.0%',
      '+1.5 pp',
    ])
    const plateau = rows.find((r) => r.textContent?.includes(siteName('fixture-plateau')))!
    expect(within(plateau).getByRole('rowheader')).not.toHaveTextContent(/outlier/i)

    const outliers = screen.getAllByRole('list').find((l) => l.classList.contains('validation-outliers'))!
    expect(within(outliers).getAllByRole('listitem')).toHaveLength(1)
    expect(outliers).toHaveTextContent(fixtureValidation.pgda!.rows[1].explanation!)
  })

  it('lists the methods: frame, kernels, DEMs and definitions', () => {
    renderReport()
    const methods = screen.getByRole('region', { name: 'Methods' })
    expect(methods).toHaveTextContent(/MOON_ME/)
    expect(methods).toHaveTextContent(`NAIF SPICE kernels: ${fixtureEphemerisManifest.kernels.join(', ')}`)
    expect(methods).toHaveTextContent(fixtureEphemerisManifest.abcorr)
    expect(methods).toHaveTextContent(/LDEM_80S_80M/)
    expect(methods).toHaveTextContent(/geometric DTE/i)
    expect(methods).toHaveTextContent(new RegExp(`heights ${fixtureSitesFile.heightsM.map((h) => `${h} m`).join(', ')}`))
  })

  it('says when a section has not been produced yet instead of showing numbers', () => {
    renderReport({ schemaVersion: 1, horizons: null, pgda: null })
    const badges = within(screen.getByRole('list', { name: /validation summary/i })).getAllByRole('listitem')
    expect(badges.map((b) => b.textContent)).toEqual(['Ephemeris vs JPL Horizonsnot yet produced', 'Terrain vs PGDAnot yet produced'])
    expect(screen.getByText(/no horizons comparison/i)).toBeInTheDocument()
    expect(screen.getByText(/no pgda comparison/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('reports an outlier with a missing explanation and falls back to the site id for unknown sites', () => {
    const pgda = fixtureValidation.pgda!
    renderReport({
      ...fixtureValidation,
      pgda: { ...pgda, rows: [{ ...pgda.rows[1], siteId: 'unknown-site', explanation: null }] },
    })
    expect(screen.getByText(/no explanation in validation\.json/i)).toBeInTheDocument()
    expect(within(table(/pgda comparison/i)).getByRole('rowheader')).toHaveTextContent('unknown-site')
  })
})
