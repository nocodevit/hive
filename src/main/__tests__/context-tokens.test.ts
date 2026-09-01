// v2.17.1 — regression tests for the "1400% used" context miscalculation.
//
// User complaint: the ctx nag read
//   "1400% used (14,003,445 / 1,000,000 tokens) · run /compact to summarize
//    history"
// on a session whose real context was 620,606 tokens (62%).
//
// Root cause: the SAME usage field names mean different things on different
// events. assistant.message.usage is PER-REQUEST; result.usage is
// TURN-CUMULATIVE — its cache_read_input_tokens sums every tool-loop
// iteration. The extractor read iterations[-1] when present but FELL BACK to
// the top-level object when `iterations` was absent, handing back exactly the
// cumulative number the iterations lookup existed to avoid.
//
// The numbers below are the real payload from
// ~/.hive/chat-logs/chat-agent-1780455224061-1788232869622.jsonl.

import { describe, it, expect } from 'vitest'
import { perRequestContextTokens, contextTokensFromResultUsage } from '../../shared/context-size'

// The exact result-event usage that rendered 1400%: iterations empty, and a
// cache_read that is the running total across the whole turn.
const THE_1400_PERCENT_USAGE = {
  input_tokens: 46,
  cache_creation_input_tokens: 36955,
  cache_read_input_tokens: 13966444,
  output_tokens: 27613,
  iterations: []
}

describe('contextTokensFromResultUsage', () => {
  it('refuses the cumulative top-level total when iterations is EMPTY (the bug)', () => {
    // 46 + 36,955 + 13,966,444 = 14,003,445 — the number that shipped.
    expect(perRequestContextTokens(THE_1400_PERCENT_USAGE)).toBe(14_003_445)
    // The result-event reader must NOT return it. 0 = "cannot tell", which
    // leaves the accurate assistant-derived value in place.
    expect(contextTokensFromResultUsage(THE_1400_PERCENT_USAGE)).toBe(0)
  })

  it('refuses it when iterations is absent entirely', () => {
    const { iterations: _drop, ...noIterations } = THE_1400_PERCENT_USAGE
    expect(contextTokensFromResultUsage(noIterations)).toBe(0)
  })

  it('uses iterations[-1] — the final model-visible state — when present', () => {
    // Real shape: top level is cumulative, the iteration is per-request.
    const usage = {
      input_tokens: 3417,
      cache_read_input_tokens: 13_532_047,
      cache_creation_input_tokens: 0,
      iterations: [
        { input_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0 },
        { input_tokens: 3417, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 4312 }
      ]
    }
    expect(contextTokensFromResultUsage(usage)).toBe(247_729)
  })

  it('returns 0 for junk instead of throwing', () => {
    expect(contextTokensFromResultUsage(null)).toBe(0)
    expect(contextTokensFromResultUsage(undefined)).toBe(0)
    expect(contextTokensFromResultUsage('nope')).toBe(0)
    expect(contextTokensFromResultUsage({})).toBe(0)
    expect(contextTokensFromResultUsage({ iterations: 'not-an-array' })).toBe(0)
  })
})

describe('perRequestContextTokens', () => {
  it('sums input + both cache buckets of ONE request', () => {
    // The true reading from the same session's last assistant event: 62%, not 1400%.
    expect(perRequestContextTokens({
      input_tokens: 2,
      cache_read_input_tokens: 620_604,
      cache_creation_input_tokens: 0
    })).toBe(620_606)
  })

  it('treats missing / non-numeric / negative fields as zero', () => {
    expect(perRequestContextTokens({})).toBe(0)
    expect(perRequestContextTokens({ input_tokens: '5', cache_read_input_tokens: 10 })).toBe(10)
    expect(perRequestContextTokens({ input_tokens: -5, cache_read_input_tokens: 10 })).toBe(10)
    expect(perRequestContextTokens({ input_tokens: NaN, cache_read_input_tokens: 10 })).toBe(10)
    expect(perRequestContextTokens(null)).toBe(0)
  })

  it('a 1M-window session stays under 100% on the corrected reading', () => {
    const pct = (perRequestContextTokens({ input_tokens: 2, cache_read_input_tokens: 620_604 }) / 1_000_000) * 100
    expect(Math.round(pct)).toBe(62)
  })
})
