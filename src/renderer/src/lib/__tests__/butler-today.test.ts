import { describe, it, expect } from 'vitest'
import { dayTitle, headline, previousDay, shiftDate, toggleWeekday } from '../butler-today'

describe('butler-today', () => {
  it('formats a day title', () => {
    expect(dayTitle('2026-10-20')).toBe('Tue 20 Oct')
    expect(dayTitle('bad')).toBe('bad')
  })
  it('shifts dates across months', () => {
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31')
  })
  it('headline skips the late note', () => {
    expect(headline('> late · ran 20:10\n\nShipped v2.28.3\nmore')).toBe('Shipped v2.28.3')
  })
  it('previous day from a newest-first list', () => {
    expect(previousDay(['2026-10-20', '2026-10-16'], '2026-10-20')).toBe('2026-10-16')
    expect(previousDay(['2026-10-20'], '2026-10-20')).toBeNull()
  })
  it('toggles weekdays and keeps them sorted', () => {
    expect(toggleWeekday([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3])
  })
})
