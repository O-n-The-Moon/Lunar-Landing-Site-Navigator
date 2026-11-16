// Validation panel (SPEC-app P0-7): evidence that our geometry and terrain numbers can be trusted.
// Every accuracy number shown here is read from validation.json; nothing is computed or assumed.
import { useId, type ReactNode } from 'react'
import {
  DEFAULT_OBSERVER_HEIGHT_M,
  DEFAULT_VISIBILITY_OPTS,
  MOON_RADIUS_KM,
  sunHysteresisLevels,
  type DemRecord,
  type EphemerisManifest,
  type HorizonsValidation,
  type PgdaMethod,
  type PgdaValidation,
  type PgdaValidationRow,
  type SitesFile,
  type ValidationFile,
} from '../../engine'
import { useCoreData } from '../data'
import './validation-panel.css'

export function ValidationPanel() {
  const { validation, sitesFile, ephemerisManifest } = useCoreData()
  return <ValidationReport validation={validation} sitesFile={sitesFile} ephemerisManifest={ephemerisManifest} />
}

export interface ValidationReportProps {
  validation: ValidationFile
  /** Used for site names and the horizon-mask parameters in the methods list. */
  sitesFile: Pick<SitesFile, 'sites' | 'azStepDeg' | 'heightsM' | 'dems'>
  /** Frame, aberration correction and kernel names for the methods list. */
  ephemerisManifest: Pick<EphemerisManifest, 'frame' | 'abcorr' | 'kernels'>
}

export function ValidationReport({ validation, sitesFile, ephemerisManifest }: ValidationReportProps) {
  const names = new Map(sitesFile.sites.map((s) => [s.id, s.name]))
  const siteName = (id: string) => names.get(id) ?? id
  const { horizons, pgda } = validation
  const horizonsVerdict = horizons && horizonsVerdictOf(horizons)
  const pgdaVerdict = pgda && pgdaVerdictOf(pgda)
  return (
    // Same pattern as the other views: one region per view, named like its tab.
    <section className="validation" aria-label="Verify">
      <h3>Verify</h3>
      <p className="hint">Checked against JPL Horizons and PGDA. Every accuracy number here is read from validation.json.</p>
      <ul className="validation-badges" aria-label="Validation summary">
        <li className={['validation-badge', horizonsVerdict && verdictTone(horizonsVerdict)].filter(Boolean).join(' ')}>
          <span className="validation-badge-label">Ephemeris vs JPL Horizons</span>
          <span className={horizons ? 'num' : 'muted'}>
            {horizons
              ? `max ${fmtErr(horizons.summary.maxAzErrDeg)} az · ${fmtErr(horizons.summary.maxElevErrDeg)} el (n = ${horizons.summary.n})`
              : 'not yet produced'}
          </span>
          {horizonsVerdict && <Verdict verdict={horizonsVerdict} />}
        </li>
        <li className={['validation-badge', pgda && (pgdaVerdict ? verdictTone(pgdaVerdict) : pgdaTone(pgda))].filter(Boolean).join(' ')}>
          <span className="validation-badge-label">Terrain vs PGDA</span>
          <span className={pgda ? 'num' : 'muted'}>
            {pgda
              ? `${pgda.summary.sitesWithinThreshold}/${pgda.summary.sitesTotal} sites within ±${pgda.summary.thresholdPp} pp`
              : 'not yet produced'}
          </span>
          {pgdaVerdict && <Verdict verdict={pgdaVerdict} />}
          {pgda?.method && <span className="validation-badge-note">{pgda.method.claimLabel}</span>}
        </li>
      </ul>
      <HorizonsSection horizons={horizons} siteName={siteName} />
      <PgdaSection pgda={pgda} siteName={siteName} />
      <MethodsList azStepDeg={sitesFile.azStepDeg} heightsM={sitesFile.heightsM} dems={sitesFile.dems} ephemerisManifest={ephemerisManifest} />
    </section>
  )
}

/** A pass/fail result against a target in validation.json. */
interface VerdictResult {
  pass: boolean
  /** "target ≤ 0.02°" */
  target: string
}

const isTarget = (v: number | undefined, max = Infinity): v is number => typeof v === 'number' && v > 0 && v <= max

