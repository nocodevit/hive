// v2.15.7 — LRU eviction picker unit tests.
//
// User complaint: 'Hive Renderer 2.2 GB after 2d 6h'. Root cause: the
// sticky-mount design keeps every opened HiveChat + xterm alive for
// the app lifetime — N agents opened over N days = N in memory forever.
//
// Fix: cap activeTerminals at MAX_ACTIVE_TERMINALS. Before adding a
// new one when full, evict the least-recently-used UNPINNED one.
// This test pins the picker invariants — safety rules first, LRU order
// second.

import { describe, it, expect } from 'vitest'
import { pickLRUToEvict, MAX_ACTIVE_TERMINALS } from '../lru-terminals'

const bareInputs = (over: Partial<Parameters<typeof pickLRUToEvict>[0]> = {}) => ({
  incomingId: 'new-agent',
  activeIds: [],
  selectedId: null,
  pinnedIds: [],
  lastAccessed: new Map<string, number>(),
  ...over
})

describe('MAX_ACTIVE_TERMINALS', () => {
  it('exports the cap as 12 (generous — eviction only kicks in for hoarders)', () => {
    expect(MAX_ACTIVE_TERMINALS).toBe(12)
  })
})

describe('pickLRUToEvict — no-op cases', () => {
  it('returns null when under cap', () => {
    expect(pickLRUToEvict(bareInputs({ activeIds: ['a', 'b', 'c'] }))).toBeNull()
  })

  it('returns null when incoming is already in the set (opening = no-op)', () => {
    const active = Array.from({ length: 12 }, (_, i) => `a${i}`)
    expect(pickLRUToEvict(bareInputs({ activeIds: active, incomingId: 'a5' }))).toBeNull()
  })

  it('returns null at cap when EVERY candidate is pinned or selected', () => {
    const active = Array.from({ length: 12 }, (_, i) => `a${i}`)
    // All 12 have active handoffs.
    expect(pickLRUToEvict(bareInputs({
      activeIds: active,
      pinnedIds: active
    }))).toBeNull()
  })
})

describe('pickLRUToEvict — safety guards', () => {
  it('NEVER picks the currently-selected agent', () => {
    const active = Array.from({ length: 12 }, (_, i) => `a${i}`)
    const lastAccessed = new Map(active.map((id, i) => [id, i * 1000]))
    // a0 is oldest but ALSO selected — must skip it.
    const evict = pickLRUToEvict(bareInputs({
      activeIds: active,
      selectedId: 'a0',
      lastAccessed
    }))
    expect(evict).not.toBe('a0')
    expect(evict).toBe('a1')  // next oldest
  })

  it('NEVER picks a pinned (active-handoff) agent', () => {
    const active = Array.from({ length: 12 }, (_, i) => `a${i}`)
    const lastAccessed = new Map(active.map((id, i) => [id, i * 1000]))
    // a0 is oldest but pinned.
    const evict = pickLRUToEvict(bareInputs({
      activeIds: active,
      pinnedIds: ['a0', 'a3'],
      lastAccessed
    }))
    expect(evict).toBe('a1')
  })

  it('NEVER picks the incoming id (defensive — shouldn\'t be in set yet, but if it is, no-op)', () => {
    const active = Array.from({ length: 12 }, (_, i) => `a${i}`)
    // Impossible-in-practice: incoming already in active. Method returns
    // null (see no-op section) but even if we bypass that guard, the
    // filter must not evict itself.
    const evict = pickLRUToEvict(bareInputs({
      incomingId: 'a5',
      activeIds: active
    }))
    // First guard caught this — null (no eviction because incoming
    // already present).
    expect(evict).toBeNull()
  })
})

describe('pickLRUToEvict — LRU order', () => {
  it('picks the oldest unpinned when at cap', () => {
    // 12 agents; a3 is oldest.
    const active = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11']
    const now = Date.now()
    const lastAccessed = new Map<string, number>([
      ['a0', now - 1000],
      ['a1', now - 500],
      ['a2', now - 2000],
      ['a3', now - 60_000],  // oldest
      ['a4', now],
      ['a5', now - 30_000],
      ['a6', now - 100],
      ['a7', now - 200],
      ['a8', now - 300],
      ['a9', now - 400],
      ['a10', now - 700],
      ['a11', now - 800]
    ])
    expect(pickLRUToEvict(bareInputs({ activeIds: active, lastAccessed }))).toBe('a3')
  })

  it('agents with no recorded access are picked FIRST (treated as -Infinity)', () => {
    // a-untracked was opened before we started tracking (e.g. app
    // restart mid-session). It has no lastAccessed entry. It should
    // be evicted first over any tracked agent.
    const active = ['a-tracked-old', 'a-tracked-new', 'a-untracked']
    const now = Date.now()
    // Get to cap.
    for (let i = 0; i < MAX_ACTIVE_TERMINALS - 3; i++) active.push(`filler-${i}`)
    const lastAccessed = new Map<string, number>([
      ['a-tracked-old', now - 100_000],
      ['a-tracked-new', now],
      ...active.filter(id => id.startsWith('filler-')).map((id, i) => [id, now - i * 10] as [string, number])
    ])
    expect(pickLRUToEvict(bareInputs({ activeIds: active, lastAccessed }))).toBe('a-untracked')
  })

  it('picks second-oldest when oldest is pinned', () => {
    const active = ['old-pinned', 'second-oldest', 'newer']
    for (let i = 0; i < 9; i++) active.push(`filler-${i}`)
    const now = Date.now()
    const lastAccessed = new Map<string, number>([
      ['old-pinned', now - 100_000],
      ['second-oldest', now - 50_000],
      ['newer', now - 1000],
      ...active.filter(id => id.startsWith('filler-')).map((id, i) => [id, now - i * 10] as [string, number])
    ])
    expect(pickLRUToEvict(bareInputs({
      activeIds: active,
      pinnedIds: ['old-pinned'],
      lastAccessed
    }))).toBe('second-oldest')
  })
})

describe('pickLRUToEvict — real-world scenario', () => {
  it('user has 12 chats, all recently used, opens 13th → oldest unpinned evicted', () => {
    const active: string[] = []
    const lastAccessed = new Map<string, number>()
    const now = Date.now()
    for (let i = 0; i < MAX_ACTIVE_TERMINALS; i++) {
      active.push(`agent-${i}`)
      lastAccessed.set(`agent-${i}`, now - (MAX_ACTIVE_TERMINALS - i) * 60_000)
    }
    // agent-0 = oldest (12 min ago). agent-11 = most recent.
    // User is currently viewing agent-11. agent-3 has active handoff.
    const evict = pickLRUToEvict({
      incomingId: 'new-agent-13',
      activeIds: active,
      selectedId: 'agent-11',
      pinnedIds: ['agent-3'],
      lastAccessed
    })
    // agent-0 is oldest, not selected, not pinned → evicted.
    expect(evict).toBe('agent-0')
  })
})
