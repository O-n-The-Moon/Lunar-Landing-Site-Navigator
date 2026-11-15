import { describe, expect, it } from 'vitest'
import { diffMetrics } from './metrics'
import type { MissionMetrics } from './types'

const T0 = Date.UTC(2026, 0, 1)

function metrics(overrides: Partial<MissionMetrics> = {}): MissionMetrics {
  return {
    landingMs: T0,
    durationH: 336,
    sunlitPct: 80,
    earthPct: 60,
    bothPct: 50,
    longestSunGapH: 40,
    longestEarthGapH: 100,
    firstSunsetH: 200,
    firstEarthsetH: 150,
    meanSunFraction: 0.75,
    ...overrides,
  }
}

describe('diffMetrics', () => {
  it('returns slipped − baseline for every numeric metric', () => {
    const a = metrics()
    const b = metrics({ sunlitPct: 70, earthPct: 65, bothPct: 40, longestSunGapH: 55, longestEarthGapH: 90, meanSunFraction: 0.6 })
    const d = diffMetrics(a, b)
    expect(d.sunlitPct).toBeCloseTo(-10, 12)
    expect(d.earthPct).toBeCloseTo(5, 12)
    expect(d.bothPct).toBeCloseTo(-10, 12)
    expect(d.longestSunGapH).toBeCloseTo(15, 12)
    expect(d.longestEarthGapH).toBeCloseTo(-10, 12)
    expect(d.meanSunFraction).toBeCloseTo(-0.15, 12)
  })

  it('marks a first event that moves as shifted, with deltaH = b − a', () => {
    const d = diffMetrics(metrics({ firstSunsetH: 200 }), metrics({ firstSunsetH: 176.5 }))
    expect(d.firstSunsetH).toEqual({ deltaH: -23.5, change: 'shifted' })
  })

  it('marks an equal first event as none with deltaH 0', () => {
    expect(diffMetrics(metrics(), metrics()).firstEarthsetH).toEqual({ deltaH: 0, change: 'none' })
  })

  it('marks an event that only the slipped mission has as appeared', () => {
    const d = diffMetrics(metrics({ firstSunsetH: null }), metrics({ firstSunsetH: 12 }))
    expect(d.firstSunsetH).toEqual({ deltaH: null, change: 'appeared' })
  })

  it('marks an event that only the baseline has as disappeared', () => {
    const d = diffMetrics(metrics({ firstEarthsetH: 12 }), metrics({ firstEarthsetH: null }))
    expect(d.firstEarthsetH).toEqual({ deltaH: null, change: 'disappeared' })
  })

  it('marks an event that neither mission has as none', () => {
    const d = diffMetrics(metrics({ firstSunsetH: null }), metrics({ firstSunsetH: null }))
    expect(d.firstSunsetH).toEqual({ deltaH: null, change: 'none' })
  })
})
