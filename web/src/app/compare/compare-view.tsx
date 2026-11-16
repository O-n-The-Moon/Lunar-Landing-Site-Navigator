// Compare view (SPEC-app P0-3): metric cards for up to 3 sites, slipped values with a Δ vs. the baseline.
// The slip itself is set by the sidebar's slip slider (controls/slip-slider.tsx).
import { useId } from 'react'
import { useScenarioResults } from '../use-scenario-results'
import { MetricCards } from './metric-cards'

export function CompareView() {
  const results = useScenarioResults()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Metrics</h3>
      <MetricCards results={results} />
    </section>
  )
}
