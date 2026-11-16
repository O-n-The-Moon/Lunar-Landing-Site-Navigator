// Collapsible scenario rail (SPEC-app → Layout). Open on first load; the chevron or `[` folds it to a 44 px strip so
// the stage gets the width. Below 768 px it is a drawer over the stage (closed at first), opened from the top bar's
// menu button.
// The controls stay mounted while folded (`hidden`), so their state survives.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronIcon, MenuIcon } from '../ui/icons'

export interface RailState {
  open: boolean
  toggle: () => void
  bodyId: string
}

/** True when a keystroke belongs to a text field or a native control, not to a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Must match the drawer breakpoint in shell.css. */
const NARROW_QUERY = '(max-width: 768px)'

/** Open on wide screens; closed on narrow ones, where it would cover the stage as a drawer. */
function railStartsOpen(): boolean {
  return !(typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches)
}

export function useRail(): RailState {
  const [open, setOpen] = useState(railStartsOpen)
  const bodyId = useId()
  const toggle = useCallback(() => setOpen((o) => !o), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return { open, toggle, bodyId }
}

export function LeftRail({ rail, children }: { rail: RailState; children: ReactNode }) {
  const headingId = useId()
  return (
    <aside className="rail" data-open={rail.open} aria-labelledby={headingId}>
      <div className="rail-head">
        <h2 id={headingId}>Scenario</h2>
        <button
          type="button"
          className="rail-toggle"
          aria-expanded={rail.open}
          aria-controls={rail.bodyId}
          aria-keyshortcuts="["
          title={`${rail.open ? 'Hide' : 'Show'} scenario panel ([)`}
          onClick={rail.toggle}
        >
          <ChevronIcon />
          <span className="visually-hidden">{rail.open ? 'Hide scenario panel' : 'Show scenario panel'}</span>
        </button>
      </div>
      <div id={rail.bodyId} className="rail-body" hidden={!rail.open}>
        {children}
      </div>
    </aside>
  )
}

/** Top-bar button that opens the rail as a drawer on narrow screens (hidden by CSS on wide ones). */
export function RailMenuButton({ rail }: { rail: RailState }) {
  return (
    <button type="button" className="rail-menu" aria-expanded={rail.open} aria-controls={rail.bodyId} onClick={rail.toggle}>
      <MenuIcon size={16} />
      <span className="visually-hidden">Scenario menu</span>
    </button>
  )
}
