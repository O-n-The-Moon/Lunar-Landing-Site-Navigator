// Landing date/time (UTC) and mission duration (SPEC-app P0-2). The slip lives in slip-slider.tsx.
import { useId, useState } from 'react'
import { DURATION_RANGE_H, HOUR_MS, useScenario, useScenarioDispatch } from '../state'

const MIN_DAYS = DURATION_RANGE_H.min / 24
const MAX_DAYS = DURATION_RANGE_H.max / 24

/** `YYYY-MM-DDTHH:MM`, the `datetime-local` value format, read as UTC. */
const toInputUtc = (ms: number) => new Date(ms).toISOString().slice(0, 16)
const fromInputUtc = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00Z`) : NaN)
export const formatUtc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

export function DateControls() {
  const { landingMs, durationH } = useScenario()
  const dispatch = useScenarioDispatch()
  const landingId = useId()
  const durationId = useId()
  // Drafts let the user pass through invalid text (e.g. an empty field) without the input snapping back.
  const [landingDraft, setLandingDraft] = useState<string | null>(null)
  const [durationDraft, setDurationDraft] = useState<string | null>(null)

  const onLanding = (v: string) => {
    setLandingDraft(v)
    const ms = fromInputUtc(v)
    if (Number.isFinite(ms)) dispatch({ type: 'setLanding', landingMs: ms })
  }

  const onDuration = (v: string) => {
    setDurationDraft(v)
    const days = Number(v)
    if (v !== '' && Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS) {
      dispatch({ type: 'setDuration', durationH: days * 24 })
    }
  }

  return (
    <fieldset className="control">
      <legend>Mission</legend>
      <label htmlFor={landingId}>Landing (UTC)</label>
      <input
        id={landingId}
        type="datetime-local"
        step={60}
        value={landingDraft ?? toInputUtc(landingMs)}
        onChange={(e) => onLanding(e.target.value)}
        onBlur={() => setLandingDraft(null)}
      />
      <label htmlFor={durationId}>Duration (days)</label>
      <input
        id={durationId}
        type="number"
        min={MIN_DAYS}
        max={MAX_DAYS}
        step={1}
        value={durationDraft ?? String(durationH / 24)}
        onChange={(e) => onDuration(e.target.value)}
        onBlur={() => setDurationDraft(null)}
      />
      <p className="hint">
        Baseline mission: <output className="num">{formatUtc(landingMs)}</output> →{' '}
        <output className="num">{formatUtc(landingMs + durationH * HOUR_MS)}</output>
      </p>
    </fieldset>
  )
}
