import { describe, expect, it } from 'vitest'
import { DEFAULT_VISIBILITY_OPTS, NotImplementedError, notImplemented } from './types'

describe('notImplemented', () => {
  it('throws a NotImplementedError naming the function', () => {
    expect(() => notImplemented('azEl', 1, 2)).toThrow(NotImplementedError)
    expect(() => notImplemented('azEl')).toThrow(/azEl is not implemented/)
  })
})

describe('DEFAULT_VISIBILITY_OPTS', () => {
  it('matches the SPEC-engine defaults', () => {
    expect(DEFAULT_VISIBILITY_OPTS).toEqual({
      sunThreshold: 0.5,
      hysteresis: 0.05,
      earthMarginDeg: 1.0,
      earthHysteresisDeg: 0.1,
      observerHeightM: 2,
    })
  })
})
