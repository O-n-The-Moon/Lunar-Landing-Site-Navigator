// Details drawer (SPEC-app → Layout): the full metric table and the full timeline, opened from the deck's Details button.
// A panel over the right of the stage: the deck (slip, Play) stays usable while it is open, the stage beneath is inert
// (it is covered, so keyboard focus must not reach it). Esc closes it from anywhere and gives focus back to the button
// that opened it. The timeline's cursor here is the same `cursorMs` as the deck's time control, not a second one.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CompareView } from '../compare/compare-view'
import { TimelinePanel } from '../timeline/timeline-panel'

export interface DetailsState {
  open: boolean
  toggle: () => void
  close: () => void
  /** Closes without moving focus (the view changed under it). */
  dismiss: () => void
  /** DOM ids of the drawer and of the deck button that opens it. */
  drawerId: string
  buttonId: string
}

export function useDetails(): DetailsState {
  const [open, setOpen] = useState(false)
  const drawerId = useId()
  const buttonId = useId()
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const dismiss = useCallback(() => setOpen(false), [])
  const close = useCallback(() => {
    setOpen(false)
    document.getElementById(buttonId)?.focus()
  }, [buttonId])
  return { open, toggle, close, dismiss, drawerId, buttonId }
}

/** The deck's button. */
export function DetailsButton({ details, disabled = false }: { details: DetailsState; disabled?: boolean }) {
  return (
    <button
      id={details.buttonId}
      type="button"
      className="details-button"
      aria-expanded={details.open}
      aria-controls={details.drawerId}
      disabled={disabled}
      title={disabled ? 'The Compare tab already shows these' : undefined}
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
  const { close } = details
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])
  if (!open) return null
  return (
    <aside id={details.drawerId} className="details-drawer" role="dialog" aria-labelledby={headingId}>
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
