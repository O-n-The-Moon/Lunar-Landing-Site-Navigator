// The one set of colour ramps for percent layers (0–100), shared by the 2D opportunity map and the 3D terrain
// overlays so a layer looks the same in both. Dark at 0 % to bright at 100 %, so "more light / more Earth" reads as
// brighter; the hue tells the layers apart: Sun = amber, Earth = blue, Both = green. Pure: no React, no DOM.

export type RampName = 'sun' | 'earth' | 'both'
type Rgb = readonly [number, number, number]

const RAMP_STOPS: Record<RampName, readonly Rgb[]> = {
  sun: [
    [20, 24, 34],
    [124, 72, 22],
    [255, 214, 102],
  ],
  earth: [
    [20, 24, 34],
    [18, 92, 142],
    [130, 224, 255],
  ],
  both: [
    [20, 24, 34],
    [18, 112, 82],
    [150, 245, 200],
  ],
}

/** Colour of a percentage (clamped to 0–100) on the ramp. Not for NaN: use {@link rampRgb} where data can be missing. */
export function rampColor(ramp: RampName, pct: number): [number, number, number] {
  const stops = RAMP_STOPS[ramp]
  const t = Math.min(1, Math.max(0, pct / 100)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(t))
  const f = t - i
  const a = stops[i]
  const b = stops[i + 1]
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number]
}

/** Like {@link rampColor}, but null for NaN (no data), so callers can leave the cell transparent. */
export function rampRgb(ramp: RampName, pct: number): [number, number, number] | null {
  return Number.isNaN(pct) ? null : rampColor(ramp, pct)
}

/** CSS gradient of the ramp, for the legend bar. */
export function rampCss(ramp: RampName): string {
  const stops = RAMP_STOPS[ramp].map((_, i, all) => {
    const pct = (i / (all.length - 1)) * 100
    const [r, g, b] = rampColor(ramp, pct)
    return `rgb(${r}, ${g}, ${b}) ${pct}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}
