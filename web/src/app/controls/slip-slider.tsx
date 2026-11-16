// Slip slider (SPEC-app P0-2): −30…+90 days in 1-day steps, plus a fine ±12 h, around the baseline landing. It lives in
// the bottom deck (S2-2); the deck's CSS (shell.css) lays its parts out.
import { useId, useState } from 'react'
import type { Ephemeris } from '../../engine'
import { useCoreData } from '../data'
import { HOUR_MS, SLIP_RANGE_H, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'
import { missionInCoverage } from '../use-scenario-results'
import { formatUtc } from './date-controls'
import { OUTLOOK_DAY_MAX, OUTLOOK_DAY_MIN, SlipOutlook } from './slip-outlook'

const MINUS = '−'
const FINE_H = 12
const DAY_MIN = OUTLOOK_DAY_MIN
const DAY_MAX = OUTLOOK_DAY_MAX

/**
 * Splits a slip into whole days (what the day slider shows) and a fine part within ±12 h. A slip of d × 24 ± 12 h
 * has two splits; `preferDays` (the days the user last chose) picks it when it fits, so the slider being moved
 * doesn't jump. Otherwise ties go to the fine part.
 */
export function splitSlipH(slipH: number, preferDays?: number): { days: number; hours: number } {
  if (preferDays !== undefined && Math.abs(slipH - preferDays * 24) <= FINE_H) {
    return { days: preferDays, hours: slipH - preferDays * 24 }
  }
  let days = Math.trunc(slipH / 24) || 0 // `|| 0` turns −0 into 0
  let hours = slipH - days * 24
  if (hours > FINE_H) [days, hours] = [days + 1, hours - 24]
  if (hours < -FINE_H) [days, hours] = [days - 1, hours + 24]
  return { days, hours }
}

/** `+2 d 18 h`, `−1 d 6 h`, `+6 h`, `0 h`: the slip as a signed day/hour duration. */
export function formatSlipH(slipH: number): string {
  if (slipH === 0) return '0 h'
  const abs = Math.abs(slipH)
  const days = Math.floor(abs / 24)
  const hours = abs - days * 24
  const parts = [days > 0 && `${days} d`, hours > 0 && `${hours} h`].filter(Boolean).join(' ')
  return `${slipH > 0 ? '+' : MINUS}${parts}`
}

const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `${MINUS}${-v}` : '0')

/** Whole-hour slips whose mission lies inside the ephemeris and the slip range, or null if there are none. */
function coveredSlipRangeH(eph: Ephemeris, landingMs: number, durationH: number): { min: number; max: number } | null {
  const endMs = eph.startUtcMs + (eph.count - 1) * eph.stepMs
  const min = Math.max(SLIP_RANGE_H.min, Math.ceil((eph.startUtcMs - landingMs) / HOUR_MS))
  const max = Math.min(SLIP_RANGE_H.max, Math.floor((endMs - durationH * HOUR_MS - landingMs) / HOUR_MS))
  return min <= max ? { min, max } : null
}

/** `tryDays`: the slip a loaded demo scenario is about; the "Try" button applies it. */
export function SlipSlider({ tryDays }: { tryDays?: number }) {
  const scenario = useScenario()
  const { slipH, landingMs, durationH } = scenario
  const { ephemeris } = useCoreData()
  const dispatch = useScenarioDispatch()
  const daysId = useId()
  const fineId = useId()
  const warningId = useId()

  // The days the user last chose, so a ±12 h fine value keeps that split (see splitSlipH).
  const [preferDays, setPreferDays] = useState<number | undefined>(undefined)
  const { days, hours } = splitSlipH(slipH, preferDays)
  const setSlip = (h: number, nextDays?: number) => {
    setPreferDays(nextDays)
    dispatch({ type: 'setSlip', slipH: h })
  }
  const slippedMs = slippedLandingMs(scenario)
  const outcome = `slip ${formatSlipH(slipH)}, lands ${formatUtc(slippedMs)}`
  const outside = !missionInCoverage(ephemeris, slippedMs, durationH)
  const covered = outside ? coveredSlipRangeH(ephemeris, landingMs, durationH) : null

  return (
    <fieldset className="control slip-slider" aria-describedby={outside ? warningId : undefined}>
      <legend>Slip</legend>
      <span className="deck-label" aria-hidden="true">
        Slip
      </span>
      <div className="slip-days">
        <div className="slip-row">
          <label htmlFor={daysId} className="visually-hidden">
            Slip (days)
          </label>
          <span className="num slip-end" aria-hidden="true">
            {MINUS}30
          </span>
          <div className="slip-track">
            <SlipOutlook currentDay={days} markDay={tryDays} landingMs={landingMs} durationH={durationH} />
            <input
              id={daysId}
              type="range"
              min={DAY_MIN}
              max={DAY_MAX}
              step={1}
              value={days}
              aria-valuetext={`${signed(days)} days (${outcome})`}
              onChange={(e) => {
                const d = Number(e.target.value)
                setSlip(d * 24 + hours, d)
              }}
            />
          </div>
          <span className="num slip-end" aria-hidden="true">
            +90 d
          </span>
        </div>
      </div>
      <span className="num slip-value">{signed(days)} d</span>
      {tryDays !== undefined && (
        <button type="button" className="slip-try" disabled={slipH === tryDays * 24} onClick={() => setSlip(tryDays * 24, tryDays)}>
          Try {signed(tryDays)} d
        </button>
      )}
      <div className="slip-meta">
        <div className="slip-fine">
          <label htmlFor={fineId}>Fine (hours)</label>
          <input
            id={fineId}
            type="range"
            // Narrowed at the ends so the slider never shows a slip the state would clamp away.
            min={Math.max(-FINE_H, SLIP_RANGE_H.min - days * 24)}
            max={Math.min(FINE_H, SLIP_RANGE_H.max - days * 24)}
            step={1}
            value={hours}
            aria-valuetext={`${signed(hours)} hours (${outcome})`}
            onChange={(e) => setSlip(days * 24 + Number(e.target.value), days)}
          />
          <span className="num slip-value-fine">{signed(hours)} h</span>
        </div>
        <div className="slip-summary">
          <p className="hint">
            {slipH === 0 ? (
              <>No slip: baseline landing</>
            ) : (
              <>
                Slip <span className="num slip-total">{formatSlipH(slipH)}</span>
              </>
            )}{' '}
            → <span className="num slip-date">{formatUtc(slippedMs)}</span>
          </p>
          <button type="button" onClick={() => setSlip(0)} disabled={slipH === 0}>
            Reset
          </button>
        </div>
      </div>
      {/* Always mounted: a live region inserted together with its text is often not announced. */}
      <p id={warningId} className="hint warn slip-warning" role="status">
        {outside && (
          <>
            Slipped mission is outside the ephemeris; affected sites show no data.{' '}
            {covered
              ? `Covered slips: ${formatSlipH(covered.min)} … ${formatSlipH(covered.max)}.`
              : 'No slip keeps this mission inside it.'}
          </>
        )}
      </p>
    </fieldset>
  )
}
