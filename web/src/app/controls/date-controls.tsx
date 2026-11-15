// Landing date/time (UTC) and mission duration (SPEC-app P0-2). The slip lives in slip-slider.tsx.
import { useId, useState } from 'react'
import { useCoreData } from '../data'
import { DURATION_RANGE_H, HOUR_MS, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'

const MIN_DAYS = DURATION_RANGE_H.min / 24
const MAX_DAYS = DURATION_RANGE_H.max / 24

/** `YYYY-MM-DDTHH:MM`, the `datetime-local` value format, read as UTC. */
const toInputUtc = (ms: number) => new Date(ms).toISOString().slice(0, 16)
const fromInputUtc = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00Z`) : NaN)
export const formatUtc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

const isWholeDays = (days: number) => Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS

export function DateControls() {
  const scenario = useScenario()
  const { landingMs, durationH } = scenario
  const { ephemeris } = useCoreData()
  const dispatch = useScenarioDispatch()
  const landingId = useId()
  const durationId = useId()
  // Drafts let the user pass through invalid text (e.g. an empty field) without the input snapping back.
  const [landingDraft, setLandingDraft] = useState<string | null>(null)
  const [durationDraft, setDurationDraft] = useState<string | null>(null)

  const coverageStartMs = ephemeris.startUtcMs
  const coverageEndMs = ephemeris.startUtcMs + (ephemeris.count - 1) * ephemeris.stepMs
  const inCoverage = (ms: number) => ms >= coverageStartMs && ms <= coverageEndMs
  const coverageText = `${formatUtc(coverageStartMs)} → ${formatUtc(coverageEndMs)}`

  const draftLandingMs = landingDraft === null ? landingMs : fromInputUtc(landingDraft)
  const landingError = !Number.isFinite(draftLandingMs)
    ? 'Enter a full date and time.'
    : !inCoverage(draftLandingMs)
      ? `Outside the ephemeris (${coverageText}).`
      : null
  const draftDays = durationDraft === null ? durationH / 24 : Number(durationDraft)
  const durationError = durationDraft !== null && !isWholeDays(draftDays) ? `Whole days, ${MIN_DAYS}–${MAX_DAYS}.` : null
  // The landing itself must be covered; a mission that runs past the data is allowed but flagged.
  const missionOutside =
    !landingError &&
    (!inCoverage(landingMs + durationH * HOUR_MS) || !inCoverage(slippedLandingMs(scenario)) || !inCoverage(missionEndMs(scenario)))

  const onLanding = (v: string) => {
    setLandingDraft(v)
    const ms = fromInputUtc(v)
    if (Number.isFinite(ms) && inCoverage(ms)) dispatch({ type: 'setLanding', landingMs: ms })
  }

  const onDuration = (v: string) => {
    setDurationDraft(v)
    const days = Number(v)
    if (v !== '' && isWholeDays(days)) dispatch({ type: 'setDuration', durationH: days * 24 })
  }

  const onDurationBlur = () => {
    // Commit out-of-range numbers clamped (45 → 30) rather than keeping an intermediate keystroke.
    const days = Math.round(Number(durationDraft))
    if (durationDraft !== null && durationDraft !== '' && Number.isFinite(days)) {
      dispatch({ type: 'setDuration', durationH: days * 24 })
    }
    setDurationDraft(null)
  }

  return (
    <fieldset className="control">
      <legend>Mission</legend>
      <label htmlFor={landingId}>Landing (UTC)</label>
      <input
        id={landingId}
        type="datetime-local"
        step={60}
        min={toInputUtc(coverageStartMs)}
        max={toInputUtc(coverageEndMs)}
        value={landingDraft ?? toInputUtc(landingMs)}
        aria-invalid={landingError !== null}
        aria-describedby={landingError ? `${landingId}-error` : undefined}
        onChange={(e) => onLanding(e.target.value)}
        onBlur={() => setLandingDraft(null)}
      />
      {landingError && (
        <p id={`${landingId}-error`} className="hint error">
          {landingError}
        </p>
      )}
      <label htmlFor={durationId}>Duration (days)</label>
      <input
        id={durationId}
        type="number"
        min={MIN_DAYS}
        max={MAX_DAYS}
        step={1}
        value={durationDraft ?? String(durationH / 24)}
        aria-invalid={durationError !== null}
        aria-describedby={durationError ? `${durationId}-error` : undefined}
        onChange={(e) => onDuration(e.target.value)}
        onBlur={onDurationBlur}
      />
      {durationError && (
        <p id={`${durationId}-error`} className="hint error">
          {durationError}
        </p>
      )}
      <p className="hint">
        Baseline mission: <output className="num">{formatUtc(landingMs)}</output> →{' '}
        <output className="num">{formatUtc(landingMs + durationH * HOUR_MS)}</output>
      </p>
      {missionOutside && (
        <p className="hint warn" role="status">
          Part of the mission (baseline or slipped) is outside the ephemeris ({coverageText}).
        </p>
      )}
    </fieldset>
  )
}
