import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimelineCursor } from './timeline-cursor'

afterEach(cleanup)

const H_MS = 3_600_000
const range = { startMs: Date.UTC(2026, 2, 1), endMs: Date.UTC(2026, 2, 1) + 24 * H_MS }

function renderCursor(cursorMs = range.startMs) {
  const onCursorChange = vi.fn()
  const view = render(
    <TimelineCursor range={range} cursorMs={cursorMs} onCursorChange={onCursorChange} valueText="Mission day 1" />,
  )
  return { ...view, onCursorChange }
}

describe('TimelineCursor', () => {
  it('is one keyboard slider over the mission range with a text value', () => {
    const cursorMs = range.startMs + 6 * H_MS
    renderCursor(cursorMs)
    const slider = screen.getByRole('slider', { name: /timeline cursor/i })
    expect(slider).toHaveAttribute('aria-valuemin', String(range.startMs))
    expect(slider).toHaveAttribute('aria-valuemax', String(range.endMs))
    expect(slider).toHaveAttribute('aria-valuenow', String(cursorMs))
    expect(slider).toHaveAttribute('aria-valuetext', 'Mission day 1')
    expect(slider).toHaveAttribute('tabindex', '0')
  })

  it('steps with the arrows (±1 h), PageUp/PageDown (±12 h), and jumps with Home/End, clamped to the range', () => {
    const cursorMs = range.startMs + 6 * H_MS
    const { onCursorChange } = renderCursor(cursorMs)
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(onCursorChange).toHaveBeenLastCalledWith(cursorMs + H_MS)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(onCursorChange).toHaveBeenLastCalledWith(cursorMs - H_MS)
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(onCursorChange).toHaveBeenLastCalledWith(cursorMs + 12 * H_MS)
    fireEvent.keyDown(slider, { key: 'PageDown' })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs) // 06:00 − 12 h clamps to the start
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.endMs)
  })

  it('ignores other keys', () => {
    const { onCursorChange } = renderCursor()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'a' })
    expect(onCursorChange).not.toHaveBeenCalled()
  })

  it('moves the cursor to where the pointer is, and keeps following while dragging', () => {
    const { onCursorChange } = renderCursor()
    const slider = screen.getByRole('slider')
    slider.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 40, right: 500, bottom: 40, x: 100, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 1 })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs + 6 * H_MS) // 25 % of 24 h
    // jsdom has no pointer capture: without it a move is not a drag.
    onCursorChange.mockClear()
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 })
    expect(onCursorChange).not.toHaveBeenCalled()
    slider.hasPointerCapture = () => true
    fireEvent.pointerMove(slider, { clientX: 300, pointerId: 1 })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.startMs + 12 * H_MS)
    // Dragging past the end clamps to the range.
    fireEvent.pointerMove(slider, { clientX: 900, pointerId: 1 })
    expect(onCursorChange).toHaveBeenLastCalledWith(range.endMs)
  })

  it('draws the cursor line at the cursor time as a fraction of the plot width', () => {
    const { container } = renderCursor(range.startMs + 6 * H_MS)
    expect(container.querySelector('[data-cursor-line]')).toHaveStyle({ left: '25%' })
  })

  it('keeps the line inside the plot when the cursor is outside the range', () => {
    const { container, rerender } = renderCursor()
    rerender(<TimelineCursor range={range} cursorMs={range.endMs + 5 * H_MS} onCursorChange={() => {}} valueText="x" />)
    expect(container.querySelector('[data-cursor-line]')).toHaveStyle({ left: '100%' })
  })
})
