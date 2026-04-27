import { describe, expect, it } from 'vitest'
import { computeGrainBar, parseContextSize, selectCtxNagTier, selectCompactBtnTier } from '../progress-bar'

describe('computeGrainBar', () => {
  it('default total = 10', () => {
    expect(computeGrainBar(0)).toEqual({ filled: 0, empty: 10 })
    expect(computeGrainBar(50)).toEqual({ filled: 5, empty: 5 })
    expect(computeGrainBar(100)).toEqual({ filled: 10, empty: 0 })
  })

  it('rounds to nearest cell', () => {
    expect(computeGrainBar(23)).toEqual({ filled: 2, empty: 8 })
    expect(computeGrainBar(25)).toEqual({ filled: 3, empty: 7 })
    expect(computeGrainBar(94)).toEqual({ filled: 9, empty: 1 })
  })

  it('clamps below 0 / above 100', () => {
    expect(computeGrainBar(-5)).toEqual({ filled: 0, empty: 10 })
    expect(computeGrainBar(150)).toEqual({ filled: 10, empty: 0 })
  })

  it('treats undefined / NaN as empty bar', () => {
    expect(computeGrainBar(undefined)).toEqual({ filled: 0, empty: 10 })
    expect(computeGrainBar(NaN)).toEqual({ filled: 0, empty: 10 })
  })

  it('respects custom total', () => {
    expect(computeGrainBar(50, 20)).toEqual({ filled: 10, empty: 10 })
    expect(computeGrainBar(33, 6)).toEqual({ filled: 2, empty: 4 })
  })

  it('preserves filled+empty == total invariant', () => {
    for (const pct of [0, 1, 7, 33, 50, 67, 99, 100]) {
      const { filled, empty } = computeGrainBar(pct, 10)
      expect(filled + empty).toBe(10)
    }
  })
})

describe('parseContextSize', () => {
  it('parses M / K suffix case-insensitively', () => {
    expect(parseContextSize('1M')).toBe(1_000_000)
    expect(parseContextSize('200K')).toBe(200_000)
    expect(parseContextSize('1m')).toBe(1_000_000)
    expect(parseContextSize('200k')).toBe(200_000)
  })

  it('returns 0 for empty / undefined / unrecognized', () => {
    expect(parseContextSize('')).toBe(0)
    expect(parseContextSize(undefined)).toBe(0)
    expect(parseContextSize('abc')).toBe(0)
    expect(parseContextSize('1G')).toBe(0)
    expect(parseContextSize('M')).toBe(0)
  })
})

describe('selectCtxNagTier', () => {
  const both = { warn: false, urgent: false }
  const dWarn = { warn: true, urgent: false }
  const dUrgent = { warn: false, urgent: true }
  const dBoth = { warn: true, urgent: true }

  it('< 80 → no nag regardless of dismissal', () => {
    expect(selectCtxNagTier(0, both)).toBe(null)
    expect(selectCtxNagTier(50, both)).toBe(null)
    expect(selectCtxNagTier(79, both)).toBe(null)
    expect(selectCtxNagTier(79, dBoth)).toBe(null)
  })

  it('80-89 → warn (unless dismissed)', () => {
    expect(selectCtxNagTier(80, both)).toBe('warn')
    expect(selectCtxNagTier(85, both)).toBe('warn')
    expect(selectCtxNagTier(89, both)).toBe('warn')
    expect(selectCtxNagTier(85, dWarn)).toBe(null)
    expect(selectCtxNagTier(85, dUrgent)).toBe('warn')  // urgent dismissal doesn't affect warn
  })

  it('>= 90 → urgent (unless dismissed)', () => {
    expect(selectCtxNagTier(90, both)).toBe('urgent')
    expect(selectCtxNagTier(95, both)).toBe('urgent')
    expect(selectCtxNagTier(150, both)).toBe('urgent')
    expect(selectCtxNagTier(95, dUrgent)).toBe(null)
    expect(selectCtxNagTier(95, dWarn)).toBe('urgent')  // warn dismissal doesn't affect urgent
  })
})

describe('selectCompactBtnTier', () => {
  it('< 60 → normal', () => {
    expect(selectCompactBtnTier(0)).toBe('normal')
    expect(selectCompactBtnTier(30)).toBe('normal')
    expect(selectCompactBtnTier(59)).toBe('normal')
  })
  it('60-79 → warn', () => {
    expect(selectCompactBtnTier(60)).toBe('warn')
    expect(selectCompactBtnTier(70)).toBe('warn')
    expect(selectCompactBtnTier(79)).toBe('warn')
  })
  it('>= 80 → urgent', () => {
    expect(selectCompactBtnTier(80)).toBe('urgent')
    expect(selectCompactBtnTier(95)).toBe('urgent')
    expect(selectCompactBtnTier(150)).toBe('urgent')
  })
})
