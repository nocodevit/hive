import { describe, it, expect } from 'vitest'
import { dayTitle, headline, previousDay, routineToday, shiftDate, toggleWeekday } from '../butler-today'

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
  describe('routineToday', () => {
    const wed = (h: number, m = 0) => new Date(2026, 9, 21, h, m)
    const daily = { enabled: true, schedule: { kind: 'times' as const, times: ['08:30'] } }
    const inbox = { enabled: true, schedule: { kind: 'interval' as const, everyMin: 30, fromHour: 9, toHour: 19 } }
    const wk = [1, 2, 3, 4, 5]
    it('off when disabled or not a working day', () => {
      expect(routineToday({ ...daily, enabled: false }, wk, undefined, wed(10))).toEqual({ state: 'off', label: 'off' })
      expect(routineToday(daily, [1], undefined, wed(10))).toEqual({ state: 'off', label: 'not today' })
    })
    it('next before the first slot, missed after it without a run', () => {
      expect(routineToday(daily, wk, undefined, wed(8))).toEqual({ state: 'next', label: 'next 08:30' })
      expect(routineToday(daily, wk, undefined, wed(10))).toEqual({ state: 'missed', label: 'missed 08:30' })
    })
    it('ran or failed today, a run from yesterday does not count', () => {
      expect(routineToday(daily, wk, { at: wed(8, 31).getTime(), ok: true }, wed(10)).label).toBe('ran 08:31')
      expect(routineToday(daily, wk, { at: wed(8, 31).getTime(), ok: true, late: true }, wed(10)).label).toBe('ran 08:31 (late)')
      expect(routineToday(daily, wk, { at: wed(8, 31).getTime(), ok: false }, wed(10)).state).toBe('failed')
      expect(routineToday(daily, wk, { at: new Date(2026, 9, 20, 8, 31).getTime(), ok: true }, wed(10)).state).toBe('missed')
    })
    it('interval routines show the next slot', () => {
      expect(routineToday(inbox, wk, { at: wed(14, 30).getTime(), ok: true }, wed(14, 40)).label).toBe('ran 14:30 · next 15:00')
      expect(routineToday(inbox, wk, undefined, wed(7)).label).toBe('next 09:00')
      expect(routineToday(inbox, wk, undefined, wed(9, 10)).label).toBe('missed 09:00 · next 09:30')
    })
  })
})
