// Bottom deck (SPEC-app → Layout): the slip, Play/cursor and per-site rows move here in S2-2.
// Until then it has nothing to show and renders nothing; the grid area is reserved in shell.css.
import type { ReactNode } from 'react'

export function Deck({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <section className="deck" aria-label="Mission deck">
      {children}
    </section>
  )
}
