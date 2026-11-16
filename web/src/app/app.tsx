// App shell (SPEC-app → Layout): scenario sidebar + 3D Terrain / Compare / Opportunity Map / Validation tabs.
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import './app.css'
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
  const { core, kind, fallbackReason } = useCoreDataState()
  return (
    <div className="app">
      <header className="app-header">
        <h1>Lunar Landing Site Navigator</h1>
        {kind === 'fixtures' && (
          <p className="badge badge-warn" title={fallbackReason ?? undefined}>
            Synthetic fixture data, not real lunar data
            {fallbackReason && <span className="muted"> ({fallbackReason})</span>}
          </p>
        )}
      </header>
      {core.status === 'ready' ? (
        <ScenarioRoot />
      ) : core.status === 'error' ? (
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
    <div className="layout">
      <aside className="sidebar" aria-labelledby={`${baseId}-scenario`}>
        <h2 id={`${baseId}-scenario`}>Scenario</h2>
        <SitePicker />
        <CustomSite />
        <DateControls />
        <SlipSlider />
        <Options />
      </aside>
      <main className="main">
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
        <div {...panel('terrain')}>{opened.has('terrain') && <TerrainView active={tab === 'terrain'} />}</div>
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
    </div>
  )
}
