// Intro fly-in (SPEC-app → Layout, plan S2-4): when it plays, how long, the camera path and the boot log.
// Pure functions only, so the skip rules and the timing are testable without a browser or WebGL.

/** Whole intro, from mount to hand-over. The plan's budget is ≤ 4.5 s. */
export const INTRO_MS = 4000
/** The last part of the intro is a fade into the console. */
export const FADE_MS = 500
/** The camera arrives at the pole before the fade starts. */
export const FLY_MS = INTRO_MS - FADE_MS

export interface IntroConditions {
  /** `window.location.search`. `?nointro` (any value) skips the intro. */
  search: string
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean
  /** The intro is a 3D globe; without WebGL there is nothing to show. */
  webgl: boolean
  /** Synthetic fixture data: a fly-in over made-up data would be misleading, so there is none. */
  fixtures: boolean
}

export function shouldPlayIntro({ search, reducedMotion, webgl, fixtures }: IntroConditions): boolean {
  if (reducedMotion || !webgl || fixtures) return false
  return !new URLSearchParams(search).has('nointro')
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)

export interface IntroCamera {
  /** Camera latitude over the Moon (south positive here: 90 = straight above the south pole), degrees. */
  elevDeg: number
  /** Heading around the pole, degrees. */
  headingDeg: number
  /** Distance from the Moon's centre, km. */
  distKm: number
}

const START: IntroCamera = { elevDeg: 14, headingDeg: -70, distKm: 9500 }
const END: IntroCamera = { elevDeg: 78, headingDeg: 0, distKm: 4600 }

/** Camera at `elapsedMs`: an orbit that climbs over the south pole, easing in and out, holding at the end. */
export function introCamera(elapsedMs: number): IntroCamera {
  const e = smootherstep(clamp01(elapsedMs / FLY_MS))
  const mix = (a: number, b: number) => a + (b - a) * e
  return { elevDeg: mix(START.elevDeg, END.elevDeg), headingDeg: mix(START.headingDeg, END.headingDeg), distKm: mix(START.distKm, END.distKm) }
}

/** What the boot log can say, read from the loaded data (never typed in). */
export interface BootCounts {
  epochs: number
  stepS: number
  sites: number
  /** The 2 km height grid, once loaded. */
  terrainGrid: { nx: number; ny: number; cellKm: number } | null
  /** The horizon grid (the ~12 MB shadow data): not requested yet, downloading (0–1, or null if unknown), loaded, or failed. */
  horizons: { status: 'idle' } | { status: 'loading'; progress: number | null } | { status: 'ready'; azBins: number } | { status: 'error' }
}

export interface BootLine {
  /** Appears this long after the intro starts. */
  atMs: number
  text: string
}

const n = (x: number) => x.toLocaleString('en-US')

export function bootLines(c: BootCounts): BootLine[] {
  const stepH = c.stepS / 3600
  const horizons =
    c.horizons.status === 'ready'
      ? `HORIZONS · ${c.horizons.azBins} azimuth bins per cell · ready`
      : c.horizons.status === 'loading'
        ? `HORIZONS · downloading${c.horizons.progress === null ? '' : ` ${Math.round(c.horizons.progress * 100)} %`}`
        : c.horizons.status === 'error'
          ? 'HORIZONS · could not load'
          : 'HORIZONS · queued'
  return [
    { atMs: 0, text: `EPHEMERIS · ${n(c.epochs)} epochs · ${stepH} h steps` },
    { atMs: 500, text: `SITES · ${c.sites} curated` },
    { atMs: 1000, text: c.terrainGrid ? `TERRAIN · ${c.terrainGrid.nx}×${c.terrainGrid.ny} cells · ${c.terrainGrid.cellKm} km` : 'TERRAIN · loading' },
    { atMs: 1500, text: horizons },
  ]
}

/** The lines that are visible `elapsedMs` into the intro. */
export function visibleBootLines(lines: BootLine[], elapsedMs: number): BootLine[] {
  return lines.filter((l) => l.atMs <= elapsedMs)
}
