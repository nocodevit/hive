import { describe, expect, it } from 'vitest'
import { computeGrainBar } from '../progress-bar'

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
