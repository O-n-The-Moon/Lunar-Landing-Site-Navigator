// 3D Terrain tab: the south pole as a lit 3D surface, with live terrain-aware shadows that follow the cursor and
// slip, site beacons coloured by what the timeline says, the Sun and Earth rays, and overlays from the 2D map.
// Everything physical comes from the engine (ephemeris vectors, `illuminationAt`, the site windows); the 3D scene only
// draws it. Loads in stages: 2 km heights first, then the 1024² display terrain, then the horizon grid for shadows.
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { bodyVectorKm, illuminationAt, MOON_RADIUS_KM, nearestGridCell, type Grid, type SiteContext, type Vec3 } from '../../engine'
import { useCoreData, useDisplayTerrain, useGrid, usePgdaLayers, useTerrainHeights } from '../data'
import { rampCss } from '../map/colormaps'
import { MapView } from '../map/map-view'
import { pgdaToGridOrder } from '../map/pgda-raster'
import { useWindowScores, windowScoresToShow } from '../map/score-layer'
import { usePgdaValues } from '../map/use-pgda-values'
import { bodyAt } from '../panorama/bodies'
import { MAX_SITES, customSiteId, missionEndMs, slippedLandingMs, useScenario, useScenarioDispatch } from '../state'
import type { TerrainField } from '../terrain-data'
import { siteLetter, splitSiteName } from '../ui/names'
import { formatLatDeg, formatLonDeg, missionInCoverage, useScenarioResults, type SiteResult } from '../use-scenario-results'
import { Compass, type CompassBody } from './compass'
import { SceneErrorBoundary } from './scene-error-boundary'
import { latLonToKm } from './frame'
import type { CameraGoal, SceneBeacon, SceneTexture } from './ops-scene'
import { OVERLAYS } from './overlay-layers'
import { illuminationToRgba, percentToRgba, sameSquare } from './overlay-textures'
import { signalAt } from './site-status'
import { buildTerrainSteps, type BuiltTerrain } from './terrain-build'
import { sampleHeightM, TERRAIN_EXAGGERATION } from './terrain-mesh'
import { directionToWorld, surfaceWorld } from './world'
import { hasWebGL } from './webgl'
import './scene.css'

const OpsScene = lazy(() => import('./ops-scene'))

const OVERVIEW_DISTANCE_KM = 415
const SITE_DISTANCE_KM = 40
const POLE_MOON: Vec3 = [0, 0, -MOON_RADIUS_KM]

type View = { kind: 'overview'; nonce: number } | { kind: 'site'; siteId: string; nonce: number }

/**
 * The drawable terrain for a height field, built in small steps with a yield between them (see `terrain-build.ts`), so
 * the page never freezes for the whole 1024² build. Keeps showing the previous terrain until the next one is done.
 */
function useBuiltTerrain(field: TerrainField | null): BuiltTerrain | null {
  const [built, setBuilt] = useState<BuiltTerrain | null>(null)
  useEffect(() => {
    if (!field) return
    const steps = buildTerrainSteps(field)
    let timer = 0
    const run = () => {
      const r = steps.next()
      if (r.done) setBuilt(r.value)
      else timer = window.setTimeout(run, 0)
    }
    timer = window.setTimeout(run, 0)
    return () => window.clearTimeout(timer)
  }, [field])
  return built
}

/** Direction from a MOON_ME observer position to a body, in world coordinates (null outside the ephemeris). */
function bodyDirWorld(eph: Parameters<typeof bodyVectorKm>[0], body: 'sun' | 'earth', tMs: number, from: Vec3): Vec3 | null {
  try {
    const v = bodyVectorKm(eph, body, tMs)
    return directionToWorld([v[0] - from[0], v[1] - from[1], v[2] - from[2]])
  } catch (e) {
    if (e instanceof RangeError) return null
    throw e
  }
}

function useIlluminationTexture(grid: Grid | null, terrain: BuiltTerrain | null, eph: Parameters<typeof bodyVectorKm>[0], tMs: number): SceneTexture | null {
  return useMemo(() => {
    if (!grid || !terrain || !sameSquare(grid.manifest, terrain.field.frame)) return null
    try {
      return { rgba: illuminationToRgba(illuminationAt(grid, eph, tMs)), nx: grid.manifest.nx, ny: grid.manifest.ny }
    } catch (e) {
      if (e instanceof RangeError) return null // cursor outside the ephemeris
      throw e
    }
  }, [grid, terrain, eph, tMs])
}