/** SPEC.md criterion 1: both max errors at or under the target. No verdict for files without the target. */
function horizonsVerdictOf({ summary }: HorizonsValidation): VerdictResult | null {
  const target = summary.targetMaxErrDeg
  if (!isTarget(target)) return null
  return { pass: Math.max(summary.maxAzErrDeg, summary.maxElevErrDeg) <= target, target: `target ≤ ${target}°` }
}

/**
 * SPEC.md criterion 2: share of sites within the threshold at or over the target. No verdict without a target or sites,
 * or when the summary disagrees with its rows (the section then says the file is inconsistent).
 */
function pgdaVerdictOf({ summary, rows }: PgdaValidation): VerdictResult | null {
  const target = summary.targetFractionWithin
  if (!isTarget(target, 1) || summary.sitesTotal === 0) return null
  const rowsWithin = rows.filter((r) => !isOutlier(r, summary.thresholdPp)).length
  if (rows.length !== summary.sitesTotal || rowsWithin !== summary.sitesWithinThreshold) return null
  return {
    pass: summary.sitesWithinThreshold / summary.sitesTotal >= target,
    target: `target ≥ ${fmtFractionPct(target)}% of sites`,
  }
}

const verdictTone = (v: VerdictResult) => (v.pass ? 'good' : 'warn')

function Verdict({ verdict }: { verdict: VerdictResult }) {
  return <span className="validation-verdict">{`${verdict.pass ? 'Pass' : 'Not met'}: ${verdict.target}`}</span>
}

/** Tone for a file without a PGDA target: all sites within the threshold or not. */
const pgdaTone = ({ summary }: PgdaValidation) =>
  summary.sitesTotal === 0 ? null : summary.sitesWithinThreshold === summary.sitesTotal ? 'good' : 'warn'

// --- formatting (display rounding only; never hides a non-zero error or blurs the threshold) ---
const MINUS = '−'

/** `toFixed` with a typographic minus and no "-0". */
function fixed(v: number, decimals: number): string {
  const s = v.toFixed(decimals)
  return Number(s) === 0 ? s.replace('-', '') : s.replace('-', MINUS)
}

/** Az/el values. */
export const fmtAngle = (deg: number) => `${fixed(deg, 4)}°`

/** Errors: 4 decimals like the angles; 2 significant figures only when a non-zero error would round to 0. */
export const fmtErr = (deg: number) =>
  deg !== 0 && Number(deg.toFixed(4)) === 0 ? `${deg < 0 ? MINUS : ''}${Math.abs(deg).toPrecision(2)}°` : fmtAngle(deg)

const fmtPct = (pct: number) => `${fixed(pct, 1)}%`

/** Fewest decimals (≥ 1) at which |pp| doesn't display as exactly the threshold unless it is the threshold. */
function ppDecimals(absPp: number, thresholdPp: number): number {
  for (let d = 1; d < 4; d++) if (absPp === thresholdPp || Number(absPp.toFixed(d)) !== thresholdPp) return d
  return 4
}

/** Percentage-point difference, signed from the rounded value. */
export function fmtPp(pp: number, thresholdPp: number, signed = true): string {
  const d = ppDecimals(Math.abs(pp), thresholdPp)
  const plus = signed && Number(pp.toFixed(d)) > 0 ? '+' : ''
  return `${plus}${fixed(pp, d)} pp`
}

/** UTC to the second; tolerates a bad value instead of throwing. */
const fmtUtc = (tUtcMs: number) =>
  Number.isFinite(tUtcMs) ? new Date(tUtcMs).toISOString().slice(0, 19).replace('T', ' ') : 'invalid time'

/** 0.55 → "55", 0.525 → "52.5". */
const fmtFractionPct = (fraction: number) => String(Number((fraction * 100).toFixed(1)))

type SiteName = (id: string) => string

