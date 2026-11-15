// Validation panel (SPEC-app P0-7): evidence that our geometry and terrain numbers can be trusted.
// Every accuracy number shown here is read from validation.json; nothing is computed or assumed.
import { useId, type ReactNode } from 'react'
import {
  DEFAULT_VISIBILITY_OPTS,
  MOON_RADIUS_KM,
  type HorizonsValidation,
  type PgdaValidation,
  type PgdaValidationRow,
  type SitesFile,
  type ValidationFile,
} from '../../engine'
import { useCoreData } from '../data'
import './validation-panel.css'

export function ValidationPanel() {
  const { validation, sitesFile } = useCoreData()
  return <ValidationReport validation={validation} sitesFile={sitesFile} />
}

export interface ValidationReportProps {
  validation: ValidationFile
  /** Used for site names and the horizon-mask parameters in the methods list. */
  sitesFile: Pick<SitesFile, 'sites' | 'azStepDeg' | 'heightsM'>
}

export function ValidationReport({ validation, sitesFile }: ValidationReportProps) {
  const names = new Map(sitesFile.sites.map((s) => [s.id, s.name]))
  const siteName = (id: string) => names.get(id) ?? id
  const { horizons, pgda } = validation
  return (
    <section className="validation" aria-label="Validation">
      <h3>Validation</h3>
      <ul className="validation-badges" aria-label="Validation summary">
        <li className="validation-badge">
          <span className="validation-badge-label">Ephemeris vs JPL Horizons</span>
          {horizons ? (
            <span className="num">
              max {fmtDeg(horizons.summary.maxAzErrDeg)} az · {fmtDeg(horizons.summary.maxElevErrDeg)} el (n = {horizons.summary.n})
            </span>
          ) : (
            <span className="muted">not yet produced</span>
          )}
        </li>
        <li className={`validation-badge ${pgda ? (pgda.summary.sitesWithinThreshold === pgda.summary.sitesTotal ? 'good' : 'warn') : ''}`}>
          <span className="validation-badge-label">Terrain vs PGDA</span>
          {pgda ? (
            <span className="num">
              {pgda.summary.sitesWithinThreshold}/{pgda.summary.sitesTotal} sites within ±{pgda.summary.thresholdPp} pp
            </span>
          ) : (
            <span className="muted">not yet produced</span>
          )}
        </li>
      </ul>
      <HorizonsSection horizons={horizons} siteName={siteName} />
      <PgdaSection pgda={pgda} siteName={siteName} />
      <MethodsList azStepDeg={sitesFile.azStepDeg} heightsM={sitesFile.heightsM} />
    </section>
  )
}

