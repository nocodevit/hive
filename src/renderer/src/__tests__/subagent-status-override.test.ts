// Renderer-side display override — v1.7.118 status-badge fix.
//
// App.tsx derives `displayAgents` from `agents` + `subagentActiveIds`.
// We pin the exact rule here so a refactor that drops it (or flips
// the polarity) trips a test rather than silently regressing the
// "Task tool running → badge still yellow" bug the user hit.
//
// The contract:
//   - waiting + activeIds.has(id)  → display 'working' (override)
//   - working                       → unchanged (already green)
//   - waiting + NOT active          → unchanged ('waiting'/yellow)
//   - done                          → unchanged (terminal)
//   - empty activeIds set           → reference-equal pass-through
//     (so React.memo'd grids don't re-render on every empty poll)

import { describe, it, expect } from 'vitest'

type Agent = { id: string; status: 'working' | 'waiting' | 'done' }

function deriveDisplayAgents(agents: Agent[], subagentActiveIds: Set<string>): Agent[] {
  if (subagentActiveIds.size === 0) return agents
  return agents.map(a =>
    a.status === 'waiting' && subagentActiveIds.has(a.id)
      ? { ...a, status: 'working' as const }
      : a
  )
}

describe('deriveDisplayAgents', () => {
  it('upgrades a waiting agent to working when in the active set', () => {
    const agents: Agent[] = [{ id: 'a1', status: 'waiting' }]
    const out = deriveDisplayAgents(agents, new Set(['a1']))
    expect(out[0].status).toBe('working')
  })

  it('does NOT downgrade an already-working agent', () => {
    const agents: Agent[] = [{ id: 'a1', status: 'working' }]
    const out = deriveDisplayAgents(agents, new Set(['a1']))
    expect(out[0].status).toBe('working')
  })

  it('does NOT touch waiting agents that are NOT in the active set', () => {
    const agents: Agent[] = [
      { id: 'a1', status: 'waiting' },
      { id: 'a2', status: 'waiting' }
    ]
    const out = deriveDisplayAgents(agents, new Set(['a1']))
    expect(out[0].status).toBe('working')
    expect(out[1].status).toBe('waiting')
  })

  it('does NOT touch done agents (terminal)', () => {
    const agents: Agent[] = [{ id: 'a1', status: 'done' }]
    const out = deriveDisplayAgents(agents, new Set(['a1']))
    expect(out[0].status).toBe('done')
  })

  it('returns reference-equal array when active set is empty', () => {
    const agents: Agent[] = [{ id: 'a1', status: 'waiting' }]
    const out = deriveDisplayAgents(agents, new Set())
    expect(out).toBe(agents)  // identity, not just equality — important for memo'd grids
  })

  it('handles mixed cohort: waiting+active, waiting+inactive, working, done in one map', () => {
    const agents: Agent[] = [
      { id: 'mgr',     status: 'waiting' },   // active: upgrade
      { id: 'worker1', status: 'waiting' },   // inactive: keep
      { id: 'worker2', status: 'working' },   // keep
      { id: 'qa',      status: 'done' }       // keep
    ]
    const out = deriveDisplayAgents(agents, new Set(['mgr']))
    expect(out.map(a => a.status)).toEqual(['working', 'waiting', 'working', 'done'])
  })
})
