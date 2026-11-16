// Bottom deck (SPEC-app → Layout): the frame; `MissionDeck` fills it with the slip, Play/cursor and per-site rows.
import type { ReactNode } from 'react'
import './deck.css'

export function Deck({ children }: { children: ReactNode }) {
  return (
    <section className="deck" aria-label="Mission deck">
      {children}
    </section>
  )
}
