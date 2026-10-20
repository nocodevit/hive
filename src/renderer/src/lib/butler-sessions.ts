// Butler → Sessions: who needs the owner first, then who is working,
// then the rest. Counts feed the three status tiles.

export interface SessionRow {
  agentId: string
  agent: string
  projectId: string
  project: string
  activity: 'working' | 'waiting' | 'off'
}

const RANK = { waiting: 0, working: 1, off: 2 } as const

export function orderSessions<T extends SessionRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    RANK[a.activity] - RANK[b.activity] || a.project.localeCompare(b.project) || a.agent.localeCompare(b.agent))
}

export function sessionCounts(rows: SessionRow[]): Record<SessionRow['activity'], number> {
  const n = { working: 0, waiting: 0, off: 0 }
  for (const r of rows) n[r.activity]++
  return n
}
