// Timeline strips, one per scenario site, over the slipped mission window (SPEC-app P0-4). One cursor, shared by
// every strip, is the scenario cursor. When the slip is not 0, each strip also shows a faint ghost of its
// unslipped baseline so a loss from the slip is visible at a glance.
import { useMemo } from 'react'
import type { DetectedWindows } from '../../engine'
import { HOUR_MS, useScenario, useScenarioDispatch } from '../state'
import { useScenarioResults } from '../use-scenario-results'
import { formatUtc } from '../controls/date-controls'
import { PauseIcon, PlayIcon } from '../ui/icons'
import { cursorReadout } from './cursor-readout'
import { shiftWindows } from './ghost'
import { usePlayCursor } from './playback'
import { TimelineCursor } from './timeline-cursor'
import { TimelineStrip, eventTexts } from './timeline-strip'
import './timeline.css'

/** "T+6 h 20 m" / "T+1 d 6 h 0 m": time since the (slipped) landing, to the minute. */
function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  return `T+${d > 0 ? `${d} d ` : ''}${h} h ${totalMin % 60} m`
}

/**
 * `active`: the tab holding the timeline is showing (Play pauses while it is hidden).
 * `showPlay`: this panel has its own Play button; the Details drawer turns it off (the deck's Play is the one time control).
 */
export function TimelinePanel({ active = true, showPlay = true }: { active?: boolean; showPlay?: boolean }) {
  const { cursorMs } = useScenario()
  const dispatch = useScenarioDispatch()
  const results = useScenarioResults()
  const play = usePlayCursor({ active, enabled: showPlay && results.siteIds.length > 0 })
  const range = useMemo(
    () => ({ startMs: results.slippedLandingMs, endMs: results.slippedLandingMs + results.durationH * HOUR_MS }),
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
    // Inside the ephemeris by construction: the reducer keeps the cursor in the mission, which `useScenarioResults` only
    // evaluates inside coverage. A RangeError here would be a real data bug, so let it surface.
    readout: cursorReadout(r.ctx, cursorMs),
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
      {showPlay && results.siteIds.length > 0 && (
        <button type="button" className="play-button" onClick={play.toggle} aria-pressed={play.playing}>
          {play.playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />} {play.playing ? 'Pause' : 'Play'}
        </button>
      )}
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
              readout={readout}
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
