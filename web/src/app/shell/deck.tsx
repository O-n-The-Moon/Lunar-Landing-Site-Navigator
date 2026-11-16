// Bottom deck (SPEC-app → Layout): the frame; `MissionDeck` fills it with the slip, Play/cursor and per-site rows.
// With no children it renders nothing; the grid area is reserved in shell.css.
import type { ReactNode } from 'react'
import './deck.css'

export function Deck({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <section className="deck" aria-label="Mission deck">
      {children}
    </section>
  )
}
