import { describe, expect, it } from 'vitest'
import { formatClock, formatDayShort, formatElapsed, formatMissionClock, siteLetter, splitSiteName } from './names'

const HOUR_MS = 3_600_000

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

  it('formats mission elapsed time as L+days hours', () => {
    expect(formatElapsed(0)).toBe('L+0d 00h')
    expect(formatElapsed(28 * HOUR_MS)).toBe('L+1d 04h')
    expect(formatElapsed(-HOUR_MS)).toBe('L+0d 00h')
  })

  it('formats the top-bar mission clock from the cursor and the slipped landing', () => {
    const landing = Date.UTC(2026, 2, 16)
    expect(formatMissionClock(landing + 48 * HOUR_MS, landing)).toBe('L+2d 00h · 18 Mar 2026 00:00 UTC')
    expect(formatMissionClock(t, t - 5 * HOUR_MS)).toBe('L+0d 05h · 20 Feb 2029 14:05 UTC')
  })
})
