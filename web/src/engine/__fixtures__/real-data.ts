// The real data contract (web/public/data) for engine tests. Test-only: never import from app code,
// since the inlined ephemeris.bin (~1.5 MB) would land in the bundle. Synthetic fixtures live in index.ts.
import ephemerisBin from '../../../public/data/ephemeris.bin?inline'
import ephemerisJson from '../../../public/data/ephemeris.json'
import sitesJson from '../../../public/data/sites.json'
import { siteContext } from '../geometry'
import { loadEphemeris, parseSites } from '../loaders'
import type { EphemerisManifest, SiteContext } from '../types'
import { dataUrlToArrayBuffer } from './data-url'

export const realEphemeris = loadEphemeris(ephemerisJson as EphemerisManifest, dataUrlToArrayBuffer(ephemerisBin))

export const realSitesFile = parseSites(sitesJson)

/** Site context for a curated site in sites.json; throws if the id is unknown. */
export function realSiteContext(siteId: string, observerHeightM: number): SiteContext {
  const site = realSitesFile.sites.find((s) => s.id === siteId)
  if (!site) throw new Error(`site ${siteId} is not in sites.json`)
  return siteContext(realEphemeris, site, realSitesFile.azStepDeg, observerHeightM)
}
