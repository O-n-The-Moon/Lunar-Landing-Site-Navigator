// Single-key shortcuts for the console (`[` folds the scenario rail, `]` hides the deck). One place decides when a
// keystroke is a shortcut and when it is not.
import { useEffect } from 'react'

/** True when a keystroke belongs to a text field or a native control, not to a shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  // Sliders, checkboxes and radios take no text, so a shortcut typed while one has focus (right after dragging the slip slider) still works.
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)
}

/** Whether a modal (the intro) is open: the console behind it is unreachable, so its shortcuts must not fire either. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/** Runs `handler` on `key` pressed with no modifier, outside text fields, while no modal is open. */
export function useShortcut(key: string, handler: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || modalOpen()) return
      e.preventDefault()
      handler()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, handler])
}
