// Curated site picker (SPEC-app P0-2): grouped by category with slope; up to 3 sites; remove; set focus.
import { useId, useState } from 'react'
import type { SiteCategory } from '../../engine'
import { useCoreData } from '../data'
import { MAX_SITES, useScenario, useScenarioDispatch } from '../state'
import { resolveSite } from '../use-scenario-results'

const CATEGORY_LABELS: Record<SiteCategory, string> = {
  'artemis3-region': 'Artemis III regions',
  clps: 'CLPS',
  international: 'International',
  reference: 'Reference',
}

export function SitePicker() {
  const { sitesFile } = useCoreData()
  const { sites, focusedSiteId, observerHeightM } = useScenario()
  const dispatch = useScenarioDispatch()
  const [pick, setPick] = useState('')
  const selectId = useId()

  const chosen = new Set(sites.map((s) => s.id))
  const full = sites.length >= MAX_SITES
  const groups = (Object.keys(CATEGORY_LABELS) as SiteCategory[])
    .map((category) => ({ category, sites: sitesFile.sites.filter((s) => s.category === category) }))
    .filter((g) => g.sites.length > 0)

  const add = () => {
    if (!pick) return
    dispatch({ type: 'addCuratedSite', id: pick })
    setPick('')
  }

  return (
    <fieldset className="control">
      <legend>
        Sites ({sites.length}/{MAX_SITES})
      </legend>

      {sites.length === 0 ? (
        <p className="hint">No sites yet. Add one below.</p>
      ) : (
        <ul className="site-list">
          {sites.map((ref) => {
            const site = resolveSite(ref, sitesFile.sites, observerHeightM)
            const name = site?.name ?? `${ref.id} (not in sites.json)`
            return (
              <li key={ref.id}>
                <label title="Show this site in the panorama">
                  <input
                    type="radio"
                    name="focused-site"
                    checked={focusedSiteId === ref.id}
                    onChange={() => dispatch({ type: 'focusSite', id: ref.id })}
                  />
                  <span className="site-name" title={name}>
                    {name}
                  </span>
                  {site?.slopeDeg != null && <span className="num muted">{site.slopeDeg.toFixed(1)}°</span>}
                </label>
                <button type="button" className="icon-button" aria-label={`Remove ${name}`} onClick={() => dispatch({ type: 'removeSite', id: ref.id })}>
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <label htmlFor={selectId}>Add curated site</label>
      <div className="row">
        <select id={selectId} value={pick} onChange={(e) => setPick(e.target.value)} disabled={full}>
          <option value="">{full ? `Maximum ${MAX_SITES} sites` : 'Choose a site…'}</option>
          {groups.map((g) => (
            <optgroup key={g.category} label={CATEGORY_LABELS[g.category]}>
              {g.sites.map((s) => (
                <option key={s.id} value={s.id} disabled={chosen.has(s.id)}>
                  {s.name} · slope {s.slopeDeg.toFixed(1)}°
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={add} disabled={!pick || full}>
          Add
        </button>
      </div>
      {full && <p className="hint">Remove a site to add another.</p>}
    </fieldset>
  )
}
