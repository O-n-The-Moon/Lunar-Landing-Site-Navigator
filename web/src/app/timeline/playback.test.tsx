import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureSitesFile } from '../../engine/__fixtures__'
import { HOUR_MS, ScenarioProvider, createInitialState, useScenario } from '../state'
import { PLAY_SECONDS, usePlayCursor } from './playback'

const T0 = Date.UTC(2026, 2, 1)
const initial = { ...createInitialState({ sites: fixtureSitesFile.sites, landingMs: T0 }), durationH: 24 * 4 }

const wrapper = ({ children }: { children: ReactNode }) => <ScenarioProvider initialState={initial}>{children}</ScenarioProvider>

function setup(opts: Parameters<typeof usePlayCursor>[0]) {
  return renderHook(() => ({ play: usePlayCursor(opts), cursorMs: useScenario().cursorMs }), { wrapper })
}

/** Advances in single frames, one `act` each: React renders between real animation frames, and the loop relies on that. */
function advance(ms: number) {
  for (let t = 0; t < ms; t += 16) act(() => void vi.advanceTimersByTime(16))
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePlayCursor', () => {
  it('sweeps a whole mission in PLAY_SECONDS when no speed is given', () => {
    const { result } = setup({ active: true })
    act(() => result.current.play.toggle())
    expect(result.current.play.playing).toBe(true)
    advance((PLAY_SECONDS / 2) * 1000)
    const half = (result.current.cursorMs - T0) / (4 * 24 * HOUR_MS)
    expect(half).toBeGreaterThan(0.45)
    expect(half).toBeLessThan(0.55)
  })

  it('moves a fixed number of mission hours per second when a speed is given, and stops at the end', () => {
    const { result } = setup({ active: true, speedHPerS: 24 }) // 1 day per second; the mission is 4 days
    act(() => result.current.play.toggle())
    advance(2000)
    expect((result.current.cursorMs - T0) / HOUR_MS).toBeGreaterThan(44)
    expect((result.current.cursorMs - T0) / HOUR_MS).toBeLessThan(52)
    advance(5000)
    expect(result.current.cursorMs).toBe(T0 + 4 * 24 * HOUR_MS)
    expect(result.current.play.playing).toBe(false)
  })

  it('pauses while inactive or disabled', () => {
    const { result, rerender } = renderHook((p: { active: boolean; enabled: boolean }) => ({ play: usePlayCursor({ ...p, speedHPerS: 24 }), cursorMs: useScenario().cursorMs }), {
      wrapper,
      initialProps: { active: true, enabled: true },
    })
    act(() => result.current.play.toggle())
    expect(result.current.play.playing).toBe(true)
    rerender({ active: false, enabled: true })
    expect(result.current.play.playing).toBe(false)
    const frozen = result.current.cursorMs
    advance(1000)
    expect(result.current.cursorMs).toBe(frozen)
    rerender({ active: true, enabled: false })
    expect(result.current.play.playing).toBe(false)
  })

  it('restarts from the landing when played from the end', () => {
    const { result } = setup({ active: true, speedHPerS: 24 })
    act(() => result.current.play.toggle())
    advance(6000)
    expect(result.current.play.playing).toBe(false)
    act(() => result.current.play.toggle())
    advance(500)
    expect(result.current.cursorMs).toBeLessThan(T0 + 24 * HOUR_MS)
  })

  it('stop() pauses', () => {
    const { result } = setup({ active: true })
    act(() => result.current.play.toggle())
    act(() => result.current.play.stop())
    expect(result.current.play.playing).toBe(false)
  })
})
