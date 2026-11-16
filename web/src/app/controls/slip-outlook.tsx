// Slip outlook: "power + comms" (Both %) for every whole-day slip, one thin strip per site, drawn right above the slip
// track so each column sits over the slider position it describes. Values are `missionMetrics` (the same call the
// rows and cards use), computed in small time-boxed chunks so the UI never blocks; nearest-to-zero slips first, so
// the part under the thumb fills in first. Click a column to jump to that slip.
import { useEffect, useMemo, useState } from 'react'
import { missionMetrics, type SiteContext } from '../../engine'
import { HOUR_MS, SLIP_RANGE_H, useScenario, useScenarioDispatch } from '../state'
import { splitSiteName } from '../ui/names'
import { missionInCoverage, useSharedResults } from '../use-scenario-results'

export const OUTLOOK_DAY_MIN = SLIP_RANGE_H.min / 24
export const OUTLOOK_DAY_MAX = SLIP_RANGE_H.max / 24
const N_DAYS = OUTLOOK_DAY_MAX - OUTLOOK_DAY_MIN + 1
/** Main-thread budget per chunk, ms (a slip step has 33 ms; one chunk may overshoot by one `missionMetrics` call). */
const CHUNK_MS = 6

interface Outlook {
  key: object
  /** siteId → Both % per slip day (index 0 = OUTLOOK_DAY_MIN); NaN = not computed yet or outside the ephemeris. */
  values: Map<string, Float32Array>
  done: boolean
}

export function useSlipOutlook() {
  const { results, setups } = useSharedResults()
  const { landingMs, durationH } = useScenario()
  const { opts } = results
  // Everything the outlook depends on, none of which changes with the slip: a new object means "start over".
  const key = useMemo(() => {
    const sites = setups.flatMap((x): { id: string; ctx: SiteContext }[] => ('ctx' in x ? [{ id: x.site.id, ctx: x.ctx }] : []))
    return { sites, opts, landingMs, durationH }
  }, [setups, opts, landingMs, durationH])
  const [outlook, setOutlook] = useState<Outlook | null>(null)

  useEffect(() => {
    const values = new Map(key.sites.map((r) => [r.id, new Float32Array(N_DAYS).fill(NaN)]))
    const jobs = key.sites.flatMap((r) => Array.from({ length: N_DAYS }, (_, i) => ({ r, i })))
    jobs.sort((a, b) => Math.abs(a.i + OUTLOOK_DAY_MIN) - Math.abs(b.i + OUTLOOK_DAY_MIN))
    let next = 0
    let timer = 0
    const run = () => {
      const t0 = performance.now()
      while (next < jobs.length && performance.now() - t0 < CHUNK_MS) {
        const { r, i } = jobs[next++]
        const landing = key.landingMs + (i + OUTLOOK_DAY_MIN) * 24 * HOUR_MS
        if (missionInCoverage(r.ctx.eph, landing, key.durationH)) {
          values.get(r.id)![i] = missionMetrics(r.ctx, landing, key.durationH, key.opts).bothPct
        }
      }
      const done = next >= jobs.length
      setOutlook({ key, values: new Map(values), done })
      if (!done) timer = window.setTimeout(run, 0)
    }
    timer = window.setTimeout(run, 60)
    return () => window.clearTimeout(timer)
  }, [key])

  return { results, outlook: outlook?.key === key ? outlook : null }
}

const signedDays = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} d`

/**
 * `currentDay`: the day the slider's thumb shows. `markDay`: the day a loaded demo scenario is about (outlined).
 * Sits in the slider's track column: its width is the input's, and the 9 px inset puts each column's centre under
 * the thumb centre for that day (thumb 18 px, see deck.css).
 */
export function SlipOutlook({ currentDay, markDay }: { currentDay: number; markDay?: number }) {
  const { results, outlook } = useSlipOutlook()
  const dispatch = useScenarioDispatch()
  if (results.sites.length === 0) return null

  return (
    <div className="slip-outlook" title="Power + comms (Both %) by landing slip, one strip per site">
      {results.sites.map((r) => {
        const vals = outlook?.values.get(r.site.id)
        let best = -1
        if (vals && outlook?.done) for (let i = 0; i < N_DAYS; i++) if (!Number.isNaN(vals[i]) && (best < 0 || vals[i] > vals[best])) best = i
        const name = splitSiteName(r.site.name).short
        const label =
          best >= 0 ? `${name}: best slip ${signedDays(best + OUTLOOK_DAY_MIN)} at ${vals![best].toFixed(0)} % power + comms` : `${name}: power + comms by slip`
        return (
          <svg
            key={r.site.id}
            className="slip-outlook-strip"
            viewBox={`-0.5 0 ${N_DAYS} 1`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const i = Math.min(N_DAYS - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * N_DAYS)))
              dispatch({ type: 'setSlip', slipH: (i + OUTLOOK_DAY_MIN) * 24 })
            }}
          >
            {Array.from({ length: N_DAYS }, (_, i) => {
              const v = vals ? vals[i] : NaN
              const d = i + OUTLOOK_DAY_MIN
              return (
                <rect key={i} x={i - 0.5} y={0} width={1.03} height={1} fill="var(--both)" fillOpacity={Number.isNaN(v) ? 0 : 0.08 + (v / 100) * 0.92}>
                  <title>{`${signedDays(d)}: ${Number.isNaN(v) ? 'n/a' : `${v.toFixed(1)} %`}`}</title>
                </rect>
              )
            })}
            {best >= 0 && <rect x={best - 0.5} y={0} width={1} height={1} fill="none" stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
            {markDay !== undefined && <rect x={markDay - OUTLOOK_DAY_MIN - 0.5} y={0} width={1} height={1} fill="none" stroke="var(--sun)" strokeWidth={1.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
            <rect x={currentDay - OUTLOOK_DAY_MIN - 0.02} y={0} width={0.04} height={1} fill="var(--sun)" />
          </svg>
        )
      })}
    </div>
  )
}
