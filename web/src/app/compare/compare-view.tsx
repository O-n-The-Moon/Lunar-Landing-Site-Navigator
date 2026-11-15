// Compare view (SPEC-app P0-3). Owned by T20 (#21); T14 (#15) only mounts the metric cards here.
import { useId } from 'react'
import { useScenarioResults } from '../use-scenario-results'
import { MetricCards } from './metric-cards'

export function CompareView() {
  const results = useScenarioResults()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Compare</h3>
      <MetricCards results={results} />
    </section>
  )
}
