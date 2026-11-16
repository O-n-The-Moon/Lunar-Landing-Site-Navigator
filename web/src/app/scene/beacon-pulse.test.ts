import { describe, expect, it } from 'vitest'
import { pulseAt, PULSE_MS } from './beacon-pulse'

describe('pulseAt', () => {
  it('has no pulse before the change or after it is over', () => {
    expect(pulseAt(-1)).toBeNull()
    expect(pulseAt(PULSE_MS)).toBeNull()
    expect(pulseAt(PULSE_MS * 3)).toBeNull()
  })

  it('grows and fades, never exceeding its bounds', () => {
    let prev = pulseAt(0)!
    expect(prev.scale).toBe(1)
    for (let t = 50; t < PULSE_MS; t += 50) {
      const p = pulseAt(t)!
      expect(p.scale).toBeGreaterThan(prev.scale)
      expect(p.opacity).toBeLessThan(prev.opacity)
      expect(p.opacity).toBeGreaterThan(0)
      prev = p
    }
  })

  it('is short enough not to be a distraction', () => {
    expect(PULSE_MS).toBeLessThanOrEqual(1000)
  })
})