function compassAt(focused: SiteResult | null, tMs: number): { sun: CompassBody | null; earth: CompassBody | null } {
  if (!focused) return { sun: null, earth: null }
  try {
    const pick = (b: ReturnType<typeof bodyAt>): CompassBody => ({ azDeg: b.azDeg, elevDeg: b.elevDeg, visible: b.visible })
    return {
      sun: pick(bodyAt(focused.ctx, 'sun', tMs, focused.slipped.windows.sun)),
      earth: pick(bodyAt(focused.ctx, 'earth', tMs, focused.slipped.windows.earth)),
    }
  } catch (e) {
    if (e instanceof RangeError) return { sun: null, earth: null }
    throw e
  }
}

const SHOW_2D_ID = 'terrain-show-2d'
const BACK_TO_3D_ID = 'terrain-back-to-3d'

/** Moves focus once the control that was used has been hidden (it would fall to <body> otherwise). */
function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus())
}

export function TerrainView({ active }: { active: boolean }) {
  const [webgl] = useState(hasWebGL)
  // "2D": the opportunity map in place of the scene, for exact hover values. The scene stays mounted (frozen, like a
  // hidden tab), so coming back costs no rebuild.
  const [twoD, setTwoD] = useState(false)
  const fallback = (why: string) => (
    <div className="terrain-fallback">
      <p className="hint warn" role="status">
        {why} Showing the 2D opportunity map instead.
      </p>
      <MapView active={active} />
    </div>
  )
  if (!webgl) return fallback('3D view needs WebGL 2, which this browser does not offer.')
  const toggle = (next: boolean) => {
    setTwoD(next)
    focusSoon(next ? BACK_TO_3D_ID : SHOW_2D_ID)
  }
  return (
    <SceneErrorBoundary fallback={fallback('The 3D view could not start on this device.')}>
      <TerrainStage active={active && !twoD} hidden={twoD} onShow2D={() => toggle(true)} />
      {twoD && (
        <section className="terrain-2d" aria-label="2D opportunity map">
          <button id={BACK_TO_3D_ID} type="button" onClick={() => toggle(false)}>
            Back to 3D
          </button>
          <MapView active={active} />
        </section>
      )}
    </SceneErrorBoundary>
  )
}

