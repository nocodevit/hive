import { describe, it, expect } from 'vitest'
import {
  AUTO_COMPACT_PCT_THRESHOLD,
  emptyStats,
  extractInputTokens,
  parseContextSize,
  shouldTriggerAutoCompact
} from '../handoff-supervisor'

/**
 * v2.5.0: Handoff auto-compact when context ≥ 70%.
 * User directives locked here:
 *   - 70% threshold hardcoded (no throttle / no min-interval — every
 *     compact drops context <10% per user, so re-fire is fine)
 *   - Silent success (no notifications)
 *   - Retry once on failure, halt on second failure (asserted in
 *     supervisor test elsewhere)
 */
describe('handoff-supervisor v2.5.0 auto-compact', () => {
  it('AUTO_COMPACT_PCT_THRESHOLD is 0.70 (locked per user directive)', () => {
    expect(AUTO_COMPACT_PCT_THRESHOLD).toBe(0.70)
  })

  describe('extractInputTokens', () => {
    it('pulls input_tokens from assistant.message.usage', () => {
      const ev = { type: 'assistant', message: { usage: { input_tokens: 12345 } } }
      expect(extractInputTokens(ev)).toBe(12345)
    })
    it('returns null when usage is missing', () => {
      expect(extractInputTokens({ type: 'assistant', message: {} })).toBeNull()
      expect(extractInputTokens({ type: 'assistant' })).toBeNull()
    })
    it('returns null on non-assistant events', () => {
      expect(extractInputTokens({ type: 'user', message: { usage: { input_tokens: 1 } } })).toBeNull()
      expect(extractInputTokens({ type: 'result', usage: { input_tokens: 1 } })).toBeNull()
    })
    it('returns null for non-numeric or negative tokens (defensive)', () => {
      expect(extractInputTokens({ type: 'assistant', message: { usage: { input_tokens: 'lots' } } })).toBeNull()
      expect(extractInputTokens({ type: 'assistant', message: { usage: { input_tokens: -1 } } })).toBeNull()
    })
  })

  describe('parseContextSize', () => {
    it('handles "1M" → 1_000_000', () => {
      expect(parseContextSize('1M')).toBe(1_000_000)
    })
    it('handles "200K" → 200_000', () => {
      expect(parseContextSize('200K')).toBe(200_000)
    })
    it('handles bare integer', () => {
      expect(parseContextSize('500000')).toBe(500_000)
    })
    it('handles fractional M / K', () => {
      expect(parseContextSize('1.5M')).toBe(1_500_000)
      expect(parseContextSize('2.5K')).toBe(2_500)
    })
    it('case-insensitive + trims whitespace', () => {
      expect(parseContextSize(' 1m ')).toBe(1_000_000)
      expect(parseContextSize('200k')).toBe(200_000)
    })
    it('returns 0 for garbage (defensive; supervisor skips auto-compact when 0)', () => {
      expect(parseContextSize('')).toBe(0)
      expect(parseContextSize('abc')).toBe(0)
      expect(parseContextSize('1G')).toBe(0)  // no G unit support
    })
  })

  describe('shouldTriggerAutoCompact', () => {
    it('true when pct >= 0.70 and running and not already compacting', () => {
      expect(shouldTriggerAutoCompact(0.70, 'running', false)).toBe(true)
      expect(shouldTriggerAutoCompact(0.85, 'running', false)).toBe(true)
    })
    it('false when just below threshold', () => {
      expect(shouldTriggerAutoCompact(0.6999, 'running', false)).toBe(false)
    })
    it('false when already compacting (re-entry guard — critical)', () => {
      expect(shouldTriggerAutoCompact(0.90, 'running', true)).toBe(false)
    })
    it('false when status is not running (paused / compacting / stopped)', () => {
      expect(shouldTriggerAutoCompact(0.90, 'paused', false)).toBe(false)
      expect(shouldTriggerAutoCompact(0.90, 'compacting', false)).toBe(false)
      expect(shouldTriggerAutoCompact(0.90, 'done', false)).toBe(false)
      expect(shouldTriggerAutoCompact(0.90, 'stopped', false)).toBe(false)
    })
    it('false when pct is NaN / negative / non-finite (defensive)', () => {
      expect(shouldTriggerAutoCompact(NaN, 'running', false)).toBe(false)
      expect(shouldTriggerAutoCompact(-0.5, 'running', false)).toBe(false)
      expect(shouldTriggerAutoCompact(Infinity, 'running', false)).toBe(false)  // Infinity = no meaningful pct data; skip
    })
    it('accepts a custom threshold arg (in case future breakers exposes it)', () => {
      expect(shouldTriggerAutoCompact(0.55, 'running', false, 0.5)).toBe(true)
      expect(shouldTriggerAutoCompact(0.65, 'running', false, 0.9)).toBe(false)
    })
  })

  describe('emptyStats includes v2.5.0 fields', () => {
    it('initializes autoCompactCount and autoCompactCostUsd to 0', () => {
      const s = emptyStats()
      expect(s.autoCompactCount).toBe(0)
      expect(s.autoCompactCostUsd).toBe(0)
    })
  })
})
