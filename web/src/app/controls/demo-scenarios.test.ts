import { describe, expect, it } from 'vitest'
import demoDoc from '../../../../docs/demo.md?raw'
import { createInitialState, HOUR_MS } from '../state'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { DEMO_SCENARIOS, matchesScenario, scenarioAvailable, scenarioState } from './demo-scenarios'

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const generated = demoDoc.slice(demoDoc.indexOf('demo:scenarios:start'), demoDoc.indexOf('demo:scenarios:end'))

describe('DEMO_SCENARIOS vs docs/demo.md', () => {
  it('has exactly the scenarios the generated doc lists', () => {
    expect(generated.length).toBeGreaterThan(0)
    const flips = DEMO_SCENARIOS.filter((s) => s.kind === 'flip').length
    const losses = DEMO_SCENARIOS.filter((s) => s.kind === 'loss').length
    expect(generated.match(/^Reproduce: /gm)).toHaveLength(flips)
    expect(generated.match(/^\*\*\d+\. .*\*\*: slip \d+ days from /gm)).toHaveLength(losses)
  })

  it.each(DEMO_SCENARIOS.filter((s) => s.kind === 'flip'))('$id: sites, landing and slip match its "Reproduce" line', (sc) => {
    const sites = sc.siteIds.map((id) => `\`${id}\``).join(' + ')
    const line = `Reproduce: sites ${sites}, duration 14 d, landing ${iso(sc.landingMs)}T00:00:00Z, slip slider +${sc.targetSlipDays} d.`
    expect(generated).toContain(line)
  })

  it.each(DEMO_SCENARIOS.filter((s) => s.kind === 'loss'))('$id: site, landing and slip match its loss entry', (sc) => {
    const head = `: slip ${sc.targetSlipDays} days from ${iso(sc.landingMs)}, `
    const at = generated.indexOf(head)
    expect(at).toBeGreaterThan(-1)
    // The entry's table names the site by id, in the rows before the next entry.
    const entry = generated.slice(at, generated.indexOf('\n**', at + 1) === -1 ? undefined : generated.indexOf('\n**', at + 1))
    expect(entry).toContain(`(\`${sc.siteIds[0]}\`)`)
    expect(entry).toContain(`| ${iso(sc.landingMs)} |`)
  })

  it('uses the doc’s mission length and unique ids', () => {
    expect(generated).toContain('Mission 14 days')
    expect(new Set(DEMO_SCENARIOS.map((s) => s.id)).size).toBe(DEMO_SCENARIOS.length)
  })
})

describe('preset state', () => {
  const base = createInitialState({ sites: fixtureSitesFile.sites })
  const sc = DEMO_SCENARIOS[0]

  it('is unavailable on a catalog that lacks its sites', () => {
    expect(scenarioAvailable(sc, fixtureSitesFile.sites)).toBe(false)
  })

  it('loads at slip 0 with the app defaults and the cursor two days in', () => {
    const s = scenarioState(sc, { ...base, slipH: 72, earthMarginDeg: 3 })
    expect(s.sites.map((x) => x.id)).toEqual(sc.siteIds)
    expect(s.focusedSiteId).toBe(sc.siteIds[0])
    expect(s.slipH).toBe(0)
    expect(s.earthMarginDeg).toBe(1)
    expect(s.cursorMs).toBe(sc.landingMs + 48 * HOUR_MS)
  })

  it('matches while only the slip changes, not after the sites or the landing change', () => {
    const s = scenarioState(sc, base)
    expect(matchesScenario(sc, s)).toBe(true)
    expect(matchesScenario(sc, { ...s, slipH: 360 })).toBe(true)
    expect(matchesScenario(sc, { ...s, landingMs: s.landingMs + HOUR_MS })).toBe(false)
    expect(matchesScenario(sc, { ...s, sites: s.sites.slice(0, 1) })).toBe(false)
    expect(matchesScenario(sc, { ...s, durationH: 48 })).toBe(false)
  })
})