function TerrainStage({ active, hidden, onShow2D }: { active: boolean; hidden: boolean; onShow2D: () => void }) {
  const { ephemeris, sitesFile } = useCoreData()
  const scenario = useScenario()
  const dispatch = useScenarioDispatch()
  const results = useScenarioResults()
  const { cursorMs, focusedSiteId } = scenario
  // While this tab is hidden (Play runs on another tab) the scene keeps the last time it showed: no illumination
  // recompute, no ray/beacon churn, and the canvas stops rendering.
  const [shownMs, setShownMs] = useState(cursorMs)
  if (active && shownMs !== cursorMs) setShownMs(cursorMs)

  // --- staged loading: 2 km heights → display terrain → horizon grid -----------------------------------------------
  const { state: heights, retry: retryHeights } = useTerrainHeights()
  const display = useDisplayTerrain(heights.status === 'ready')
  const displaySettled = display.status === 'ready' || display.status === 'error'
  const { state: gridState, retry: retryGrid } = useGrid(displaySettled)
  const grid = gridState.status === 'ready' ? gridState.data : null
  const field = display.status === 'ready' ? display.data : heights.status === 'ready' ? heights.data : null
  const terrain = useBuiltTerrain(field)

  // --- overlays ------------------------------------------------------------------------------------------------
  const [overlayId, setOverlayId] = useState<(typeof OVERLAYS)[number]['id'] | null>(null)
  const overlay = OVERLAYS.find((o) => o.id === overlayId) ?? null
  // PGDA loads only when a PGDA overlay is picked (review item 11); scores come from the one shared scoring job.
  const { state: pgdaState } = usePgdaLayers(overlay?.source === 'pgda')
  const pgda = pgdaState.status === 'ready' ? pgdaState.data : null
  const pgdaRaster = usePgdaValues(pgda && overlay?.source === 'pgda' ? pgda.urls[overlay.id === 'pgda-earth' ? 'earth' : 'sun'] : undefined)
  const windowWanted = active && overlay?.source === 'window' && missionInCoverage(ephemeris, slippedLandingMs(scenario), scenario.durationH)
  const scores = useWindowScores(windowWanted)
  const landingMs = slippedLandingMs(scenario)
  const endMs = missionEndMs(scenario)
  const inCoverage = missionInCoverage(ephemeris, landingMs, scenario.durationH)
  const { scores: shownScores, stale: scoresStale } = useMemo(
    () => windowScoresToShow(scores, landingMs, endMs, inCoverage),
    [scores, landingMs, endMs, inCoverage],
  )
  const overlayTexture = useMemo((): SceneTexture | null => {
    if (!overlay || !terrain) return null
    let frame: { originKm: readonly [number, number]; cellKm: number; nx: number; ny: number } | null = null
    let values: Float32Array | null = null
    if (overlay.source === 'pgda') {
      if (pgda && pgdaRaster) {
        frame = pgda.manifest
        values = pgdaToGridOrder(pgdaRaster, pgda.manifest.nx, pgda.manifest.ny) // PNG row order → grid order, or it is flipped
      }
    } else if (grid && shownScores) {
      frame = grid.manifest
      values = overlay.id === 'score-sun' ? shownScores.sunPct : overlay.id === 'score-earth' ? shownScores.earthPct : shownScores.bothPct
    }
    if (!frame || !values || !sameSquare(frame, terrain.field.frame)) return null
    return { rgba: percentToRgba(values, overlay.ramp), nx: frame.nx, ny: frame.ny }
  }, [overlay, terrain, pgda, pgdaRaster, grid, shownScores])

  // --- live shadows and lighting ---------------------------------------------------------------------------------
  // Deferred: a slip step or a cursor drag renders first; the ~33k-cell illumination and its texture upload follow.
  const shadowMs = useDeferredValue(shownMs)
  const shadow = useIlluminationTexture(grid, terrain, ephemeris, shadowMs)
  const lightDir = bodyDirWorld(ephemeris, 'sun', shownMs, POLE_MOON)

  // --- beacons -------------------------------------------------------------------------------------------------
  const geo = heights.status === 'ready' ? heights.data : null // stable height source for camera targets
  const baseFor = (field: TerrainField | null, latDeg: number, lonDeg: number): Vec3 => {
    const f = field?.frame
    let hM = 0
    if (field && f) {
      const { xKm, yKm } = latLonToKm(f, latDeg, lonDeg)
      hM = sampleHeightM(field.heightM, f.nx, f.ny, (xKm - f.originKm[0]) / f.cellKm - 0.5, (yKm - f.originKm[1]) / f.cellKm - 0.5)
    }
    return surfaceWorld(latDeg, lonDeg, (hM / 1000) * TERRAIN_EXAGGERATION)
  }
  const sites = scenario.sites.map((ref, index) => {
    const curated = ref.kind === 'curated' ? sitesFile.sites.find((s) => s.id === ref.id) : undefined
    const latDeg = ref.kind === 'custom' ? ref.latDeg : (curated?.latDeg ?? NaN)
    const lonDeg = ref.kind === 'custom' ? ref.lonDeg : (curated?.lonDeg ?? NaN)
    const result = results.sites.find((r) => r.site.id === ref.id)
    return { ref, index, latDeg, lonDeg, result, name: result?.site.name ?? curated?.name ?? ref.id }
  })
  const beacons: SceneBeacon[] = terrain
    ? sites.flatMap((s) => {
        if (!s.result || !Number.isFinite(s.latDeg)) return []
        const { signal, sunUp, earthUp } = signalAt(s.result.slipped, shownMs)
        return [
          {
            id: s.ref.id,
            letter: siteLetter(results.siteIds.indexOf(s.ref.id)),
            name: splitSiteName(s.name).short,
            base: baseFor(terrain.field, s.latDeg, s.lonDeg),
            signal,
            sunUp,
            earthUp,
            focused: s.ref.id === focusedSiteId,
          },
        ]
      })
    : []
  const focused = results.sites.find((r) => r.site.id === focusedSiteId) ?? null
  const focusedBeacon = beacons.find((b) => b.focused) ?? null

  // --- camera goal: overview until the user focuses a site (or asks for the overview again) ------------------------
  const [view, setView] = useState<View>({ kind: 'overview', nonce: 0 })
  const [lastFocus, setLastFocus] = useState(focusedSiteId)
  if (lastFocus !== focusedSiteId) {
    setLastFocus(focusedSiteId)
    if (focusedSiteId && view.kind === 'site') setView({ kind: 'site', siteId: focusedSiteId, nonce: view.nonce + 1 })
  }
  const goal = useMemo((): CameraGoal => {
    if (view.kind === 'site') {
      const s = sites.find((x) => x.ref.id === view.siteId)
      if (s && Number.isFinite(s.latDeg)) return { target: baseFor(geo, s.latDeg, s.lonDeg), distanceKm: SITE_DISTANCE_KM, nonce: view.nonce }
    }
    return { target: [0, 0, 0], distanceKm: OVERVIEW_DISTANCE_KM, nonce: view.nonce }
    // `sites` and `baseFor` are rebuilt every render; the view and the stable 2 km heights are what move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, geo])

  const focusSite = (id: string) => {
    dispatch({ type: 'focusSite', id })
    setView((v) => ({ kind: 'site', siteId: id, nonce: v.nonce + 1 }))
  }

  // --- rays and compass: from the focused site, so a ridge in the way is visible ---------------------------------
  const ctx: SiteContext | null = focused?.ctx ?? null
  const rayFrom: Vec3 = ctx ? ctx.frame.positionKm : POLE_MOON
  const sunDir = bodyDirWorld(ephemeris, 'sun', shownMs, rayFrom)
  const earthDir = bodyDirWorld(ephemeris, 'earth', shownMs, rayFrom)
  const rayOrigin: Vec3 = focusedBeacon ? [focusedBeacon.base[0], focusedBeacon.base[1] + 10, focusedBeacon.base[2]] : [0, 0, 0]
  const compass = compassAt(focused, shownMs)

  // --- click terrain → custom site (same flow as the 2D map) --------------------------------------------------
  const [message, setMessage] = useState<string | null>(null)
  const pick = (latDeg: number, lonDeg: number) => {
    if (!grid) return setMessage('The terrain grid is still loading.')
    let cell
    try {
      cell = nearestGridCell(grid, latDeg, lonDeg)
    } catch (e) {
      if (e instanceof RangeError) return setMessage('No terrain data at that spot.')
      throw e
    }
    if (!cell) return setMessage('No terrain data at that spot.')
    if (scenario.sites.some((s) => s.id === customSiteId(cell))) return setMessage('That grid cell is already in the scenario.')
    if (scenario.sites.length >= MAX_SITES) return setMessage(`The scenario already has ${MAX_SITES} sites. Remove one first.`)
    dispatch({ type: 'addCustomSite', latDeg, lonDeg, cell })
    setMessage(`Added custom site ${formatLatDeg(latDeg)} ${formatLonDeg(lonDeg)} (snapped ${cell.snapDistKm.toFixed(1)} km).`)
  }

  // --- text ------------------------------------------------------------------------------------------------------
  const summary =
    beacons.length === 0
      ? 'No sites on the pole.'
      : beacons.map((b) => `${b.letter} ${b.name}: ${b.signal === 'both' ? 'power and comms' : b.signal === 'sun' ? 'power only' : b.signal === 'earth' ? 'comms only' : 'no power, no comms'}`).join('. ')
  const terrainLabel =
    terrain?.field.source === 'display'
      ? `Terrain: LOLA 80 m DEM, resampled · ×${TERRAIN_EXAGGERATION} vertical · display only; shadows use the 2 km horizon grid, site status uses each site's own horizon`
      : `Terrain: LOLA 2 km grid · ×${TERRAIN_EXAGGERATION} vertical · display only`
  const status = [
    heights.status === 'error' && `Could not load terrain heights: ${heights.message}`,
    overlay?.source === 'pgda' && pgdaState.status === 'loading' && 'Loading PGDA layer…',
    overlay?.source === 'pgda' && pgdaState.status === 'error' && `Could not load the PGDA layer: ${pgdaState.message}`,
    display.status === 'loading' && 'Loading terrain detail…',
    display.status === 'error' && 'Terrain detail is unavailable; showing the 2 km terrain.',
    gridState.status === 'loading' && 'Loading terrain shadows…',
    gridState.status === 'error' && `Could not load the terrain grid: ${gridState.message}`,
    overlay?.source === 'window' && scoresStale && scores.status !== 'computing' && 'Showing the previous window; the new one is scored a moment after the window stops changing.',
    overlay?.source === 'window' && scores.status === 'computing' && `Scoring ${Math.round(scores.progress * 100)} %`,
    overlay?.source === 'window' && !windowWanted && 'The mission window is outside the ephemeris, so there is nothing to score.',
    overlay?.source === 'window' && scores.status === 'unsupported' && 'Window scores need Web Workers, which this browser lacks.',
  ].filter(Boolean) as string[]
  const shadowsOn = !overlay

  return (
    <section className="terrain-view" aria-label="3D terrain" hidden={hidden}>
      <div className="scene-stage" role="group" aria-label="3D view of the lunar south pole">
        <p className="visually-hidden">{summary}</p>
        {terrain ? (
          <Suspense fallback={<StageNote text="Loading 3D view…" />}>
            <OpsScene
              active={active}
              frame={terrain.field.frame}
              mesh={terrain.mesh}
              normals={terrain.normals}
              shadow={shadowsOn ? shadow : null}
              overlay={overlay ? overlayTexture : null}
              sunDir={sunDir}
              earthDir={earthDir}
              lightDir={lightDir}
              rayOrigin={rayOrigin}
              beacons={beacons}
              goal={goal}
              onFocus={focusSite}
              onPickTerrain={pick}
            />
          </Suspense>
        ) : (
          <StageNote text={heights.status === 'error' ? 'Terrain unavailable.' : 'Loading terrain…'} />
        )}

        <div className="scene-hud scene-hud-tl">
          <div className="segmented" role="group" aria-label="Terrain overlay">
            <button type="button" aria-pressed={shadowsOn} onClick={() => {
                setOverlayId(null)
                setMessage(null)
              }} title="Terrain-aware shadows at the cursor time">
              Live shadows
            </button>
            {OVERLAYS.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={overlayId === o.id}
                title={o.title}
                onClick={() => {
                  setOverlayId(o.id)
                  setMessage(null)
                  dispatch({ type: 'setMapLayer', layer: o.id })
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {overlay ? (
            <div className="scene-legend">
              <span className="legend-ramp" style={{ background: rampCss(overlay.ramp) }} />
              <span className="legend-labels num">
                <span>0 %</span>
                <span>50 %</span>
                <span>100 %</span>
              </span>
              <span className="hint">
                {overlay.title}
                {overlay.source === 'window' && ' · grid-approximate (2 km grid)'}
              </span>
            </div>
          ) : (
            <p className="hint scene-legend">
              Dark = shadow, light = sunlit. Amber ray = Sun, blue ray = Earth.
            </p>
          )}
        </div>

        <div className="scene-hud scene-hud-tr">
          <Compass sun={compass.sun} earth={compass.earth} label={focused ? `Compass at ${focused.site.name}` : 'Compass'} />
          <button type="button" onClick={() => setView((v) => ({ kind: 'overview', nonce: v.nonce + 1 }))}>
            Reset view
          </button>
          <button id={SHOW_2D_ID} type="button" onClick={onShow2D} title="Opportunity map with exact hover values">
            2D map
          </button>
        </div>

        <div className="scene-hud scene-hud-bl">
          <p className="hint scene-honesty">{terrainLabel}</p>
          {(status.length > 0 || message) && (
            <p className="hint" role="status">
              {[...status, message].filter(Boolean).join(' · ')}
              {(heights.status === 'error' || gridState.status === 'error') && (
                <>
                  {' '}
                  <button type="button" className="text-button" onClick={heights.status === 'error' ? retryHeights : retryGrid}>
                    Retry
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      <p className="hint scene-note">
        Drag to orbit, scroll to zoom, click a beacon to fly to a site, click the terrain to add a custom site (snapped to its 2 km cell). Map shading uses
        each 2 km cell&apos;s horizon; a site&apos;s status uses the site&apos;s own finer horizon, so the two can differ near a ridge.
      </p>
    </section>
  )
}

function StageNote({ text }: { text: string }) {
  return (
    <div className="scene-note-center" role="status">
      <div className="loader" aria-hidden="true" />
      <p className="muted">{text}</p>
    </div>
  )
}
