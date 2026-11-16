// The bottom deck's content (SPEC-app → Layout): the one slip control and the one time control, then a row per site.
import { SlipSlider } from '../controls/slip-slider'
import { TimeBar } from '../controls/time-bar'
import { Deck } from './deck'
import { SiteRows } from './site-rows'

export function MissionDeck() {
  return (
    <Deck>
      <div className="deck-controls">
        <SlipSlider />
        <TimeBar />
      </div>
      <SiteRows />
    </Deck>
  )
}
