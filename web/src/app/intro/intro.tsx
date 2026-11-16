// Intro overlay (plan S2-4): a ~4 s fly-in to the south pole with a boot log, over the console while it loads.
// The console is mounted underneath the whole time (inert), so the terrain, the shadow grid and the first scoring all
// download and build during the intro; nothing is fetched twice and nothing waits for it to end.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { bodyVectorKm, type Vec3 } from '../../engine'
import { useCoreData, useGrid, useTerrainHeights } from '../data'
import { SceneErrorBoundary } from '../scene/scene-error-boundary'
import { directionToWorld } from '../scene/world'
import { useScenario } from '../state'
import { bootLines, FADE_MS, INTRO_MS, visibleBootLines, type BootCounts } from './intro-rules'
import './intro.css'

const IntroScene = lazy(() => import('./intro-scene'))

const FALLBACK_SUN: Vec3 = [0.8, 0.05, -0.6]
const TICK_MS = 100

/** Counts for the boot log, from what is loaded right now. */
function useBootCounts(): BootCounts {
  const { ephemerisManifest, sitesFile } = useCoreData()
  const { state: heights } = useTerrainHeights()
  const { state: grid } = useGrid(false) // read-only: the 3D view decides when the horizon grid starts
  return {
    epochs: ephemerisManifest.count,
    stepS: ephemerisManifest.stepS,
    sites: sitesFile.sites.length,
    terrainGrid: heights.status === 'ready' ? { nx: heights.data.frame.nx, ny: heights.data.frame.ny, cellKm: heights.data.frame.cellKm } : null,
    horizons:
      grid.status === 'ready'
        ? { status: 'ready', azBins: grid.data.manifest.azBins }
        : grid.status === 'loading'
          ? { status: 'loading', progress: grid.progress }
          : grid.status === 'error'
            ? { status: 'error' }
            : { status: 'idle' },
  }
}

/** Direction to the real Sun from the pole at the scenario's time cursor, in scene coordinates. */
function useSunDir(): Vec3 {
  const { ephemeris } = useCoreData()
  const { cursorMs } = useScenario()
  return useMemo(() => {
    try {
      return directionToWorld(bodyVectorKm(ephemeris, 'sun', cursorMs))
    } catch (e) {
      if (e instanceof RangeError) return FALLBACK_SUN
      throw e
    }
  }, [ephemeris, cursorMs])
}

/** Makes the page behind the overlay unreachable (keyboard, pointer, screen readers) while it plays. */
function useInertSiblings(el: HTMLElement | null) {
  useEffect(() => {
    const parent = el?.parentElement
    if (!el || !parent) return
    // Only what this overlay made inert is restored, so something that was already inert stays so.
    const others = Array.from(parent.children).filter((c) => c !== el && !c.hasAttribute('inert'))
    for (const c of others) c.setAttribute('inert', '')
    return () => {
      for (const c of others) c.removeAttribute('inert')
    }
  }, [el])
}

export function Intro({ onDone }: { onDone: () => void }) {
  const [startedAt] = useState(() => performance.now())
  const [elapsed, setElapsed] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const counts = useBootCounts()
  const sunDir = useSunDir()
  useInertSiblings(root)

  // The end is a timer of its own, so a slow 3D chunk or a stalled texture can never hold the app back.
  useEffect(() => {
    const done = window.setTimeout(onDone, INTRO_MS)
    const fade = window.setTimeout(() => setLeaving(true), INTRO_MS - FADE_MS) // its own timer: a 100 ms tick could cut the fade short
    const tick = window.setInterval(() => setElapsed(performance.now() - startedAt), TICK_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(done)
      window.clearTimeout(fade)
      window.clearInterval(tick)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDone, startedAt])

  const lines = visibleBootLines(bootLines(counts), elapsed)
  return (
    <div ref={setRoot} className={`intro${leaving ? ' intro-leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Introduction">
      <div className="intro-canvas" aria-hidden="true">
        <SceneErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <IntroScene startedAt={startedAt} sunDir={sunDir} />
          </Suspense>
        </SceneErrorBoundary>
      </div>
      <div className="intro-title">
        <p className="intro-kicker">Lunar Landing Site Navigator</p>
        <p className="intro-lede">The Moon&apos;s south pole: the Sun skims the horizon, so mountains cast shadows hundreds of kilometres long.</p>
      </div>
      <ol className="intro-log num" aria-label="Loading status">
        {lines.map((l) => (
          <li key={l.atMs}>{l.text}</li>
        ))}
      </ol>
      <button type="button" className="intro-skip" onClick={onDone} autoFocus>
        Skip <span className="muted">Esc</span>
      </button>
    </div>
  )
}
