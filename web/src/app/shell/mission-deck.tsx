// The bottom deck's content (SPEC-app → Layout): the one slip control and the one time control, then a row per site.
import { useActivePreset } from '../controls/scenario-presets'
import { SlipSlider } from '../controls/slip-slider'
import { TimeBar } from '../controls/time-bar'
import { Deck } from './deck'
import { DetailsButton, type DetailsState } from './details-drawer'
import { SiteRows } from './site-rows'

/** `detailsDisabled`: the Compare tab shows the same table and timeline (goes away with that tab, S2-5). */
export function MissionDeck({ details, detailsDisabled = false }: { details: DetailsState; detailsDisabled?: boolean }) {
  const preset = useActivePreset()
  return (
    <Deck>
      <div className="deck-controls">
        <SlipSlider tryDays={preset?.targetSlipDays} />
        <TimeBar />
        <DetailsButton details={details} disabled={detailsDisabled} />
      </div>
      <SiteRows />
    </Deck>
  )
}
