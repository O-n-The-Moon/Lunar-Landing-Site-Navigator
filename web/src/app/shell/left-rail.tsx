// Collapsible scenario rail (SPEC-app → Layout). Open on first load; the chevron or `[` folds it to a 44 px strip so
// the stage gets the width. Below 768 px it is a drawer over the stage (closed at first), opened from the top bar's
// menu button.
// The controls stay mounted while folded (`hidden`), so their state survives.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronIcon, MenuIcon } from '../ui/icons'
import { useShortcut } from './shortcuts'

export interface RailState {
  open: boolean
  toggle: () => void
  /** Folds the rail without moving focus (something else took its place over the stage). */
  hide: () => void
  /** Folds the rail (used once a scenario is set) and moves focus to its toggle, which stays visible. */
  close: () => void
  bodyId: string
  /** DOM ids of the two buttons that open the rail (the strip's chevron, the top bar's menu). */
  toggleId: string
  menuId: string
}

/** Must match the drawer breakpoint in shell.css. */
const NARROW_QUERY = '(max-width: 768px)'

/** True while the rail is a drawer over the stage. */
export function isNarrowViewport(): boolean {
  return typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches
}

/** Open on wide screens; closed on narrow ones, where it would cover the stage as a drawer. */
function railStartsOpen(): boolean {
  return !isNarrowViewport()
}

export function useRail(): RailState {
  const [open, setOpen] = useState(railStartsOpen)
  const bodyId = useId()
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const hide = useCallback(() => setOpen(false), [])
  const toggleId = useId()
  const menuId = useId()
  const close = useCallback(() => {
    setOpen(false)
    // The control that was just used is inside the body that is being hidden, so focus would fall to <body>. On
    // narrow screens the whole rail is hidden and the top bar's menu button is the one still showing.
    const toggle = document.getElementById(toggleId)
    const menu = document.getElementById(menuId)
    ;(toggle && toggle.offsetParent !== null ? toggle : (menu ?? toggle))?.focus()
  }, [toggleId, menuId])

  useShortcut('[', toggle)

  // As a drawer over the stage (narrow screens) Esc closes it, like the Details drawer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isNarrowViewport()) return
      e.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  return { open, toggle, hide, close, bodyId, toggleId, menuId }
}

export function LeftRail({ rail, children }: { rail: RailState; children: ReactNode }) {
  const headingId = useId()
  return (
    <aside className="rail" data-open={rail.open} aria-labelledby={headingId}>
      <div className="rail-head">
        <h2 id={headingId}>Scenario</h2>
        <button
          id={rail.toggleId}
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
    <button id={rail.menuId} type="button" className="rail-menu" aria-expanded={rail.open} aria-controls={rail.bodyId} onClick={rail.toggle}>
      <MenuIcon size={16} />
      <span className="visually-hidden">Scenario menu</span>
    </button>
  )
}
