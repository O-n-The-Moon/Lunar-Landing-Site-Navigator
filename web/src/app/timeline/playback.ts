// Play (#33): sweeps the shared scenario cursor through the slipped mission (SPEC-app P1 play). Used by the deck's time bar
// (a fixed number of mission hours per second; with no speed, a whole mission plays in PLAY_SECONDS).
import { useEffect, useRef, useState } from 'react'
import { HOUR_MS, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'

/** With no `speedHPerS`, a full mission plays in this many seconds, whatever its length. */
export const PLAY_SECONDS = 24

export interface PlayCursor {
  playing: boolean
  toggle: () => void
  stop: () => void
}

/**
 * `active`: the owning view is showing (Play pauses while it is hidden and resumes when it is shown again).
 * `enabled`: there is something to play (e.g. at least one site).
 * `speedHPerS`: mission hours per real second; omit for the whole-mission-in-24-s sweep.
 */
export function usePlayCursor({ active, enabled = true, speedHPerS }: { active: boolean; enabled?: boolean; speedHPerS?: number }): PlayCursor {
  const scenario = useScenario()
  const dispatch = useScenarioDispatch()
  const [requested, setRequested] = useState(false)
  const playing = requested && active && enabled
  const startMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)
  const { cursorMs } = scenario

  // Latest cursor for the animation loop, which must not restart on every frame.
  const cursorRef = useRef(cursorMs)
  // Cursor values this loop dispatched recently. React may commit one of them after the next animation frame, so a
  // cursor that is not on this list is a user move (drag / keys), not our own echo arriving late.
  const ownRef = useRef<number[]>([])
  const userMoveRef = useRef<number | null>(null)
  useEffect(() => {
    cursorRef.current = cursorMs
    if (!ownRef.current.includes(cursorMs)) userMoveRef.current = cursorMs
  }, [cursorMs])

  useEffect(() => {
    if (!playing) return
    const msPerSecond = speedHPerS === undefined ? (endMs - startMs) / PLAY_SECONDS : speedHPerS * HOUR_MS
    let t = cursorRef.current >= endMs ? startMs : cursorRef.current
    userMoveRef.current = null
    ownRef.current = []
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      // The user dragged or keyed the cursor since the last frame: continue from where they put it.
      if (userMoveRef.current !== null) {
        t = userMoveRef.current
        userMoveRef.current = null
      }
      // The first frame's timestamp can precede `performance.now()` (jsdom), so never step backwards.
      t = Math.min(endMs, t + (Math.max(0, now - last) / 1000) * msPerSecond)
      ownRef.current = [...ownRef.current.slice(-15), t]
      last = now
      dispatch({ type: 'setCursor', cursorMs: t })
      if (t >= endMs) setRequested(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, startMs, endMs, speedHPerS, dispatch])

  return { playing, toggle: () => setRequested(!playing), stop: () => setRequested(false) }
}
