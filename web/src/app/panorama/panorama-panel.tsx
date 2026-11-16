// Horizon panorama for the focused site at the shared cursor time (SPEC-app P0-5).
// Positions come from the engine; lit / in-view state comes from the same windows the timeline draws,
// so the panorama and the timeline always agree.
import { useId, useMemo, useState } from 'react'
import type { Body } from '../../engine'
import { HOUR_MS, useScenario } from '../state'
import { useScenarioResults } from '../use-scenario-results'
import { bodyAt } from './bodies'
import { HorizonPanorama, type PanoramaBody } from './horizon-panorama'
import { missionTracks } from './tracks'

/** What the middle of the panorama follows: fixed (S in the middle, N at the edges) or a body at the cursor time. */
type CenterOn = 'fixed' | Body
const CENTER_OPTIONS: { value: CenterOn; label: string }[] = [
  { value: 'fixed', label: 'N at edges' },
  { value: 'sun', label: 'Sun' },
  { value: 'earth', label: 'Earth' },
]
const FIXED_CENTER_AZ_DEG = 180

function CenterControl({ value, onChange }: { value: CenterOn; onChange: (v: CenterOn) => void }) {
  const labelId = useId()
  return (
    <div className="row" style={{ alignItems: 'baseline', fontSize: '0.75rem' }}>
      <span id={labelId} className="muted">
        Center
      </span>
      <div className="row" role="radiogroup" aria-labelledby={labelId}>
        {CENTER_OPTIONS.map((o) => (
          <label key={o.value}>
            <input type="radio" name={labelId} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

export function PanoramaPanel() {
  const { focusedSiteId, cursorMs } = useScenario()
  const results = useScenarioResults()
  const [centerOn, setCenterOn] = useState<CenterOn>('fixed')
  const focused = results.sites.find((r) => r.site.id === focusedSiteId)
  const unavailable = results.unavailable.find((x) => x.id === focusedSiteId)

  // The slipped mission's tracks; rebuilt when the results change (results are memoized, so not when the cursor moves).
  const startMs = results.slippedLandingMs
  const endMs = startMs + results.durationH * HOUR_MS
  const tracks = useMemo(
    () => (focused ? missionTracks(focused.slipped.samples, focused.slipped.windows, { startMs, endMs }) : undefined),
    [focused, startMs, endMs],
  )

  let content
  if (!focused) {
    content =
      focusedSiteId === null ? (
        <p className="hint">Add a site to see its horizon.</p>
      ) : (
        <p className="hint warn">
          {unavailable ? `No horizon for ${unavailable.name}: ${unavailable.reason}` : `No horizon for ${focusedSiteId}.`}
        </p>
      )
  } else {
    const { ctx, slipped, site } = focused
    let bodies: { sun: PanoramaBody; earth: PanoramaBody } | null = null
    let error = ''
    try {
      bodies = {
        sun: bodyAt(ctx, 'sun', cursorMs, slipped.windows.sun),
        earth: bodyAt(ctx, 'earth', cursorMs, slipped.windows.earth),
      }
    } catch (e) {
      // The engine throws RangeError for bad inputs: cursor outside the ephemeris (bodyVectorKm), or a horizon mask
      // that doesn't cover 360° (horizonElevAt). Show its message rather than guessing which.
      if (!(e instanceof RangeError)) throw e
      error = e.message
    }
    content = bodies ? (
      <>
        <CenterControl value={centerOn} onChange={setCenterOn} />
        <HorizonPanorama
          siteName={site.name}
          horizonMaskDeg={ctx.horizonMaskDeg}
          azStepDeg={ctx.azStepDeg}
          observerHeightM={ctx.observerHeightM}
          sun={bodies.sun}
          earth={bodies.earth}
          centerAzDeg={centerOn === 'fixed' ? FIXED_CENTER_AZ_DEG : bodies[centerOn].azDeg}
          tracks={tracks}
        />
      </>
    ) : (
      <p className="hint warn">
        Can't draw the horizon for {site.name}: {error}
      </p>
    )
  }

  return (
    <section aria-label="Horizon panorama">
      <h3>Horizon panorama</h3>
      {content}
    </section>
  )
}
