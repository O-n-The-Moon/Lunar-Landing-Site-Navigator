import { describe, expect, it } from 'vitest'
import type { Window } from '../../engine'
import { SIGNAL_META, signalAt, siteSignal } from './site-status'

const win = (startMs: number, endMs: number): Window => ({ startMs, endMs }) as Window

describe('siteSignal', () => {
  it('maps the two flags to four states', () => {
    expect(siteSignal(true, true)).toBe('both')
    expect(siteSignal(true, false)).toBe('sun')
    expect(siteSignal(false, true)).toBe('earth')
    expect(siteSignal(false, false)).toBe('none')
  })

  it('words each state as what is visible, never as a GO/NO-GO decision', () => {
    expect(Object.values(SIGNAL_META).map((m) => m.short)).toEqual(['SUN + EARTH', 'SUN ONLY', 'EARTH ONLY', 'NO SUN, NO EARTH'])
    for (const m of Object.values(SIGNAL_META)) expect(m.short).not.toMatch(/GO/)
  })

  it('gives every state a distinct colour and a text label', () => {
    const metas = Object.values(SIGNAL_META)
    expect(new Set(metas.map((m) => m.color)).size).toBe(4)
    for (const m of metas) expect(m.label.length).toBeGreaterThan(3)
  })
})

describe('signalAt', () => {
  const run = { windows: { sun: [win(0, 100)], earth: [win(50, 200)] } } as never
  it('uses the half-open windows the timeline uses', () => {
    expect(signalAt(run, 10).signal).toBe('sun')
    expect(signalAt(run, 60)).toMatchObject({ signal: 'both', sunUp: true, earthUp: true })
    expect(signalAt(run, 100).signal).toBe('earth') // window end is exclusive
    expect(signalAt(run, 250).signal).toBe('none')
  })
})
