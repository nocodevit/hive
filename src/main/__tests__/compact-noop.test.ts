// v2.15.3 — no-op compact detector.
//
// User: "为什么 compact 总是不成功". Diagnosed via ~/.hive/compact-log.jsonl:
// 30 entries with ok=true, durationMs≈3000, resultUsd=0. Claude's /compact
// returned {subtype:'success', is_error:false} without ever calling the
// LLM summarization API (proven by cost=0). Hive broadcast '✅ /compact
// done in 3s', ctx% didn't drop, user concluded compact was broken.
//
// isCompactNoop lets the caller flip a "success" result into a truthful
// warning: '❌ /compact no-op (LLM never called...) — context UNCHANGED'.

import { describe, it, expect } from 'vitest'
import { isCompactNoop } from '../chat'

describe('isCompactNoop — detect zero-cost fast "success"', () => {
  it('FIRES on the real-world pattern (usd=0, dur≈3s)', () => {
    const ev = { subtype: 'success', is_error: false, total_cost_usd: 0, duration_ms: 25 }
    expect(isCompactNoop(ev, 3101)).toBe(true)
  })

  it('FIRES on ANY zero-cost result under 10s', () => {
    expect(isCompactNoop({ total_cost_usd: 0 }, 100)).toBe(true)
    expect(isCompactNoop({ total_cost_usd: 0 }, 9999)).toBe(true)
  })

  it('does NOT fire on real compact (cost > 0)', () => {
    // Real compact costs $2-4 and takes 2-3 minutes.
    const ev = { subtype: 'success', total_cost_usd: 2.80, duration_ms: 182154 }
    expect(isCompactNoop(ev, 184850)).toBe(false)
  })

  it('does NOT fire on a fast-but-costed result (edge: cost > 0 in <10s)', () => {
    // If claude's summarization somehow completes in 8s and cost $0.05,
    // that's a legit (very small) compact, not a no-op.
    expect(isCompactNoop({ total_cost_usd: 0.05 }, 8000)).toBe(false)
  })

  it('does NOT fire on long-but-zero-cost (unlikely — but rules it out)', () => {
    // If somehow a zero-cost run took 30s (long connect, then cached
    // reply?), treat as real. Better to under-flag than over-flag.
    expect(isCompactNoop({ total_cost_usd: 0 }, 30_000)).toBe(false)
  })

  it('does NOT fire on missing / non-numeric cost (fail-safe)', () => {
    // If claude's stream omits total_cost_usd, we can't classify. Assume
    // real compact so we don't spuriously warn users.
    expect(isCompactNoop({ subtype: 'success' }, 3000)).toBe(false)
    expect(isCompactNoop({ subtype: 'success', total_cost_usd: 'nope' as any }, 3000)).toBe(false)
    expect(isCompactNoop({ subtype: 'success', total_cost_usd: null as any }, 3000)).toBe(false)
  })

  it('does NOT fire on null / undefined result event', () => {
    expect(isCompactNoop(null, 3000)).toBe(false)
    expect(isCompactNoop(undefined, 3000)).toBe(false)
  })
})
