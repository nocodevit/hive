import { describe, it, expect } from 'vitest'
import { parseContextSize } from '../context-size'
import { parseContextSize as fromRenderer } from '../../renderer/src/components/hive-chat/progress-bar'
import { parseContextSize as fromMain } from '../../main/handoff-supervisor'

/**
 * v2.5.1: parseContextSize was duplicated between main + renderer. Now
 * both re-export from src/shared/context-size.ts. These tests lock in
 * (a) the behavior contract and (b) that both re-exports are the
 * literal same function — so no future edit can silently reintroduce
 * two parallel implementations.
 */

describe('parseContextSize (shared)', () => {
  it('parses M suffix', () => {
    expect(parseContextSize('1M')).toBe(1_000_000)
    expect(parseContextSize('2M')).toBe(2_000_000)
  })
  it('parses K suffix', () => {
    expect(parseContextSize('200K')).toBe(200_000)
    expect(parseContextSize('1K')).toBe(1_000)
  })
  it('parses bare integer', () => {
    expect(parseContextSize('500000')).toBe(500_000)
  })
  it('parses fractional M / K', () => {
    expect(parseContextSize('1.5M')).toBe(1_500_000)
    expect(parseContextSize('2.5K')).toBe(2_500)
  })
  it('case-insensitive + trims whitespace', () => {
    expect(parseContextSize(' 1m ')).toBe(1_000_000)
    expect(parseContextSize('200k')).toBe(200_000)
  })
  it('returns 0 for garbage / null / undefined / empty', () => {
    expect(parseContextSize('')).toBe(0)
    expect(parseContextSize(undefined)).toBe(0)
    expect(parseContextSize(null)).toBe(0)
    expect(parseContextSize('abc')).toBe(0)
    expect(parseContextSize('1G')).toBe(0)  // G unit not supported
  })
  it('returns 0 for negative numbers (defensive)', () => {
    expect(parseContextSize('-1M')).toBe(0)  // regex won't match leading -
  })
})

describe('parseContextSize dedup guard (v2.5.1)', () => {
  it('renderer parseContextSize IS THE SAME reference as shared', () => {
    // Object identity check — proves the re-export chain, not just
    // behavior. Any accidental re-implementation would fail this.
    expect(fromRenderer).toBe(parseContextSize)
  })
  it('main parseContextSize IS THE SAME reference as shared', () => {
    expect(fromMain).toBe(parseContextSize)
  })
  it('all three produce identical output across the input matrix', () => {
    const inputs = ['1M', '200K', '500000', '1.5M', ' 1m ', '', 'abc', undefined, null]
    for (const inp of inputs) {
      const a = parseContextSize(inp as any)
      const b = fromRenderer(inp as any)
      const c = fromMain(inp as any)
      expect(b, `renderer disagreed on ${JSON.stringify(inp)}`).toBe(a)
      expect(c, `main disagreed on ${JSON.stringify(inp)}`).toBe(a)
    }
  })
})
