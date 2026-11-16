// Details drawer (SPEC-app → Layout): the full metric table and the full timeline, opened from the deck's Details button.
// A non-modal panel over the right of the stage: the deck (slip, Play) stays usable while it is open. Esc closes it and
// gives focus back to the button that opened it.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CompareView } from '../compare/compare-view'
import { TimelinePanel } from '../timeline/timeline-panel'

export interface DetailsState {
  open: boolean
  toggle: () => void
  close: () => void
  /** DOM ids of the drawer and of the deck button that opens it. */
  drawerId: string
  buttonId: string
}

export function useDetails(): DetailsState {
  const [open, setOpen] = useState(false)
  const drawerId = useId()
  const buttonId = useId()
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const close = useCallback(() => {
    setOpen(false)
    document.getElementById(buttonId)?.focus()
  }, [buttonId])
  return { open, toggle, close, drawerId, buttonId }
}

/** The deck's button. */
export function DetailsButton({ details }: { details: DetailsState }) {
  return (
    <button
      id={details.buttonId}
      type="button"
      className="details-button"
      aria-expanded={details.open}
      aria-controls={details.drawerId}
      onClick={details.toggle}
    >
      Details
    </button>
  )
}

export function DetailsDrawer({ details }: { details: DetailsState }) {
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const { open } = details
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])
  if (!open) return null
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    details.close()
  }
  return (
    <aside id={details.drawerId} className="details-drawer" role="dialog" aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <div className="details-head">
        <h2 id={headingId}>Details</h2>
        <button ref={closeRef} type="button" onClick={details.close}>
          Close
        </button>
      </div>
      <CompareView />
      <TimelinePanel showPlay={false} />
    </aside>
  )
}
