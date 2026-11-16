// App shell (SPEC-app → Layout): top bar with the view tabs, collapsible scenario rail, stage, bottom deck.
// Views: 3D Terrain / Surface / Verify. The full metric table and timeline are the deck's Details drawer; the 2D map is
// 3D Terrain's "2D map" toggle (and its WebGL fallback); the 2D panorama is Surface's "Engineering view".
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import './ui/tokens.css'
import './app.css'
import './ui/hud.css'
import './shell/shell.css'
import { CustomSite } from './controls/custom-site'
import { DateControls } from './controls/date-controls'
import { Options } from './controls/options'
import { AppliedPresetProvider, ScenarioPresets } from './controls/scenario-presets'
import { SitePicker } from './controls/site-picker'
import { DataProvider, defaultDataSources, useCoreData, useCoreDataState, type DataSource } from './data'
import { GridScoresProvider } from './map/score-layer'
import { TerrainView } from './scene/terrain-view'
import { SurfaceView } from './surface/surface-view'
import { DetailsDrawer, useDetails } from './shell/details-drawer'
import { MissionDeck } from './shell/mission-deck'
import { LeftRail, RailMenuButton, useRail } from './shell/left-rail'
import { MissionClock, TopBar } from './shell/top-bar'
import { ScenarioProvider, createInitialState } from './state'
import { TimeBarProvider } from './controls/time-bar'
import { ScenarioResultsProvider, useScenarioResults } from './use-scenario-results'
import { ValidationPanel } from './validation/validation-panel'

export interface AppProps {
  /** Injected in tests; defaults to `public/data/` (falling back to fixtures in dev). */
  dataSources?: { source: DataSource; fallback?: DataSource }
}

export function App({ dataSources }: AppProps) {
  const [sources] = useState(() => dataSources ?? defaultDataSources())
  return (
    <DataProvider source={sources.source} fallback={sources.fallback}>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { core } = useCoreDataState()
  return (
    <div className="app">
      {core.status === 'ready' ? (
        <ScenarioRoot />
      ) : (
        <>
          <TopBar />
          {core.status === 'error' ? (
            <div className="app-message" role="alert">
              <h2>Could not load mission data</h2>
              <p className="num">{core.message}</p>
              <button type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          ) : (
            <p className="app-message" role="status">
              Loading ephemeris, sites and validation…
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** Creates the initial scenario once, from the loaded site catalog. */
function ScenarioRoot() {
  const { sitesFile } = useCoreData()
  const [initialState] = useState(() => createInitialState({ sites: sitesFile.sites }))
  return (
    <ScenarioProvider initialState={initialState}>
      <ScenarioResultsProvider>
        <GridScoresProvider>
          <Workspace />
        </GridScoresProvider>
      </ScenarioResultsProvider>
    </ScenarioProvider>
  )
}

const TABS = [
  { id: 'terrain', label: '3D Terrain' },
  { id: 'surface', label: 'Surface' },
  { id: 'verify', label: 'Verify' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Play for the whole workspace; reads the results here so Workspace itself doesn't re-render on every slip step. */
function ViewTimeBar({ active, children }: { active: boolean; children: ReactNode }) {
  const canPlay = useScenarioResults().sites.length > 0
  return (
    <TimeBarProvider active={active} canPlay={canPlay}>
      {children}
    </TimeBarProvider>
  )
}

function Workspace() {
  const [tab, setTab] = useState<TabId>('terrain')
  // Panels mount on first open (so the grid loads lazily) and then stay mounted.
  const [opened, setOpened] = useState<ReadonlySet<TabId>>(() => new Set(['terrain']))
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const baseId = useId()
  const rail = useRail()
  const details = useDetails()
  const stageRef = useRef<HTMLElement>(null)
  // The open drawer covers part (all, when narrow) of the stage: keep keyboard focus and the a11y tree out of it.
  // (React 18 has no `inert` prop.)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (details.open) stage.setAttribute('inert', '')
    else stage.removeAttribute('inert')
  }, [details.open])

  const select = (id: TabId, focus = false) => {
    setTab(id)
    details.dismiss() // it would cover another view's content
    setOpened((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
    if (focus) tabRefs.current[id]?.focus()
  }

  // WAI-ARIA APG tabs: arrows move and activate, Home/End jump.
  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    select(TABS[(next + TABS.length) % TABS.length].id, true)
  }

  const panel = (id: TabId) => ({
    id: `${baseId}-panel-${id}`,
    role: 'tabpanel',
    'aria-labelledby': `${baseId}-tab-${id}`,
    hidden: tab !== id,
    className: 'tab-panel',
  })

  return (
    <>
      <TopBar start={<RailMenuButton rail={rail} />} end={<MissionClock />}>
        <div role="tablist" aria-label="Views" className="tabs" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </TopBar>
      <AppliedPresetProvider>
        <ViewTimeBar active={tab !== 'verify'}>
          <div className="console">
            <LeftRail rail={rail}>
              <ScenarioPresets onApplied={rail.close} />
              <SitePicker />
              <CustomSite />
              <DateControls />
              <Options />
            </LeftRail>
            <main ref={stageRef} className="stage">
              <div {...panel('terrain')}>{opened.has('terrain') && <TerrainView active={tab === 'terrain'} />}</div>
              <div {...panel('surface')}>{opened.has('surface') && <SurfaceView active={tab === 'surface'} />}</div>
              <div {...panel('verify')}>{opened.has('verify') && <ValidationPanel />}</div>
            </main>
            <DetailsDrawer details={details} />
            <MissionDeck details={details} />
          </div>
        </ViewTimeBar>
      </AppliedPresetProvider>
    </>
  )
}
