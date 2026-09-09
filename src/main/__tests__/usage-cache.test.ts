import { describe, it, expect, vi } from 'vitest'
import { UsageCache, parsePersistedUsage, usageCacheFilename } from '../usage-cache'

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

describe('parsePersistedUsage', () => {
  it('parses a valid persisted value', () => {
    expect(parsePersistedUsage('{"cc":{"costUSD":1},"pct":{"fiveHour":25},"ts":999}')).toEqual({
      cc: { costUSD: 1 }, pct: { fiveHour: 25 }, ts: 999
    })
  })
  it('normalizes missing cc/pct to null', () => {
    expect(parsePersistedUsage('{"cc":null,"pct":null,"ts":5}')).toEqual({ cc: null, pct: null, ts: 5 })
  })
  it('returns null for corrupt or shape-invalid input (must not break startup)', () => {
    expect(parsePersistedUsage('')).toBeNull()
    expect(parsePersistedUsage('not json')).toBeNull()
    expect(parsePersistedUsage('{"cc":1}')).toBeNull()        // no ts
    expect(parsePersistedUsage('{"ts":"x","cc":1,"pct":1}')).toBeNull() // ts not number
  })
})

describe('usageCacheFilename', () => {
  it('is deterministic and filesystem-safe (no path separators)', () => {
    const a = usageCacheFilename('/Users/me/Development/psle')
    expect(a).toBe(usageCacheFilename('/Users/me/Development/psle'))
    expect(a).toMatch(/^usage-[a-z0-9]+\.json$/)
    expect(a).not.toContain('/')
  })
  it('differs by key', () => {
    expect(usageCacheFilename('/a')).not.toBe(usageCacheFilename('/b'))
  })
})

describe('disk persistence + stale-while-revalidate', () => {
  const memFs = (seed?: string) => {
    const store: Record<string, string> = seed ? { '/p': seed } : {}
    return {
      store,
      fs: {
        readFileSync: (p: string) => { if (!(p in store)) throw new Error('ENOENT'); return store[p] },
        writeFileSync: (p: string, d: string) => { store[p] = d }
      }
    }
  }

  it('persists the scraped value to disk on fetch', async () => {
    const { fs, store } = memFs()
    const cache = new UsageCache({ ttlMs: 5000, fetchCc: async () => ({ costUSD: 2 }), fetchPct: async () => ({ fiveHour: 40 }), now: () => 1000, persistPath: '/p', fs })
    await cache.get()
    expect(JSON.parse(store['/p'])).toEqual({ cc: { costUSD: 2 }, pct: { fiveHour: 40 }, ts: 1000 })
  })

  it('serves the disk seed IMMEDIATELY on restart even past TTL, then revalidates in background', async () => {
    // Seed written "long ago" (ts 1) — well past a 5s TTL at now=100000.
    const { fs } = memFs('{"cc":{"costUSD":9},"pct":{"fiveHour":88},"ts":1}')
    const fetchCc = vi.fn().mockResolvedValue({ costUSD: 3 })
    const fetchPct = vi.fn().mockResolvedValue({ fiveHour: 12 })
    const cache = new UsageCache({ ttlMs: 5000, fetchCc, fetchPct, now: () => 100000, persistPath: '/p', fs })

    const first = await cache.get()
    expect(first).toEqual({ cc: { costUSD: 9 }, pct: { fiveHour: 88 }, ts: 1 }) // the stale seed, shown at once

    await new Promise((r) => setTimeout(r, 0)) // let the background revalidation settle
    const second = await cache.get()
    expect(second.pct).toEqual({ fiveHour: 12 }) // now the fresh value
    expect(fetchCc).toHaveBeenCalledTimes(1)
  })

  it('a corrupt seed file is ignored (no crash, normal fetch)', async () => {
    const { fs } = memFs('garbage{')
    const cache = new UsageCache({ ttlMs: 5000, fetchCc: async () => ({ costUSD: 1 }), fetchPct: async () => null, now: () => 1, persistPath: '/p', fs })
    const v = await cache.get()
    expect(v.cc).toEqual({ costUSD: 1 })
  })
})
