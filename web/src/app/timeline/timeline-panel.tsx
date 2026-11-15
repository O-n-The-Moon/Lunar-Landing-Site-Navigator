// Timeline strips, one per scenario site, over the slipped mission window (SPEC-app P0-4).
// Baseline ghost bands and the single shared cursor across strips come in T21 #22.
import { useScenario, useScenarioDispatch } from '../state'
import { useScenarioResults } from '../use-scenario-results'
import { TimelineStrip } from './timeline-strip'

const H_MS = 3_600_000

export function TimelinePanel() {
  const { cursorMs } = useScenario()
  const dispatch = useScenarioDispatch()
  const results = useScenarioResults()
  const range = { startMs: results.slippedLandingMs, endMs: results.slippedLandingMs + results.durationH * H_MS }
  const onCursorChange = (ms: number) => dispatch({ type: 'setCursor', cursorMs: ms })

  return (
    <section aria-label="Timeline">
      <h3>Timeline</h3>
      {results.siteIds.length === 0 && (
        <p className="hint">Add a site to see its Sun and Earth visibility over the mission.</p>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        {results.sites.map((r) => (
          <TimelineStrip
            key={r.site.id}
            siteName={r.site.name}
            windows={r.slipped.windows}
            range={range}
            cursorMs={cursorMs}
            onCursorChange={onCursorChange}
          />
        ))}
      </div>
      {results.unavailable.map((x) => (
        <p key={x.id} className="hint warn">
          No timeline for {x.name}: {x.reason}
        </p>
      ))}
    </section>
  )
}
