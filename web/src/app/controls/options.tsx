// Scenario options (SPEC-app P0-2): observer height, Sun threshold, Earth margin. Values go to the reducer, which
// clamps them; the engine reads them through useScenarioResults.
import { useId } from 'react'
import {
  EARTH_MARGIN_RANGE_DEG,
  GRID_OBSERVER_HEIGHT_M,
  OBSERVER_HEIGHTS_M,
  useScenario,
  useScenarioDispatch,
} from '../state'

const SUN_THRESHOLD_STEP = 0.05
const EARTH_MARGIN_STEP_DEG = 0.5

export function Options() {
  const { observerHeightM, sunThreshold, earthMarginDeg, sites } = useScenario()
  const dispatch = useScenarioDispatch()
  const heightId = useId()
  const sunId = useId()
  const earthId = useId()

  const hasCustom = sites.some((x) => x.kind === 'custom')
  const customStaysAt2m = hasCustom && observerHeightM !== GRID_OBSERVER_HEIGHT_M

  return (
    <fieldset className="control">
      <legend>Options</legend>

      <label id={heightId}>Observer height</label>
      <div className="row" role="radiogroup" aria-labelledby={heightId}>
        {OBSERVER_HEIGHTS_M.map((h) => (
          <label key={h}>
            <input
              type="radio"
              name={heightId}
              value={h}
              checked={observerHeightM === h}
              onChange={() => dispatch({ type: 'setObserverHeight', heightM: h })}
            />
            {h} m
          </label>
        ))}
      </div>
      <p className="hint">Curated sites use their own terrain mask at this height. Custom (grid) sites: {GRID_OBSERVER_HEIGHT_M} m only.</p>
      <p className="hint warn" role="status">
        {customStaysAt2m ? `Custom sites still use ${GRID_OBSERVER_HEIGHT_M} m (the grid has no ${observerHeightM} m horizons).` : ''}
      </p>

      <label htmlFor={sunId}>Sun threshold (visible-disk fraction)</label>
      <div className="row">
        <input
          id={sunId}
          type="range"
          min={0}
          max={1}
          step={SUN_THRESHOLD_STEP}
          value={sunThreshold}
          aria-valuetext={`${Math.round(sunThreshold * 100)} % of the Sun's disk visible`}
          onChange={(e) => dispatch({ type: 'setSunThreshold', value: Number(e.target.value) })}
        />
        <output htmlFor={sunId} className="num">
          {sunThreshold.toFixed(2)}
        </output>
      </div>
      <p className="hint">Sunlit when at least this fraction of the Sun's disk is above the terrain horizon.</p>

      <label htmlFor={earthId}>Earth margin (°)</label>
      <div className="row">
        <input
          id={earthId}
          type="range"
          min={EARTH_MARGIN_RANGE_DEG.min}
          max={EARTH_MARGIN_RANGE_DEG.max}
          step={EARTH_MARGIN_STEP_DEG}
          value={earthMarginDeg}
          aria-valuetext={`${earthMarginDeg.toFixed(1)} degrees above the terrain horizon`}
          onChange={(e) => dispatch({ type: 'setEarthMargin', deg: Number(e.target.value) })}
        />
        <output htmlFor={earthId} className="num">
          {earthMarginDeg.toFixed(1)}°
        </output>
      </div>
      <p className="hint">Earth link (geometric DTE) when Earth's center clears the terrain horizon by this much.</p>
    </fieldset>
  )
}
