// Surface tab: standing at the focused lander, looking out at the real skyline with the Sun and Earth where the engine
// puts them. Lit / blocked follows the timeline's windows (so it can never disagree with it); the HUD also shows the
// visible fraction of the Sun's disk, since a half-visible disk can still count as "blocked" (threshold + hysteresis).
import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { bodyVectorKm, visibleDiskFraction } from '../../engine'
import { useTimeBar } from '../controls/time-bar'
import { bodyAt, surfaceTrack } from '../panorama/bodies'
import { PanoramaPanel } from '../panorama/panorama-panel'
import { missionTracks } from '../panorama/tracks'
import { HOUR_MS, useScenario } from '../state'
import { siteLetter } from '../ui/names'
import { useScenarioResults } from '../use-scenario-results'
import { brightLimbAngleRad, earthIlluminatedFraction } from './earth-phase'
import { SURFACE_EXAGGERATION } from './horizon-ring'
import type { SurfaceBody } from './surface-scene'
import { SceneErrorBoundary } from '../scene/scene-error-boundary'
import { hasWebGL } from '../scene/webgl'
import '../scene/scene.css'
import './surface.css'

const SurfaceScene = lazy(() => import('./surface-scene'))

const FOV_DEG = 50

const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

export function SurfaceView({ active }: { active: boolean }) {
  const [webgl] = useState(hasWebGL)
  const [engineering, setEngineering] = useState(false)
  // The cursor is controlled from the deck, in the 3D stage and in the 2D fallback alike.
  const twoD = (notice: ReactNode) => (
    <section className="surface-view" aria-label="Surface view">
      {notice}
      <PanoramaPanel />
    </section>
  )
  if (!webgl) {
    return twoD(
      <p className="hint warn" role="status">
        The 3D surface view needs WebGL 2, which this browser does not offer. Showing the 2D horizon view instead.
      </p>,
    )
  }
  if (engineering) {
    return twoD(
      <div className="surface-toolbar">
        <button type="button" onClick={() => setEngineering(false)}>
          Back to 3D surface view
        </button>
      </div>,
    )
  }
  return (
    <SceneErrorBoundary
      fallback={twoD(
        <p className="hint warn" role="status">
          The 3D surface view could not start on this device. Showing the 2D horizon view instead.
        </p>,
      )}
    >
      <SurfaceStage active={active} onEngineering={() => setEngineering(true)} />
    </SceneErrorBoundary>
  )
}

