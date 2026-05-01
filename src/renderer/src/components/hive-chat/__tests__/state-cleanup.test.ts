import { describe, it, expect } from 'vitest'

/**
 * v1.7.98 state auto-cleanup — pure-logic replicas of the three
 * timeout policies, so the cutoff math is exercised in CI even though
 * the live useEffect tickers can't be exercised cheaply.
 *
 * Background: 04-30 trace showed Renderer (pid 51076) at 174% CPU even
 * when only 1 chat was streaming. Root cause = stale state in the
 * other 6 mounted HiveChats (ghost subagents whose tool_result never
 * arrived, orphaned thinking flags from crashed --print). Each kept
 * its 1Hz ticker re-rendering forever. Auto-cleanup gates each ticker
 * by a max-age check.
 */

interface SubagentState {
  startedAt: number
  lastEventAt: number
  eventCount: number
}

function pruneSubagents(
  prev: Record<string, SubagentState>,
  now: number,
  ttlMs: number = 20 * 60 * 1000
): Record<string, SubagentState> {
  const cutoff = now - ttlMs
  let dropped = 0
  const next: Record<string, SubagentState> = {}
  for (const [k, v] of Object.entries(prev)) {
    if (v.lastEventAt > cutoff) next[k] = v
    else dropped++
  }
  return dropped > 0 ? next : prev
}

function thinkingShouldClear(
  thinking: { since: number } | null,
  now: number,
  ttlMs: number = 60_000
): boolean {
  if (!thinking) return false
  return now - thinking.since >= ttlMs
}

function longRunShouldStop(
  startedAt: number,
  now: number,
  ttlMs: number = 10 * 60 * 1000
): boolean {
  return now - startedAt > ttlMs
}

describe('v1.7.98 state cleanup — activeSubagents 20min stale drop', () => {
  it('keeps fresh entries (1s old)', () => {
    const now = Date.now()
    const prev = { a: { startedAt: now - 1000, lastEventAt: now - 1000, eventCount: 1 } }
    expect(pruneSubagents(prev, now)).toBe(prev)  // referentially same — no drop
  })

  it('keeps entries 19m59s old (under cutoff)', () => {
    const now = Date.now()
    const prev = { a: { startedAt: now - 1000, lastEventAt: now - (20 * 60 * 1000 - 1000), eventCount: 1 } }
    expect(pruneSubagents(prev, now)).toBe(prev)
  })

  it('drops entries 20m1s old (over cutoff)', () => {
    const now = Date.now()
    const prev = { a: { startedAt: now - 1000, lastEventAt: now - (20 * 60 * 1000 + 1000), eventCount: 1 } }
    const next = pruneSubagents(prev, now)
    expect(next).not.toBe(prev)
    expect(Object.keys(next)).toHaveLength(0)
  })

  it('keeps fresh + drops stale in mixed map', () => {
    const now = Date.now()
    const prev = {
      fresh: { startedAt: now, lastEventAt: now - 30_000, eventCount: 5 },
      ghost: { startedAt: now - 3_600_000, lastEventAt: now - 25 * 60 * 1000, eventCount: 2 }
    }
    const next = pruneSubagents(prev, now)
    expect(Object.keys(next)).toEqual(['fresh'])
  })

  it('returns same ref when nothing to drop (no needless re-render)', () => {
    const now = Date.now()
    const prev = {}
    expect(pruneSubagents(prev, now)).toBe(prev)
  })
})

describe('v1.7.98 state cleanup — thinking 60s clear', () => {
  it('null thinking never clears', () => {
    expect(thinkingShouldClear(null, Date.now())).toBe(false)
  })

  it('5s old does not clear', () => {
    const now = Date.now()
    expect(thinkingShouldClear({ since: now - 5_000 }, now)).toBe(false)
  })

  it('59s old does not clear', () => {
    const now = Date.now()
    expect(thinkingShouldClear({ since: now - 59_000 }, now)).toBe(false)
  })

  it('60s old clears', () => {
    const now = Date.now()
    expect(thinkingShouldClear({ since: now - 60_000 }, now)).toBe(true)
  })

  it('120s old clears', () => {
    const now = Date.now()
    expect(thinkingShouldClear({ since: now - 120_000 }, now)).toBe(true)
  })
})

describe('v1.7.98 state cleanup — LongRunningTick 10min hard stop', () => {
  it('5s elapsed: keep ticking', () => {
    const start = Date.now() - 5_000
    expect(longRunShouldStop(start, Date.now())).toBe(false)
  })

  it('9m59s elapsed: keep ticking', () => {
    const now = Date.now()
    expect(longRunShouldStop(now - (10 * 60 * 1000 - 1000), now)).toBe(false)
  })

  it('10m1s elapsed: stop', () => {
    const now = Date.now()
    expect(longRunShouldStop(now - (10 * 60 * 1000 + 1000), now)).toBe(true)
  })

  it('1h elapsed: stop', () => {
    const now = Date.now()
    expect(longRunShouldStop(now - 3_600_000, now)).toBe(true)
  })
})
