// Time bar for the 3D views: a scrubber for the shared cursor, Play with a speed choice, and a read-only slip readout.
// All state is the scenario's (cursor, slip), so every view follows it. The sidebar's slip slider stays the one slip
// control (Slice 1); the bar only shows the slip so a 3D view never needs the sidebar to say which date it is looking at.
import { useState } from 'react'
import { HOUR_MS, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'
import { usePlayCursor, type PlayCursor } from '../timeline/playback'
import { PauseIcon, PlayIcon } from '../ui/icons'
import { formatClock, formatDayShort, formatElapsed } from '../ui/names'
import { formatSlipH } from './slip-slider'
import './time-bar.css'

const SPEEDS = [
  { label: '1 h/s', hPerS: 1 },
  { label: '6 h/s', hPerS: 6 },
  { label: '1 d/s', hPerS: 24 },
] as const

export interface TimeBarController {
  play: PlayCursor
  speedIndex: number
  setSpeedIndex: (i: number) => void
}

/**
 * Play state and speed for a time bar; lives in the owning view so the view can react to Play (e.g. follow the Sun).
 * `active`: the view is showing (Play pauses while it is hidden). `canPlay`: there is something to see.
 */
export function useTimeBarController({ active, canPlay = true }: { active: boolean; canPlay?: boolean }): TimeBarController {
  const [speedIndex, setSpeedIndex] = useState(1)
  const play = usePlayCursor({ active, enabled: canPlay, speedHPerS: SPEEDS[speedIndex].hPerS })
  return { play, speedIndex, setSpeedIndex }
}

export function TimeBar({ controller, canPlay = true }: { controller: TimeBarController; canPlay?: boolean }) {
  const scenario = useScenario()
  const { slipH, cursorMs } = scenario
  const dispatch = useScenarioDispatch()
  const { play, speedIndex, setSpeedIndex } = controller
  const startMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)

  return (
    <section className="time-bar" aria-label="Time">
      <button type="button" className="play-button" onClick={play.toggle} disabled={!canPlay} aria-pressed={play.playing}>
        {play.playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
        {play.playing ? 'Pause' : 'Play'}
      </button>
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
      <span className="num cursor-readout" title="Set with the Slip slider in the sidebar">
        Slip {formatSlipH(slipH)}
      </span>
    </section>
  )
}
