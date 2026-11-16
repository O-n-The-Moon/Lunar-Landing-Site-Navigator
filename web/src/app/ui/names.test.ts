import { describe, expect, it } from 'vitest'
import { formatClock, formatDayShort, siteLetter, splitSiteName } from './names'

describe('splitSiteName', () => {
  it('splits a trailing parenthesised region and shortens "… region"', () => {
    expect(splitSiteName('Haworth (Artemis III region)')).toEqual({ short: 'Haworth', region: 'Artemis III' })
    expect(splitSiteName('IM-2 Athena (Mons Mouton)')).toEqual({ short: 'IM-2 Athena', region: 'Mons Mouton' })
  })

  it('leaves a name without a region alone', () => {
    expect(splitSiteName('Shackleton rim')).toEqual({ short: 'Shackleton rim', region: null })
    expect(splitSiteName('Custom 85.12°S 30.40°E')).toEqual({ short: 'Custom 85.12°S 30.40°E', region: null })
  })
})

describe('siteLetter', () => {
  it('numbers sites A, B, C in scenario order', () => {
    expect([0, 1, 2].map(siteLetter)).toEqual(['A', 'B', 'C'])
  })
})

describe('time formatting (UTC)', () => {
  const t = Date.UTC(2029, 1, 20, 14, 5)
  it('formats a short day and a clock', () => {
    expect(formatDayShort(t)).toBe('20 Feb')
    expect(formatClock(t)).toBe('14:05')
  })
})