function HorizonsSection({ horizons, siteName }: { horizons: HorizonsValidation | null; siteName: SiteName }) {
  return (
    <div className="validation-section">
      <h4>Ephemeris vs JPL Horizons</h4>
      <p className="hint">Geometry only: smooth sphere, no terrain. Our Sun and Earth azimuth/elevation at each site and epoch against JPL Horizons.</p>
      {!horizons ? (
        <p className="hint warn">No Horizons comparison in validation.json yet.</p>
      ) : (
        <>
          <dl className="validation-stats">
            <Stat label="Comparisons" value={String(horizons.summary.n)} />
            <Stat label="Max az error" value={fmtErr(horizons.summary.maxAzErrDeg)} />
            <Stat label="Max elev error" value={fmtErr(horizons.summary.maxElevErrDeg)} />
            <Stat label="Mean az error" value={fmtErr(horizons.summary.meanAzErrDeg)} />
            <Stat label="Mean elev error" value={fmtErr(horizons.summary.meanElevErrDeg)} />
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
                    {fmtAngle(r.oursAzDeg)} / {fmtAngle(r.oursElevDeg)}
                  </td>
                  <td className="num">
                    {fmtAngle(r.horizonsAzDeg)} / {fmtAngle(r.horizonsElevDeg)}
                  </td>
                  <td className="num">{fmtErr(r.azErrDeg)}</td>
                  <td className="num">{fmtErr(r.elevErrDeg)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </>
      )}
    </div>
  )
}

/** Matches the contract (types.ts): an outlier has |diff| > thresholdPp. */
const isOutlier = (r: PgdaValidationRow, thresholdPp: number) =>
  Math.abs(r.sunDiffPp) > thresholdPp || Math.abs(r.earthDiffPp) > thresholdPp

function PgdaSection({ pgda, siteName }: { pgda: PgdaValidation | null; siteName: SiteName }) {
  return (
    <div className="validation-section">
      <h4>Terrain vs PGDA product 69</h4>
      <p className="hint">Our long-term average Sun and Earth visibility per curated site, using our terrain horizon masks, against the PGDA pixel value.</p>
      {pgda ? (
        <>
          <PgdaMethodBlock method={pgda.method ?? null} />
          <PgdaDetail pgda={pgda} siteName={siteName} />
        </>
      ) : (
        <p className="hint warn">No PGDA comparison in validation.json yet.</p>
      )}
    </div>
  )
}

/** The comparison method recorded in the file; no height or definition is assumed here. */
function PgdaMethodBlock({ method }: { method: PgdaMethod | null }) {
  const headingId = useId()
  if (!method) return <p className="hint">The PGDA comparison method is not recorded in validation.json.</p>
  const { observerHeightM, sensitivityHeightsM } = method
  return (
    <div role="region" aria-labelledby={headingId}>
      <h5 id={headingId}>PGDA method</h5>
      <p className="validation-claim">{method.claimLabel}</p>
      <dl className="validation-methods">
        <dt>Observer height</dt>
        <dd>{observerHeightM === null ? 'unknown' : `${observerHeightM} m`}</dd>
        <dt>Sensitivity runs</dt>
        <dd>{sensitivityHeightsM.length > 0 ? sensitivityHeightsM.map((h) => `${h} m`).join(', ') : 'none'}</dd>
        <dt>Sun</dt>
        <dd>{method.sunDefinition}</dd>
        <dt>Earth</dt>
        <dd>{method.earthDefinition}</dd>
        <dt>PGDA product 69</dt>
        <dd>{method.pgdaDefinition}</dd>
        <dt>Sampling</dt>
        <dd>{method.sampling}</dd>
        <dt>Limits</dt>
        <dd>{method.notes}</dd>
      </dl>
    </div>
  )
}

function PgdaDetail({ pgda, siteName }: { pgda: PgdaValidation; siteName: SiteName }) {
  const outliersId = useId()
  const { thresholdPp, sitesWithinThreshold, sitesTotal } = pgda.summary
  const outliers = pgda.rows.filter((r) => isOutlier(r, thresholdPp))
  const rowsWithin = pgda.rows.length - outliers.length
  const consistent = rowsWithin === sitesWithinThreshold && pgda.rows.length === sitesTotal
  return (
    <>
      <dl className="validation-stats">
        <Stat label={`Within ±${thresholdPp} pp`} value={`${sitesWithinThreshold}/${sitesTotal} sites`} />
        <Stat label="Max |Sun diff|" value={fmtPp(pgda.summary.maxAbsSunDiffPp, thresholdPp, false)} />
        <Stat label="Max |Earth diff|" value={fmtPp(pgda.summary.maxAbsEarthDiffPp, thresholdPp, false)} />
      </dl>
      {!consistent && (
        <p className="hint warn">
          validation.json is inconsistent: its summary says {sitesWithinThreshold}/{sitesTotal} sites are within ±{thresholdPp} pp, but its
          rows give {rowsWithin}/{pgda.rows.length}.
        </p>
      )}
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
      <p className="hint">▲ beyond ±{thresholdPp} pp.</p>
      <h5 id={outliersId}>Outliers (beyond ±{thresholdPp} pp)</h5>
      {outliers.length === 0 ? (
        <p className="hint">None.</p>
      ) : (
        <ul className="validation-outliers" aria-labelledby={outliersId}>
          {outliers.map((r) => (
            <li key={r.siteId}>
              <strong>{siteName(r.siteId)}</strong>: {r.explanation ?? <span className="hint warn">No explanation in validation.json.</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Diff({ pp, thresholdPp }: { pp: number; thresholdPp: number }) {
  const over = Math.abs(pp) > thresholdPp
  return (
    <td className={over ? 'num validation-over' : 'num'}>
      {fmtPp(pp, thresholdPp)}
      {over && (
        <>
          <span aria-hidden="true"> ▲</span>
          <span className="visually-hidden"> (beyond ±{thresholdPp} pp)</span>
        </>
      )}
    </td>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  )
}

/** A table in a keyboard-focusable scroll region (long Horizons tables), named by its caption. */
function ScrollTable({ caption, children }: { caption: string; children: ReactNode }) {
  const captionId = useId()
  return (
    // Scrollable regions must be focusable so keyboard users can scroll them.
    <div className="validation-table-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="validation-table">
        <caption id={captionId} className="visually-hidden">
          {caption}
        </caption>
        {children}
      </table>
    </div>
  )
}

const demLabel = ({ file, role, resolutionM }: DemRecord) => `${file} (${role}, ${resolutionM} m)`

interface MethodsListProps {
  azStepDeg: number
  heightsM: readonly number[]
  dems: readonly DemRecord[]
  ephemerisManifest: ValidationReportProps['ephemerisManifest']
}

function MethodsList({ azStepDeg, heightsM, dems, ephemerisManifest }: MethodsListProps) {
  const { sunThreshold, hysteresis, earthMarginDeg, earthHysteresisDeg } = DEFAULT_VISIBILITY_OPTS
  const { onFraction: sunOn, offFraction: sunOff } = sunHysteresisLevels(DEFAULT_VISIBILITY_OPTS)
  return (
    <div className="validation-section">
      <h4>Methods</h4>
      <dl className="validation-methods">
        <dt>Frame</dt>
        <dd>
          {/* The gloss is for MOON_ME, the only frame the contract allows (EphemerisManifest.frame). */}
          {ephemerisManifest.frame} (mean Earth / polar axis), planetocentric latitude and longitude (east positive), sphere R = {MOON_RADIUS_KM} km.
          Azimuth clockwise from local north; elevation above the local spherical horizontal.
        </dd>
        <dt>Ephemeris</dt>
        <dd>
          NAIF SPICE kernels: <span className="num">{ephemerisManifest.kernels.join(', ')}</span>. Aberration correction{' '}
          <span className="num">{ephemerisManifest.abcorr}</span>. Topocentric Sun and Earth vectors per site. Times in UTC.
        </dd>
        <dt>Terrain</dt>
        <dd>
          LOLA polar stereographic DEMs: <span className="num">{dems.map(demLabel).join(', ')}</span>. Horizon masks every {azStepDeg}° of azimuth for observers{' '}
          {heightsM.map((h) => `${h} m`).join(', ')} above the surface; {DEFAULT_OBSERVER_HEIGHT_M} m by default.
        </dd>
        <dt>Sun visibility</dt>
        <dd>
          Fraction of the solar disk above the terrain horizon (the Sun is a disk, not a point). By default a site becomes sunlit when the
          visible fraction reaches {fmtFractionPct(sunOn)}% and stays sunlit until it drops to {fmtFractionPct(sunOff)}% (threshold{' '}
          {fmtFractionPct(sunThreshold)}% ± {fmtFractionPct(hysteresis)}% hysteresis).
        </dd>
        <dt>Earth link</dt>
        <dd>
          Geometric DTE: Earth center elevation ≥ terrain horizon + {earthMarginDeg}° margin, with ±{earthHysteresisDeg}° hysteresis, by
          default. No DSN scheduling, link budget or multipath.
        </dd>
        <dt>Horizons check</dt>
        <dd>Smooth-sphere geometry only, compared with JPL Horizons at the same sites and epochs. It does not test terrain.</dd>
        <dt>PGDA check</dt>
        <dd>Long-term average Sun and Earth visibility from our terrain horizon masks, compared with PGDA product 69 at each curated site.</dd>
      </dl>
    </div>
  )
}