// --- formatting (display rounding only) ------------------------------------------------
const fmtDeg = (v: number) => `${v.toFixed(4)}°`
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtPp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} pp`
const fmtUtc = (tUtcMs: number) => new Date(tUtcMs).toISOString().slice(0, 16).replace('T', ' ')

type SiteName = (id: string) => string

function HorizonsSection({ horizons, siteName }: { horizons: HorizonsValidation | null; siteName: SiteName }) {
  const headingId = useId()
  return (
    <section className="validation-section" aria-labelledby={headingId}>
      <h4 id={headingId}>Ephemeris vs JPL Horizons</h4>
      <p className="hint">Geometry only: smooth sphere, no terrain. Our Sun and Earth azimuth/elevation at each site and epoch against JPL Horizons.</p>
      {!horizons ? (
        <p className="hint warn">No Horizons comparison in validation.json yet.</p>
      ) : (
        <>
          <dl className="validation-stats">
            <Stat label="Comparisons" value={String(horizons.summary.n)} />
            <Stat label="Max az error" value={fmtDeg(horizons.summary.maxAzErrDeg)} />
            <Stat label="Max elev error" value={fmtDeg(horizons.summary.maxElevErrDeg)} />
            <Stat label="Mean az error" value={fmtDeg(horizons.summary.meanAzErrDeg)} />
            <Stat label="Mean elev error" value={fmtDeg(horizons.summary.meanElevErrDeg)} />
          </dl>
          <ScrollTable caption="Horizons comparison by site, epoch and body">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Epoch (UTC)</th>
                <th scope="col">Body</th>
                <th scope="col">Ours az / el</th>
                <th scope="col">Horizons az / el</th>
                <th scope="col">Az error</th>
                <th scope="col">Elev error</th>
              </tr>
            </thead>
            <tbody>
              {horizons.rows.map((r) => (
                <tr key={`${r.siteId}|${r.tUtcMs}|${r.body}`}>
                  <th scope="row">{siteName(r.siteId)}</th>
                  <td className="num">{fmtUtc(r.tUtcMs)}</td>
                  <td>{r.body === 'sun' ? 'Sun' : 'Earth'}</td>
                  <td className="num">
                    {fmtDeg(r.oursAzDeg)} / {fmtDeg(r.oursElevDeg)}
                  </td>
                  <td className="num">
                    {fmtDeg(r.horizonsAzDeg)} / {fmtDeg(r.horizonsElevDeg)}
                  </td>
                  <td className="num">{fmtDeg(r.azErrDeg)}</td>
                  <td className="num">{fmtDeg(r.elevErrDeg)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </>
      )}
    </section>
  )
}

const isOutlier = (r: PgdaValidationRow, thresholdPp: number) =>
  Math.abs(r.sunDiffPp) > thresholdPp || Math.abs(r.earthDiffPp) > thresholdPp

function PgdaSection({ pgda, siteName }: { pgda: PgdaValidation | null; siteName: SiteName }) {
  const headingId = useId()
  const thresholdPp = pgda?.summary.thresholdPp ?? 0
  const outliers = pgda ? pgda.rows.filter((r) => isOutlier(r, thresholdPp)) : []
  return (
    <section className="validation-section" aria-labelledby={headingId}>
      <h4 id={headingId}>Terrain vs PGDA product 69</h4>
      <p className="hint">Our long-term average Sun and Earth visibility per curated site, using our terrain horizon masks, against the PGDA pixel value.</p>
      {!pgda ? (
        <p className="hint warn">No PGDA comparison in validation.json yet.</p>
      ) : (
        <>
          <dl className="validation-stats">
            <Stat label={`Within ±${thresholdPp} pp`} value={`${pgda.summary.sitesWithinThreshold}/${pgda.summary.sitesTotal} sites`} />
            <Stat label="Max |Sun diff|" value={`${pgda.summary.maxAbsSunDiffPp.toFixed(1)} pp`} />
            <Stat label="Max |Earth diff|" value={`${pgda.summary.maxAbsEarthDiffPp.toFixed(1)} pp`} />
          </dl>
          <ScrollTable caption="PGDA comparison by site">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Sun ours</th>
                <th scope="col">Sun PGDA</th>
                <th scope="col">Sun diff</th>
                <th scope="col">Earth ours</th>
                <th scope="col">Earth PGDA</th>
                <th scope="col">Earth diff</th>
              </tr>
            </thead>
            <tbody>
              {pgda.rows.map((r) => (
                <tr key={r.siteId}>
                  <th scope="row">
                    {siteName(r.siteId)}
                    {isOutlier(r, thresholdPp) && <span className="validation-flag"> outlier</span>}
                  </th>
                  <td className="num">{fmtPct(r.oursSunPct)}</td>
                  <td className="num">{fmtPct(r.pgdaSunPct)}</td>
                  <Diff pp={r.sunDiffPp} thresholdPp={thresholdPp} />
                  <td className="num">{fmtPct(r.oursEarthPct)}</td>
                  <td className="num">{fmtPct(r.pgdaEarthPct)}</td>
                  <Diff pp={r.earthDiffPp} thresholdPp={thresholdPp} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <h5>Outliers (beyond ±{thresholdPp} pp)</h5>
          {outliers.length === 0 ? (
            <p className="hint">None.</p>
          ) : (
            <ul className="validation-outliers">
              {outliers.map((r) => (
                <li key={r.siteId}>
                  <strong>{siteName(r.siteId)}</strong>:{' '}
                  {r.explanation ?? <span className="hint warn">No explanation in validation.json.</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Diff({ pp, thresholdPp }: { pp: number; thresholdPp: number }) {
  return <td className={`num${Math.abs(pp) > thresholdPp ? ' validation-over' : ''}`}>{fmtPp(pp)}</td>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

/** A table in a keyboard-focusable scroll region (long Horizons tables). */
function ScrollTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    // Scrollable regions must be focusable so keyboard users can scroll them.
    <div className="validation-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="validation-table">
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

// Kernel and DEM names mirror pipeline/src/lunarnav/fetch.py (the app doesn't load the manifests that list them).
const KERNELS = 'naif0012.tls, de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, pck00011.tpc'
const DEMS = 'LDEM_80S_80M (near field), LDEM_75S_240M (far field)'

function MethodsList({ azStepDeg, heightsM }: { azStepDeg: number; heightsM: readonly number[] }) {
  const headingId = useId()
  const { sunThreshold, earthMarginDeg } = DEFAULT_VISIBILITY_OPTS
  return (
    <section className="validation-section" aria-labelledby={headingId}>
      <h4 id={headingId}>Methods</h4>
      <dl className="validation-methods">
        <dt>Frame</dt>
        <dd>
          MOON_ME (mean Earth / polar axis), planetocentric latitude and longitude (east positive), sphere R = {MOON_RADIUS_KM} km. Azimuth
          clockwise from local north; elevation above the local spherical horizontal.
        </dd>
        <dt>Ephemeris</dt>
        <dd>
          NAIF SPICE kernels: <span className="num">{KERNELS}</span>. Topocentric Sun and Earth vectors per site. Times in UTC.
        </dd>
        <dt>Terrain</dt>
        <dd>
          LOLA polar stereographic DEMs: <span className="num">{DEMS}</span>. Horizon masks every {azStepDeg}° of azimuth at observer
          heights {heightsM.map((h) => `${h} m`).join(', ')}.
        </dd>
        <dt>Sun visibility</dt>
        <dd>
          Fraction of the solar disk above the terrain horizon (the Sun is a disk, not a point). Counted as sunlit at ≥ {Math.round(sunThreshold * 100)}%
          visible by default.
        </dd>
        <dt>Earth link</dt>
        <dd>
          Geometric DTE: Earth center elevation ≥ terrain horizon + {earthMarginDeg}° margin by default. No DSN scheduling, link budget or
          multipath.
        </dd>
        <dt>Horizons check</dt>
        <dd>Smooth-sphere geometry only, compared with JPL Horizons at the same sites and epochs. It does not test terrain.</dd>
        <dt>PGDA check</dt>
        <dd>
          Long-term average Sun visibility (mean visible-disk fraction) and Earth visibility (time Earth center is above the terrain horizon),
          compared with PGDA product 69 at each curated site.
        </dd>
      </dl>
    </section>
  )
}
