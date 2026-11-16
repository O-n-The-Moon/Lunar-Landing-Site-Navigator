// Demo scenarios (docs/demo.md): one click loads a preset's sites and landing at slip 0, and the deck's "Try +N d"
// button then applies the slip that tells its story. Hidden when the catalog lacks the sites (fixture data).
import { createContext, createElement, useContext, useId, useState, type ReactNode } from 'react'
import { useCoreData } from '../data'
import { useScenario, useScenarioDispatch } from '../state'
import { DEMO_SCENARIOS, matchesScenario, scenarioAvailable, scenarioState, type DemoScenario } from './demo-scenarios'
import './scenario-presets.css'

interface Applied {
  id: string | null
  setId: (id: string | null) => void
}
const AppliedContext = createContext<Applied | null>(null)

/** Remembers which preset is loaded (the scenario itself doesn't, and shouldn't, know); `initialId`: the one the app opened on. */
export function AppliedPresetProvider({ initialId = null, children }: { initialId?: string | null; children: ReactNode }) {
  const [id, setId] = useState<string | null>(initialId)
  return createElement(AppliedContext.Provider, { value: { id, setId } }, children)
}

function useApplied(): Applied {
  const a = useContext(AppliedContext)
  if (!a) throw new Error('Preset hooks must be used inside <AppliedPresetProvider>')
  return a
}

/** The loaded preset while the scenario still is its own (same sites, landing and length; any slip), else null. */
export function useActivePreset(): DemoScenario | null {
  const { id } = useApplied()
  const scenario = useScenario()
  const sc = DEMO_SCENARIOS.find((x) => x.id === id)
  return sc && matchesScenario(sc, scenario) ? sc : null
}

const KIND_LABEL = { flip: 'Rank flip', loss: 'Loss' } as const

/** `onApplied`: the shell folds the rail away once a scenario is set. */
export function ScenarioPresets({ onApplied }: { onApplied?: () => void }) {
  const { sitesFile } = useCoreData()
  const scenario = useScenario()
  const dispatch = useScenarioDispatch()
  const { setId } = useApplied()
  const active = useActivePreset()
  const baseId = useId()
  const available = DEMO_SCENARIOS.filter((sc) => scenarioAvailable(sc, sitesFile.sites))
  if (available.length === 0) return null

  return (
    <fieldset className="control scenario-presets">
      <legend>Demo scenarios</legend>
      <ul className="preset-list">
        {available.map((sc) => (
          <li key={sc.id}>
            <button
              type="button"
              className="preset"
              aria-pressed={active?.id === sc.id}
              title={sc.story}
              aria-describedby={`${baseId}-${sc.id}`}
              onClick={() => {
                dispatch({ type: 'replace', state: scenarioState(sc, scenario) })
                setId(sc.id)
                onApplied?.()
              }}
            >
              <span className={`preset-kind is-${sc.kind}`}>{KIND_LABEL[sc.kind]}</span>
              <span className="preset-title">{sc.title}</span>
              <span className="preset-when">{sc.when}</span>
            </button>
            <span id={`${baseId}-${sc.id}`} className="visually-hidden">
              {sc.story}
            </span>
          </li>
        ))}
      </ul>
      {/* The story is on screen too (not only in a tooltip), for touch and keyboard users. */}
      {active && <p className="hint preset-story">{active.story}</p>}
    </fieldset>
  )
}
