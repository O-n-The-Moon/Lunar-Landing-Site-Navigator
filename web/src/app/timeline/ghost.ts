// The unslipped baseline ("ghost") drawn under a slipped strip. The strip's x axis is time since landing, so the
// baseline's windows are moved by the slip: the same mission phase lines up, and a faint band with no solid band on
// top of it is time the slip lost.
import type { DetectedWindows, Window } from '../../engine'

const shift = (ws: Window[], deltaMs: number): Window[] =>
  ws.map((w) => ({ ...w, startMs: w.startMs + deltaMs, endMs: w.endMs + deltaMs }))

/** `windows` with every edge moved by `deltaMs` (clip flags kept). Pure: the input is not changed. */
export function shiftWindows(windows: DetectedWindows, deltaMs: number): DetectedWindows {
  return { sun: shift(windows.sun, deltaMs), earth: shift(windows.earth, deltaMs), both: shift(windows.both, deltaMs) }
}
