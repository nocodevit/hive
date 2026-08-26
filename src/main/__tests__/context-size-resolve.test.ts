// v2.15.4 — regression tests for resolveContextSizeTokens.
//
// User complaint: 'context 都 81% 了, 你在 handoff 里没有 compact 啊'.
// Root cause: claude-opus-5's system:init emits {type, subtype,
// session_id, model} WITHOUT contextSize. Handoff supervisor read
// event.contextSize, got undefined, kept contextSizeTokens=0, and
// the auto-compact gate `contextSizeTokens > 0` always failed.
//
// resolveContextSizeTokens must gracefully fall back to model-name
// inference (haiku = 200K, everything else = 1M) so the gate works.

import { describe, it, expect } from 'vitest'
import { parseContextSize, resolveContextSizeTokens } from '../../shared/context-size'

describe('parseContextSize (baseline coverage)', () => {
  it('parses M/K suffixes', () => {
    expect(parseContextSize('1M')).toBe(1_000_000)
    expect(parseContextSize('200K')).toBe(200_000)
    expect(parseContextSize('1.5M')).toBe(1_500_000)
  })
  it('returns 0 on unrecognized/absent input', () => {
    expect(parseContextSize(undefined)).toBe(0)
    expect(parseContextSize('')).toBe(0)
    expect(parseContextSize('nope')).toBe(0)
  })
})

describe('resolveContextSizeTokens (v2.15.4)', () => {
  it('uses the explicit contextSize when present ("1M")', () => {
    expect(resolveContextSizeTokens('1M', 'claude-opus-5')).toBe(1_000_000)
  })

  it('uses the explicit contextSize when present ("200K" for haiku override)', () => {
    // If claude explicitly says the window is smaller than the default
    // inference, honor it. e.g. haiku running at reduced ctx.
    expect(resolveContextSizeTokens('200K', 'claude-opus-5')).toBe(200_000)
  })

  it('FALLS BACK to 1M for non-haiku models when contextSize is undefined', () => {
    // This is the real-world fix: claude-opus-5 system:init has no
    // contextSize field at all. Pre-fix we returned 0 → auto-compact
    // never triggered → user hit 81% ctx with no compact.
    expect(resolveContextSizeTokens(undefined, 'claude-opus-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens(undefined, 'claude-sonnet-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens(undefined, 'claude-fable-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens(undefined, 'claude-opus-4-7')).toBe(1_000_000)
  })

  it('FALLS BACK to 200K for haiku models', () => {
    expect(resolveContextSizeTokens(undefined, 'claude-haiku-4-5-20251001')).toBe(200_000)
    expect(resolveContextSizeTokens(undefined, 'claude-haiku-4')).toBe(200_000)
    // Case-insensitive.
    expect(resolveContextSizeTokens(undefined, 'CLAUDE-HAIKU-3')).toBe(200_000)
  })

  it('returns 0 when both explicit and model are absent', () => {
    // Nothing to work with — supervisor bails out cleanly rather than
    // computing a nonsense pct.
    expect(resolveContextSizeTokens(undefined, undefined)).toBe(0)
    expect(resolveContextSizeTokens(null, null)).toBe(0)
    expect(resolveContextSizeTokens('', '')).toBe(0)
  })

  it('falls back on model when explicit is empty string / bad type / unparsable', () => {
    expect(resolveContextSizeTokens('', 'claude-opus-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens(null, 'claude-opus-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens('nope', 'claude-opus-5')).toBe(1_000_000)
    expect(resolveContextSizeTokens(42 as any, 'claude-opus-5')).toBe(1_000_000)
  })

  it('the auto-compact gate would now trigger at 81% ctx (user`s reported scenario)', () => {
    // Simulates the exact user scenario. Post-fix path:
    //   1. system:init { model: 'claude-opus-5' } (no contextSize)
    //   2. resolveContextSizeTokens('undefined', 'claude-opus-5') → 1_000_000
    //   3. assistant event with usage.input_tokens = 810_000 → h.lastInputTokens
    //   4. pct = 810_000 / 1_000_000 = 0.81
    //   5. shouldTriggerAutoCompact(0.81, ...) → true (threshold 0.7)
    //   6. tryAutoCompact fires → compact runs
    const contextSizeTokens = resolveContextSizeTokens(undefined, 'claude-opus-5')
    const lastInputTokens = 810_000
    const pct = lastInputTokens / contextSizeTokens
    expect(contextSizeTokens).toBe(1_000_000)
    expect(pct).toBeCloseTo(0.81, 2)
    expect(pct).toBeGreaterThan(0.70)
  })
})
