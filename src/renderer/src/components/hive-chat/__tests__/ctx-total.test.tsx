// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { extractCtxTotalFromUsage } from '../index'

/**
 * Pure-function tests for the usage → context-token sum reducer.
 * Both the live `result` handler AND the historical replay
 * (assistant.message.usage) handler call this. A regression here
 * means: ctx % bar shows wrong value after resume / wrong value
 * during normal streaming.
 */
describe('extractCtxTotalFromUsage', () => {
  it('returns 0 for null/undefined usage', () => {
    expect(extractCtxTotalFromUsage(null)).toBe(0)
    expect(extractCtxTotalFromUsage(undefined)).toBe(0)
    expect(extractCtxTotalFromUsage({})).toBe(0)
  })

  it('uses iterations[-1] not the top-level usage', () => {
    // Top-level cache_read is the cumulative sum across an agentic
    // turn — using it would balloon ctx % to >100% on long turns.
    // The contract is: pull from iterations[-1] when present.
    const usage = {
      input_tokens: 999,           // top-level (would-be wrong)
      cache_read_input_tokens: 999_999,
      cache_creation_input_tokens: 999,
      iterations: [
        { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 200 },
        { input_tokens: 5, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 } // last
      ]
    }
    // From iterations[-1]: 5 + 500 + 50 — top-level numbers ignored.
    expect(extractCtxTotalFromUsage(usage)).toBe(555)
  })

  it('falls back to top-level when iterations is missing/empty', () => {
    expect(extractCtxTotalFromUsage({
      input_tokens: 10, cache_read_input_tokens: 90
    })).toBe(100)
    expect(extractCtxTotalFromUsage({
      input_tokens: 10, cache_read_input_tokens: 90, iterations: []
    })).toBe(100)
  })

  it('treats missing usage fields as 0 (not NaN)', () => {
    expect(extractCtxTotalFromUsage({ input_tokens: 100 })).toBe(100)
    // Without cache fields, sum is just input_tokens (not NaN propagating)
    expect(extractCtxTotalFromUsage({ iterations: [{ input_tokens: 50 }] })).toBe(50)
  })

  it('rejects non-numeric fields (defensive)', () => {
    expect(extractCtxTotalFromUsage({
      input_tokens: '100' as any,        // string — rejected
      cache_read_input_tokens: null as any
    })).toBe(0)
  })

  it('post-compact session realistic flow: returns small total', () => {
    // After /compact, claude shows tiny iterations[-1].
    // We must reflect this small number, NOT the cumulative cache_read.
    const usage = {
      input_tokens: 1,
      cache_read_input_tokens: 49_500,    // post-compact baseline
      cache_creation_input_tokens: 500,
      iterations: [{ input_tokens: 1, cache_read_input_tokens: 49_500, cache_creation_input_tokens: 500 }]
    }
    expect(extractCtxTotalFromUsage(usage)).toBe(50_001)  // ~5% of 1M
  })

  it('ignores invalid iterations entry shapes', () => {
    expect(extractCtxTotalFromUsage({
      iterations: [null as any, { foo: 'bar' } as any]   // last is non-numeric
    })).toBe(0)
  })
})