function SurfaceStage({ active, onEngineering }: { active: boolean; onEngineering: () => void }) {
  const timeBar = useTimeBar()
  const scenario = useScenario()
  const results = useScenarioResults()
  const { focusedSiteId } = scenario
  // A hidden Surface tab keeps its last frame instead of recomputing the bodies and HUD on every Play tick.
  const [cursorMs, setCursorMs] = useState(scenario.cursorMs)
  if (active && cursorMs !== scenario.cursorMs) setCursorMs(scenario.cursorMs)
  const focused = results.sites.find((r) => r.site.id === focusedSiteId) ?? null
  const [follow, setFollow] = useState(true)
  const [yaw, setYaw] = useState<number | null>(null)

  // --- bodies at the cursor (engine) -----------------------------------------------------------------------------
  const view = useMemo(() => {
    if (!focused) return null
    try {
      const { ctx, slipped } = focused
      const sun = bodyAt(ctx, 'sun', cursorMs, slipped.windows.sun)
      const earth = bodyAt(ctx, 'earth', cursorMs, slipped.windows.earth)
      const sunFraction = visibleDiskFraction(sun.elevDeg, sun.horizonDeg, sun.radiusDeg)
      const earthFraction = visibleDiskFraction(earth.elevDeg, earth.horizonDeg, earth.radiusDeg)
      const phase = earthIlluminatedFraction(bodyVectorKm(ctx.eph, 'sun', cursorMs), bodyVectorKm(ctx.eph, 'earth', cursorMs))
      const sunBody: SurfaceBody = sun
      const earthBody: SurfaceBody = { ...earth, illuminatedFraction: phase, brightLimbRad: brightLimbAngleRad(sun, earth) }
      return { sun: sunBody, earth: earthBody, sunFraction, earthFraction, phase }
    } catch (e) {
      if (e instanceof RangeError) return null // cursor outside the ephemeris
      throw e
    }
  }, [focused, cursorMs])

  // Tracks depend on the run, not the cursor.
  const { slippedLandingMs, durationH } = results
  const tracks = useMemo(() => {
    if (!focused) return undefined
    const endMs = slippedLandingMs + durationH * HOUR_MS
    const t = missionTracks(focused.slipped.samples, focused.slipped.windows, { startMs: slippedLandingMs, endMs })
    return { sun: surfaceTrack(t, 'sun'), earth: surfaceTrack(t, 'earth') }
  }, [focused, slippedLandingMs, durationH])

  // --- look direction: drag = yaw only; follows the Sun while playing -------------------------------------------
  const followActive = follow && timeBar.play.playing && view !== null
  const sunAz = view?.sun.azDeg ?? 0
  if (followActive && yaw !== sunAz) setYaw(sunAz)
  const yawDeg = yaw ?? sunAz // first look: toward the Sun
  const drag = useRef<{ x: number; yaw: number; width: number } | null>(null)
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    // The HUD buttons live inside the drag surface: a press on one is a click, not the start of a drag.
    if (e.target instanceof Element && e.target.closest('button')) return
    drag.current = { x: e.clientX, yaw: yawDeg, width: e.currentTarget.clientWidth || 1 }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (timeBar.play.playing) setFollow(false) // the user took over
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const aspect = d.width / (e.currentTarget.clientHeight || 1)
    const hFov = (2 * Math.atan(Math.tan((FOV_DEG * Math.PI) / 360) * aspect) * 180) / Math.PI
    setYaw(wrap360(d.yaw - ((e.clientX - d.x) / d.width) * hFov))
  }
  const onUp = () => {
    drag.current = null
  }
  // Keyboard look-around: ← / → turn 5° (15° with Shift), the same "user took over" rule as dragging.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const step = e.shiftKey ? 15 : 5
    setYaw(wrap360(yawDeg + (e.key === 'ArrowRight' ? step : -step)))
    if (timeBar.play.playing) setFollow(false)
  }

  // --- HUD text ---------------------------------------------------------------------------------------------------
  const siteIndex = results.siteIds.indexOf(focusedSiteId ?? '')
  const sunLine = view
    ? view.sun.visible
      ? `SUN LIT · ${(view.sunFraction * 100).toFixed(0)} % VISIBLE · el ${view.sun.elevDeg.toFixed(1)}°`
      : view.sun.elevDeg < view.sun.horizonDeg - view.sun.radiusDeg
        ? `SUN BLOCKED · ridge at az ${view.sun.azDeg.toFixed(0)}°, ${view.sun.horizonDeg >= 0 ? '+' : ''}${view.sun.horizonDeg.toFixed(1)}°`
        : `SUN BLOCKED · ${(view.sunFraction * 100).toFixed(0)} % VISIBLE (below the lit threshold)`
    : ''
  const earthLine = view
    ? view.earth.visible
      ? `EARTH IN VIEW · el ${view.earth.elevDeg.toFixed(1)}° · ${(view.phase * 100).toFixed(0)} % lit`
      : view.earth.elevDeg < view.earth.horizonDeg - view.earth.radiusDeg
        ? `EARTH BLOCKED · ridge at az ${view.earth.azDeg.toFixed(0)}°, ${view.earth.horizonDeg >= 0 ? '+' : ''}${view.earth.horizonDeg.toFixed(1)}°`
        : `EARTH OUT OF LINK · ${(view.earthFraction * 100).toFixed(0)} % VISIBLE (below the link margin)`
    : ''

  return (
    <section className="surface-view" aria-label="Surface view">
      <div
        className="surface-stage scene-stage"
        role="group"
        tabIndex={0}
        aria-label="Surface view. Use the left and right arrow keys to look around."
        onKeyDown={onKeyDown}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <p className="visually-hidden">{focused && view ? `View from ${focused.site.name}. ${sunLine}. ${earthLine}.` : 'No surface view available.'}</p>
        {focused && view ? (
          <Suspense fallback={<div className="scene-note-center" role="status"><div className="loader" aria-hidden="true" /><p className="muted">Loading 3D view…</p></div>}>
            <SurfaceScene
              active={active}
              maskDeg={focused.ctx.horizonMaskDeg}
              azStepDeg={focused.ctx.azStepDeg}
              sun={view.sun}
              earth={view.earth}
              tracks={tracks}
              yawDeg={yawDeg}
              fovDeg={FOV_DEG}
            />
          </Suspense>
        ) : (
          <div className="scene-note-center">
            <p className="hint">{focusedSiteId === null ? 'Add a site to stand on it.' : 'No surface view for this site at this time (outside the ephemeris or unavailable).'}</p>
          </div>
        )}

        {focused && (
          <div className="scene-hud scene-hud-tl surface-hud">
            <p className="surface-site">
              <span className="site-letter is-focused" aria-hidden="true">
                {siteLetter(siteIndex)}
              </span>
              {focused.site.name}
            </p>
            {view && (
              <>
                <p className={`surface-line num ${view.sun.visible ? 'is-up' : 'is-down'}`} data-body="sun">
                  {sunLine}
                </p>
                <p className={`surface-line num ${view.earth.visible ? 'is-up' : 'is-down'}`} data-body="earth">
                  {earthLine}
                </p>
              </>
            )}
          </div>
        )}
        <div className="scene-hud scene-hud-tr">
          <button type="button" onClick={onEngineering}>
            Engineering view (2D)
          </button>
          <button type="button" aria-pressed={follow} onClick={() => setFollow(!follow)} title="Turn the camera with the Sun while Play runs">
            Follow Sun while playing
          </button>
        </div>
        <div className="scene-hud scene-hud-bl">
          <p className="hint scene-honesty">
            Looking out from the lander · azimuth true, elevation ×{SURFACE_EXAGGERATION} · skyline = the site&apos;s own horizon mask · drag or use ← → to look around
          </p>
        </div>
      </div>
      <p className="hint scene-note">
        Dotted paths are the Sun (amber) and Earth (blue) over the whole mission, bright where lit / in view, with day marks. Fainter ridges in front are depth
        cues and always sit below the real skyline.
      </p>
    </section>
  )
}
