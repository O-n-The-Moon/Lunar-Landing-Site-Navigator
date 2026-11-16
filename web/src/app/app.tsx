// App shell (SPEC-app → Layout): top bar with the view tabs, collapsible scenario rail, stage, bottom deck.
// Views: 3D Terrain / Surface / Compare / Opportunity Map / Validation (Compare and the map retire in S2-5).
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import './ui/tokens.css'
import './app.css'
import './ui/hud.css'
import './shell/shell.css'
import { CompareView } from './compare/compare-view'
import { CustomSite } from './controls/custom-site'
import { DateControls } from './controls/date-controls'
import { Options } from './controls/options'
import { SitePicker } from './controls/site-picker'
import { SlipSlider } from './controls/slip-slider'
import { DataProvider, defaultDataSources, useCoreData, useCoreDataState, type DataSource } from './data'
import { MapView } from './map/map-view'
import { GridScoresProvider } from './map/score-layer'
import { PanoramaPanel } from './panorama/panorama-panel'
import { TerrainView } from './scene/terrain-view'
import { SurfaceView } from './surface/surface-view'
import { Deck } from './shell/deck'
import { LeftRail, RailMenuButton, useRail } from './shell/left-rail'
import { MissionClock, TopBar } from './shell/top-bar'
import { ScenarioProvider, createInitialState } from './state'
import { TimelinePanel } from './timeline/timeline-panel'
import { ScenarioResultsProvider } from './use-scenario-results'
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
  { id: 'compare', label: 'Compare' },
  { id: 'map', label: 'Opportunity Map' },
  { id: 'validation', label: 'Validation' },
] as const
type TabId = (typeof TABS)[number]['id']

function Workspace() {
  const [tab, setTab] = useState<TabId>('terrain')
  // Panels mount on first open (so the grid loads lazily) and then stay mounted.
  const [opened, setOpened] = useState<ReadonlySet<TabId>>(() => new Set(['terrain']))
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const baseId = useId()
  const rail = useRail()

  const select = (id: TabId, focus = false) => {
    setTab(id)
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
      <div className="console">
        <LeftRail rail={rail}>
          <SitePicker />
          <CustomSite />
          <DateControls />
          <SlipSlider />
          <Options />
        </LeftRail>
        <main className="stage">
          <div {...panel('terrain')}>{opened.has('terrain') && <TerrainView active={tab === 'terrain'} />}</div>
          <div {...panel('surface')}>{opened.has('surface') && <SurfaceView active={tab === 'surface'} />}</div>
          <div {...panel('compare')}>
            {opened.has('compare') && (
              <>
                <CompareView />
                <TimelinePanel active={tab === 'compare'} />
                <PanoramaPanel />
              </>
            )}
          </div>
          <div {...panel('map')}>{opened.has('map') && <MapView active={tab === 'map'} />}</div>
          <div {...panel('validation')}>{opened.has('validation') && <ValidationPanel />}</div>
        </main>
        <Deck />
      </div>
    </>
  )
}
