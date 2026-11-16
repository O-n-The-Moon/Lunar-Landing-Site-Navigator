// Time control for the bottom deck: a scrubber for the shared cursor, Play with a speed choice. One controller for the
// whole app (`TimeBarProvider`), so the deck's Play drives every view and a view can react to it (Surface follows the
// Sun while it plays). All state is the scenario's (cursor, slip); the slip itself is the deck's slip slider.
import { createContext, createElement, useContext, useId, useState, type ReactNode } from 'react'
import { HOUR_MS, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'
import { usePlayCursor, type PlayCursor } from '../timeline/playback'
import { PauseIcon, PlayIcon } from '../ui/icons'
import { formatClock, formatDayShort, formatElapsed } from '../ui/names'
import './time-bar.css'

const SPEEDS = [
  { label: '1 h/s', hPerS: 1 },
  { label: '6 h/s', hPerS: 6 },
  { label: '1 d/s', hPerS: 24 },
] as const

export interface TimeBarController {
  play: PlayCursor
  /** Play can start: the owning views are showing and there is at least one site to look at. */
  canPlay: boolean
  /** A view that shows the cursor is open. */
  viewActive: boolean
  speedIndex: number
  setSpeedIndex: (i: number) => void
}

const TimeBarContext = createContext<TimeBarController | null>(null)

/**
 * Owns Play and its speed for the app. `active`: a view that shows the cursor is open (Play pauses while it is not,
 * i.e. on Verify, and resumes when a view is shown again).
 * `canPlay`: there is something to see (at least one site).
 */
export function TimeBarProvider({ active, canPlay = true, children }: { active: boolean; canPlay?: boolean; children: ReactNode }) {
  const [speedIndex, setSpeedIndex] = useState(1)
  const play = usePlayCursor({ active, enabled: canPlay, speedHPerS: SPEEDS[speedIndex].hPerS })
  // Not memoized: `play` is a new object each render (usePlayCursor reads the cursor), so a memo would never hit.
  const value = { play, canPlay: canPlay && active, viewActive: active, speedIndex, setSpeedIndex }
  return createElement(TimeBarContext.Provider, { value }, children)
}

export function useTimeBar(): TimeBarController {
  const c = useContext(TimeBarContext)
  if (!c) throw new Error('useTimeBar must be used inside <TimeBarProvider>')
  return c
}

export function TimeBar() {
  const scenario = useScenario()
  const { cursorMs } = scenario
  const dispatch = useScenarioDispatch()
  const { play, canPlay, viewActive, speedIndex, setSpeedIndex } = useTimeBar()
  const startMs = slippedLandingMs(scenario)
  const playHintId = useId()
  const endMs = missionEndMs(scenario)

  return (
    <section className="time-bar" aria-label="Time">
      <button
        type="button"
        className="play-button"
        onClick={play.toggle}
        disabled={!canPlay}
        aria-pressed={play.playing}
        aria-describedby={viewActive ? undefined : playHintId}
        title={viewActive ? undefined : 'Play runs in the 3D Terrain and Surface views'}
      >
        {play.playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
        {play.playing ? 'Pause' : 'Play'}
      </button>
      {!viewActive && (
        <span id={playHintId} className="visually-hidden">
          Play runs in the 3D Terrain and Surface views
        </span>
      )}
      <div className="time-bar-speeds" role="group" aria-label="Play speed">
        {SPEEDS.map((s, i) => (
          <button key={s.label} type="button" aria-pressed={i === speedIndex} onClick={() => setSpeedIndex(i)}>
            {s.label}
          </button>
        ))}
      </div>
      <label className="cursor-scrub">
        <span className="visually-hidden">Time in mission</span>
        <input
          type="range"
          min={startMs}
          max={endMs}
          step={HOUR_MS}
          value={cursorMs}
          aria-valuetext={`${formatElapsed(cursorMs - startMs)}, ${formatDayShort(cursorMs)} ${formatClock(cursorMs)} UTC`}
          onChange={(e) => dispatch({ type: 'setCursor', cursorMs: Number(e.target.value) })}
        />
      </label>
      <span className="num cursor-readout">
        {formatElapsed(cursorMs - startMs)} · {formatDayShort(cursorMs)} {formatClock(cursorMs)} UTC
      </span>
    </section>
  )
}
