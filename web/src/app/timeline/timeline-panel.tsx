// Timeline strips, one per scenario site, over the slipped mission window (SPEC-app P0-4). One cursor, shared by
// every strip, is the scenario cursor. When the slip is not 0, each strip also shows a faint ghost of its
// unslipped baseline so a loss from the slip is visible at a glance.
import { useMemo } from 'react'
import type { DetectedWindows } from '../../engine'
import { useScenario, useScenarioDispatch } from '../state'
import { useScenarioResults } from '../use-scenario-results'
import { cursorReadout, type CursorReadout } from './cursor-readout'
import { shiftWindows } from './ghost'
import { TimelineCursor } from './timeline-cursor'
import { TimelineStrip, eventTexts } from './timeline-strip'
import './timeline.css'

const H_MS = 3_600_000

const formatUtc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** "T+6 h" / "T+1 d 6 h": time since the (slipped) landing. */
function formatElapsed(ms: number): string {
  const totalH = Math.round(ms / H_MS)
  const d = Math.floor(totalH / 24)
  const h = totalH % 24
  return d > 0 ? `T+${d} d ${h} h` : `T+${h} h`
}

/** The engine throws RangeError for a cursor outside the ephemeris; the strip then just omits the readout. */
function readoutOrNull(compute: () => CursorReadout): CursorReadout | null {
  try {
    return compute()
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
    return null
  }
}

export function TimelinePanel() {
  const { cursorMs } = useScenario()
  const dispatch = useScenarioDispatch()
  const results = useScenarioResults()
  const range = useMemo(
    () => ({ startMs: results.slippedLandingMs, endMs: results.slippedLandingMs + results.durationH * H_MS }),
    [results.slippedLandingMs, results.durationH],
  )
  const slipMs = results.slippedLandingMs - results.baselineLandingMs
  // The baseline's x axis is time since landing: move it by the slip so the same mission phase lines up.
  const ghosts = useMemo<(DetectedWindows | undefined)[]>(
    () => results.sites.map((r) => (slipMs === 0 ? undefined : shiftWindows(r.baseline.windows, slipMs))),
    [results.sites, slipMs],
  )

  const strips = results.sites.map((r, i) => ({
    r,
    ghost: ghosts[i],
    readout: readoutOrNull(() => cursorReadout(r.ctx, cursorMs)),
  }))
  const valueText = [
    `${formatUtc(cursorMs)}, ${formatElapsed(cursorMs - range.startMs)} into the mission`,
    ...strips.map(({ r }) => {
      const { sunText, earthText } = eventTexts(r.slipped.windows, cursorMs)
      return `${r.site.name}: ${sunText}, ${earthText}`
    }),
  ].join('. ')

  return (
    <section aria-label="Timeline">
      <h3>Timeline</h3>
      {results.siteIds.length === 0 && (
        <p className="hint">Add a site to see its Sun and Earth visibility over the mission.</p>
      )}
      {strips.length > 0 && (
        <p className="hint num">
          Cursor {formatUtc(cursorMs)} · {formatElapsed(cursorMs - range.startMs)}
          {slipMs !== 0 && ' · faint bands: unslipped baseline, aligned by time since landing'}
        </p>
      )}
      <div className="timeline-plot">
        <div className="timeline-strips">
          {strips.map(({ r, ghost, readout }) => (
            <TimelineStrip
              key={r.site.id}
              siteName={r.site.name}
              windows={r.slipped.windows}
              ghost={ghost}
              range={range}
              cursorMs={cursorMs}
              readout={readout ?? undefined}
            />
          ))}
        </div>
        {strips.length > 0 && (
          <TimelineCursor
            range={range}
            cursorMs={cursorMs}
            onCursorChange={(ms) => dispatch({ type: 'setCursor', cursorMs: ms })}
            valueText={valueText}
          />
        )}
      </div>
      {results.unavailable.map((x) => (
        <p key={x.id} className="hint warn">
          No timeline for {x.name}: {x.reason}
        </p>
      ))}
    </section>
  )
}
