import { describe, it, expect, vi } from 'vitest'
import { UsageCache } from '../usage-cache'

describe('UsageCache', () => {
  describe('TTL caching', () => {
    it('first call invokes both fetchers, second call within TTL does not', async () => {
      let now = 1000
      const fetchCc = vi.fn().mockResolvedValue({ costUSD: 1 })
      const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 25 })
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => now })

      await cache.get()
      now += 4000  // still within TTL
      await cache.get()

      expect(fetchCc).toHaveBeenCalledTimes(1)
      expect(fetchPct).toHaveBeenCalledTimes(1)
    })

    it('call after TTL expires re-invokes both fetchers', async () => {
      let now = 1000
      const fetchCc = vi.fn().mockResolvedValue({ costUSD: 1 })
      const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 25 })
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => now })

      await cache.get()
      now += 5001
      await cache.get()

      expect(fetchCc).toHaveBeenCalledTimes(2)
      expect(fetchPct).toHaveBeenCalledTimes(2)
    })
  })

  describe('single-flight dedup', () => {
    it('concurrent calls collapse to a single fetch', async () => {
      const fetchCc = vi.fn(() => new Promise(r => setTimeout(() => r({ costUSD: 1 }), 50)))
      const fetchPct = vi.fn(() => new Promise(r => setTimeout(() => r({ fiveHour: 25 }), 50)))
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct })

      const [a, b, c] = await Promise.all([cache.get(), cache.get(), cache.get()])

      expect(fetchCc).toHaveBeenCalledTimes(1)
      expect(fetchPct).toHaveBeenCalledTimes(1)
      expect(a).toBe(b)
      expect(b).toBe(c)
    })
  })

  describe('caching null results (Issue #7 regression)', () => {
    it('caches even when both fetchers return null — does NOT re-spawn next call within TTL', async () => {
      let now = 1000
      const fetchCc = vi.fn().mockResolvedValue(null)
      const fetchPct = vi.fn().mockResolvedValue(null)
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => now })

      const v1 = await cache.get()
      now += 1000
      const v2 = await cache.get()

      // Pre-fix: every call would re-spawn ccusage when pct was null
      // because chat.ts had `if (pct) usageCache = result`. Hammered CPU
      // on machines where queryUsagePctViaPty was failing.
      expect(fetchCc).toHaveBeenCalledTimes(1)
      expect(fetchPct).toHaveBeenCalledTimes(1)
      expect(v1.cc).toBeNull()
      expect(v1.pct).toBeNull()
      expect(v2).toBe(v1)
    })

    it('caches partial results — cc succeeds but pct fails, vice versa', async () => {
      let now = 1000
      const fetchCc = vi.fn().mockResolvedValue({ costUSD: 1 })
      const fetchPct = vi.fn().mockResolvedValue(null)
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => now })

      await cache.get()
      now += 1000
      const v2 = await cache.get()

      expect(fetchCc).toHaveBeenCalledTimes(1)
      expect(v2.cc).toEqual({ costUSD: 1 })
      expect(v2.pct).toBeNull()
    })
  })

  describe('error swallowing', () => {
    it('fetcher rejection becomes null in the cached value, no throw', async () => {
      const fetchCc = vi.fn().mockRejectedValue(new Error('ccusage crashed'))
      const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 25 })
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct })

      const v = await cache.get()

      expect(v.cc).toBeNull()
      expect(v.pct).toEqual({ fiveHour: 25 })
    })

    it('both fetchers throw — caller still gets a usable value, not a rejection', async () => {
      const fetchCc = vi.fn().mockRejectedValue(new Error('a'))
      const fetchPct = vi.fn().mockRejectedValue(new Error('b'))
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct })

      const v = await cache.get()

      expect(v.cc).toBeNull()
      expect(v.pct).toBeNull()
    })
  })

  describe('reset', () => {
    it('forces a fresh fetch on next call', async () => {
      const fetchCc = vi.fn().mockResolvedValue({ costUSD: 1 })
      const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 25 })
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct })

      await cache.get()
      cache.reset()
      await cache.get()

      expect(fetchCc).toHaveBeenCalledTimes(2)
    })
  })

  describe('inFlight cleared after resolution', () => {
    it('a second call after the first resolves but before TTL expires uses cache, not inFlight', async () => {
      let now = 1000
      const fetchCc = vi.fn().mockResolvedValue({ costUSD: 1 })
      const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 25 })
      const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => now })

      await cache.get()           // resolves, populates cache, clears inFlight
      now += 100
      await cache.get()           // should hit cache path, NOT spawn
      await cache.get()

      expect(fetchCc).toHaveBeenCalledTimes(1)
    })
  })
})
