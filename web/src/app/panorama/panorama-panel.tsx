// Horizon panorama for the focused site at the shared cursor time (SPEC-app P0-5).
// Positions come from the engine; lit / in-view state comes from the same windows the timeline draws,
// so the panorama and the timeline always agree. Tracks, hover and re-centering come in T22 #23.
import { angularRadiusDeg, azEl, bodyVectorKm, horizonElevAt, type Body, type SiteContext, type Window } from '../../engine'
import { useScenario } from '../state'
import { useScenarioResults } from '../use-scenario-results'
import { HorizonPanorama, type PanoramaBody } from './horizon-panorama'

/** Same rule as the timeline: half-open [start, end), except a window clipped at the range end includes that end. */
const isIn = (ws: Window[], t: number) =>
  ws.some((w) => w.startMs <= t && (t < w.endMs || (w.clippedEnd && t === w.endMs)))

function bodyAt(ctx: SiteContext, body: Body, tUtcMs: number, windows: Window[]): PanoramaBody {
  const { azDeg, elevDeg, distKm } = azEl(ctx.frame, bodyVectorKm(ctx.eph, body, tUtcMs))
  return {
    azDeg,
    elevDeg,
    horizonDeg: horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, azDeg),
    radiusDeg: angularRadiusDeg(body, distKm),
    visible: isIn(windows, tUtcMs),
  }
}

export function PanoramaPanel() {
  const { focusedSiteId, cursorMs } = useScenario()
  const results = useScenarioResults()
  const focused = results.sites.find((r) => r.site.id === focusedSiteId)

  let content
  if (!focused) {
    content = (
      <p className="hint">
        {focusedSiteId === null ? 'Add a site to see its horizon.' : `No horizon yet for: ${focusedSiteId}`}
      </p>
    )
  } else {
    const { ctx, slipped, site } = focused
    let bodies: { sun: PanoramaBody; earth: PanoramaBody } | null = null
    try {
      bodies = {
        sun: bodyAt(ctx, 'sun', cursorMs, slipped.windows.sun),
        earth: bodyAt(ctx, 'earth', cursorMs, slipped.windows.earth),
      }
    } catch (e) {
      // bodyVectorKm throws RangeError outside the ephemeris coverage.
      if (!(e instanceof RangeError)) throw e
    }
    content = bodies ? (
      <HorizonPanorama
        siteName={site.name}
        horizonMaskDeg={ctx.horizonMaskDeg}
        azStepDeg={ctx.azStepDeg}
        observerHeightM={ctx.observerHeightM}
        sun={bodies.sun}
        earth={bodies.earth}
      />
    ) : (
      <p className="hint warn">Cursor time is outside the ephemeris coverage.</p>
    )
  }

  return (
    <section aria-label="Horizon panorama">
      <h3>Horizon panorama</h3>
      {content}
    </section>
  )
}
