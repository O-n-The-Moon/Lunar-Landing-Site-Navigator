// Play (#33): sweeps the shared scenario cursor through the slipped mission (SPEC-app P1 play). Used by the Compare tab's
// timeline panel (a whole mission in 24 s) and by the 3D views' time bar (a fixed number of mission hours per second).
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
  useEffect(() => {
    cursorRef.current = cursorMs
  }, [cursorMs])

  useEffect(() => {
    if (!playing) return
    const msPerSecond = speedHPerS === undefined ? (endMs - startMs) / PLAY_SECONDS : speedHPerS * HOUR_MS
    let t = cursorRef.current >= endMs ? startMs : cursorRef.current
    let sent = NaN
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      // The user dragged or keyed the cursor since the last frame: continue from where they put it.
      if (!Number.isNaN(sent) && cursorRef.current !== sent) t = cursorRef.current
      t = Math.min(endMs, t + ((now - last) / 1000) * msPerSecond)
      sent = t
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
