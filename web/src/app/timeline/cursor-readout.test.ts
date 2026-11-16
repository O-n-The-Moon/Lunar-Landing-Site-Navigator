import { describe, expect, it } from 'vitest'
import { azEl, bodyVectorKm, horizonElevAt } from '../../engine'
import { fixtureOutputs, fixtureScenario } from '../../engine/__fixtures__'
import { cursorReadout } from './cursor-readout'

const { ctx, samples } = fixtureOutputs['fixture-plateau']
const H_MS = 3_600_000

describe('cursorReadout', () => {
  it('reports the Sun elevation and clearance (elevation − terrain horizon at the Sun azimuth) at the cursor time', () => {
    const t = fixtureScenario.baselineLandingMs + 6 * H_MS
    const sun = azEl(ctx.frame, bodyVectorKm(ctx.eph, 'sun', t))
    const horizon = horizonElevAt(ctx.horizonMaskDeg, ctx.azStepDeg, sun.azDeg)
    const r = cursorReadout(ctx, t)
    expect(r.sunElevDeg).toBeCloseTo(sun.elevDeg, 9)
    expect(r.sunClearanceDeg).toBeCloseTo(sun.elevDeg - horizon, 9)
  })

  it('agrees with the engine samples at a sample time', () => {
    const i = Math.floor(samples.tUtcMs.length / 2)
    const r = cursorReadout(ctx, samples.tUtcMs[i])
    expect(r.sunElevDeg).toBeCloseTo(samples.sunElevDeg[i], 6)
    expect(r.sunClearanceDeg).toBeCloseTo(samples.sunElevDeg[i] - samples.sunHorizonDeg[i], 6)
  })

  it('throws the engine RangeError when the cursor is outside the ephemeris', () => {
    expect(() => cursorReadout(ctx, 0)).toThrow(RangeError)
  })
})
