import { describe, it, expect } from 'vitest'
import { parseRetentionDays } from '../chat'

/**
 * Data-loss regression lock. Before the fix, ~/.hive/chat-logs was silently
 * pruned on every startup at 30-day mtime. Users lost history they never
 * agreed to lose. The contract now: sweep is OPT-IN via
 * HIVE_LOG_RETENTION_DAYS. Every "no-sweep" case below MUST return null so
 * the sweep function bails before touching the filesystem.
 */
describe('parseRetentionDays', () => {
  describe('no sweep (must return null)', () => {
    it('returns null when env var is undefined (default install case — the important one)', () => {
      expect(parseRetentionDays(undefined)).toBeNull()
    })
    it('returns null for empty string', () => {
      expect(parseRetentionDays('')).toBeNull()
    })
    it('returns null for non-numeric string', () => {
      expect(parseRetentionDays('forever')).toBeNull()
    })
    it('returns null for zero (0 is "never sweep", matching cleanupPeriodDays semantics)', () => {
      expect(parseRetentionDays('0')).toBeNull()
    })
    it('returns null for negative values', () => {
      expect(parseRetentionDays('-1')).toBeNull()
      expect(parseRetentionDays('-30')).toBeNull()
    })
    it('returns null for NaN / Infinity', () => {
      expect(parseRetentionDays('NaN')).toBeNull()
      expect(parseRetentionDays('Infinity')).toBeNull()
    })
    it('returns null for whitespace-only string', () => {
      // Number('   ') === 0, so this also parses to 0 → null via the ≤0 gate
      expect(parseRetentionDays('   ')).toBeNull()
    })
  })

  describe('sweep enabled (positive finite day count)', () => {
    it('parses "30" as 30 days (restoring old behavior for users who want it)', () => {
      expect(parseRetentionDays('30')).toBe(30)
    })
    it('parses "1" as 1 day (minimum viable)', () => {
      expect(parseRetentionDays('1')).toBe(1)
    })
    it('parses fractional days ("0.5" = half a day)', () => {
      expect(parseRetentionDays('0.5')).toBe(0.5)
    })
    it('parses large values ("3650" = 10 years)', () => {
      expect(parseRetentionDays('3650')).toBe(3650)
    })
  })
})
