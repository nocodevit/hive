// @vitest-environment jsdom
//
// formatTimeSince tests — the dept-list time-since chip depends on
// this bucketing. Test every bucket boundary and the two edge cases
// (never-seen, distant past).

import { describe, it, expect } from 'vitest'
import { formatTimeSince } from '../timeSince'

const NOW = 1_735_000_000_000  // arbitrary fixed epoch
const s  = 1000
const m  = 60 * s
const h  = 60 * m
const d  = 24 * h
const w  = 7 * d
const mo = 30 * d
const y  = 365 * d

describe('formatTimeSince', () => {
  it('returns empty string when the timestamp is undefined (never seen)', () => {
    expect(formatTimeSince(undefined, NOW)).toBe('')
  })

  it('clamps negative delta (future timestamps) to "now"', () => {
    expect(formatTimeSince(NOW + 10 * s, NOW)).toBe('now')
  })

  it('under 60s reads as "now"', () => {
    expect(formatTimeSince(NOW - 0, NOW)).toBe('now')
    expect(formatTimeSince(NOW - 59 * s, NOW)).toBe('now')
  })

  it('minutes bucket (60s..59m)', () => {
    expect(formatTimeSince(NOW - 60 * s, NOW)).toBe('1m')
    expect(formatTimeSince(NOW - 4 * m, NOW)).toBe('4m')
    expect(formatTimeSince(NOW - 59 * m, NOW)).toBe('59m')
  })

  it('hours bucket (1h..23h)', () => {
    expect(formatTimeSince(NOW - 60 * m, NOW)).toBe('1h')
    expect(formatTimeSince(NOW - 2 * h, NOW)).toBe('2h')
    expect(formatTimeSince(NOW - 23 * h, NOW)).toBe('23h')
  })

  it('days bucket (1d..6d)', () => {
    expect(formatTimeSince(NOW - 24 * h, NOW)).toBe('1d')
    expect(formatTimeSince(NOW - 3 * d, NOW)).toBe('3d')
    expect(formatTimeSince(NOW - 6 * d, NOW)).toBe('6d')
  })

  it('weeks bucket (1w..4w)', () => {
    expect(formatTimeSince(NOW - 7 * d, NOW)).toBe('1w')
    expect(formatTimeSince(NOW - 4 * w, NOW)).toBe('4w')
  })

  it('months bucket (5w..11mo)', () => {
    expect(formatTimeSince(NOW - 35 * d, NOW)).toBe('1mo')
    expect(formatTimeSince(NOW - 6 * mo, NOW)).toBe('6mo')
  })

  it('years bucket (>= 1y)', () => {
    expect(formatTimeSince(NOW - y, NOW)).toBe('1y')
    expect(formatTimeSince(NOW - 3 * y, NOW)).toBe('3y')
  })

  it('return value never exceeds 4 characters (fixed-slot layout guard)', () => {
    // The dept-list slot pins the chip to a small mono-width cell.
    // A "12mo" bucket exists — keep an eye on it.
    const samples = [0, 30 * s, 2 * m, 3 * h, 1 * d, 3 * w, 6 * mo, 5 * y]
    for (const ago of samples) {
      const out = formatTimeSince(NOW - ago, NOW)
      expect(out.length, `too long for "${out}"`).toBeLessThanOrEqual(4)
    }
  })
})
