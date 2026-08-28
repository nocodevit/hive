/**
 * LRU eviction policy for App.tsx's activeTerminals set (v2.15.7).
 *
 * The sticky-mount design keeps every opened HiveChat alive so the
 * underlying `claude --print` subprocess survives agent switches.
 * Great for snappy switching, terrible for memory: 30 agents opened
 * over 2 days = 30 sticky chats + 30 xterm instances + 30 IPC listener
 * sets + 30 sets of React state (up to 500 timeline entries each) all
 * held forever. User report 2026-08-27: Hive Renderer at 2.2 GB after
 * 2d 6h.
 *
 * Fix: cap `activeTerminals` at MAX_ACTIVE_TERMINALS. Before adding
 * a new one, if we're full, pick the least-recently-used UNPINNED
 * terminal and close it (kills its `claude --print`, unmounts the
 * HiveChat, triggers all useEffect cleanups → memory reclaimed).
 *
 * Pinned = has an active handoff running (killing it mid-/goal loop
 * would lose progress) OR is the currently-selected agent (evicting
 * the visible chat would be catastrophic UX).
 *
 * The MAX is intentionally generous (12) — beyond typical usage, so
 * eviction only kicks in for genuine hoarders. If ALL 12 are pinned,
 * eviction returns null and the caller opens the (13th) new terminal
 * anyway; hitting this state is rare and reversible next time a pin
 * clears.
 */

export const MAX_ACTIVE_TERMINALS = 12

export interface LRUEvictionInputs {
  /** The agent about to be opened — never evict this one. */
  incomingId: string
  /** All currently-mounted terminals. */
  activeIds: Iterable<string>
  /** Currently-selected agent in the sidebar — never evict. */
  selectedId: string | null
  /** Agents with active handoff loops — never evict. */
  pinnedIds: Iterable<string>
  /** Map from agentId → last access timestamp (ms). Missing = never accessed. */
  lastAccessed: ReadonlyMap<string, number>
}

/**
 * Choose which terminal to close so the set can accept the incoming one.
 * Returns null if:
 *   - The set is under cap (no eviction needed), OR
 *   - Every candidate is pinned or is the incoming/selected (nothing safe to evict)
 *
 * When multiple unpinned candidates exist, picks the one with the OLDEST
 * lastAccessed timestamp (true LRU). Terminals with no recorded access
 * are treated as `-Infinity` and picked first — they were opened before
 * we started tracking, so they've been idle at least as long as any
 * tracked entry.
 */
export function pickLRUToEvict(inputs: LRUEvictionInputs, cap = MAX_ACTIVE_TERMINALS): string | null {
  const active = new Set(inputs.activeIds)
  // Under cap AND incoming already present → nothing to do.
  if (active.size < cap) return null
  // If the incoming is already in the set, opening is a no-op — no evict.
  if (active.has(inputs.incomingId)) return null
  const pinned = new Set(inputs.pinnedIds)
  const candidates: string[] = []
  for (const id of active) {
    if (id === inputs.selectedId) continue
    if (id === inputs.incomingId) continue
    if (pinned.has(id)) continue
    candidates.push(id)
  }
  if (candidates.length === 0) return null
  const at = (id: string): number => inputs.lastAccessed.get(id) ?? -Infinity
  candidates.sort((a, b) => at(a) - at(b))
  return candidates[0]
}
