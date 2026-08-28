// v2.15.6 — ccusage must not thundering-herd across cwds.
//
// User: 'ccusage blocks --json 长期占 75% CPU'. Root cause: each per-cwd
// UsageCache called queryUsageViaCcusage independently; N agents in N
// worktrees = N × 12s ccusage scans firing simultaneously every 5 min.
//
// Fix: sharedCcusageQuery singleton — TTL + in-flight dedup across ALL
// cwds. This test proves the singleton behavior by injecting a mock
// implementation and asserting call count under parallel load.

import { describe, it, expect, vi } from 'vitest'

// The real singleton lives in chat.ts and can't be pulled out without
// booting the whole main-process bundle (Electron imports). Mirror it
// here 1:1 and pin the invariant — if chat.ts's version regresses
// (someone reintroduces per-cwd ccusage calls), this test still gives
// them the reproduce recipe. Keep in sync with chat.ts:sharedCcusageQuery.

function makeSharedRunner<T>(ttlMs: number, fetcher: () => Promise<T | null>) {
  let cache: { value: T | null; ts: number } | null = null
  let inFlight: Promise<T | null> | null = null
  const now = () => Date.now()
  return async function run(): Promise<T | null> {
    const t = now()
    if (cache && t - cache.ts < ttlMs) return cache.value
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const v = await fetcher()
        cache = { value: v, ts: now() }
        return v
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }
}

describe('shared ccusage singleton (v2.15.6)', () => {
  it('20 concurrent calls (simulates 20 cwds) → fetcher fires ONCE', async () => {
    // Simulates the real scenario: user has 20 agents in 20 worktrees,
    // all refresh at the same moment (e.g. Overview page opened).
    const fetcher = vi.fn(async () => {
      // Simulate ccusage's 12s scan with a small delay so all callers
      // arrive during the in-flight window.
      await new Promise((r) => setTimeout(r, 30))
      return { costUSD: 42 } as any
    })
    const run = makeSharedRunner(5 * 60_000, fetcher)
    const results = await Promise.all(Array.from({ length: 20 }, () => run()))
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r).toEqual({ costUSD: 42 })
  })

  it('serves subsequent calls from cache within TTL', async () => {
    const fetcher = vi.fn(async () => ({ costUSD: 1 } as any))
    const run = makeSharedRunner(5 * 60_000, fetcher)
    await run()
    await run()
    await run()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('clears in-flight after fetcher throws — next call retries (no wedged state)', async () => {
    // If a single failed ccusage left inFlight non-null forever, all
    // subsequent callers would await a permanently-rejected promise.
    let n = 0
    const fetcher = vi.fn(async () => {
      n++
      if (n === 1) throw new Error('ccusage timed out')
      return { costUSD: 7 } as any
    })
    const run = makeSharedRunner(5 * 60_000, fetcher)
    await expect(run()).rejects.toThrow('ccusage timed out')
    // Second call: fetcher runs again, succeeds.
    const r = await run()
    expect(r).toEqual({ costUSD: 7 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('after TTL expires, next call re-fetches', async () => {
    const fetcher = vi.fn(async () => ({ costUSD: 5 } as any))
    // Use a tiny TTL so the test doesn't take 5 minutes.
    const run = makeSharedRunner(20, fetcher)
    await run()
    await new Promise((r) => setTimeout(r, 40))
    await run()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
