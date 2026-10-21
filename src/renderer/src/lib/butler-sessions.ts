// Butler → Sessions: who needs the owner first, then who is working,
// then the rest; newest chat activity first inside each. Counts feed the three status tiles.

export interface SessionRow {
  agentId: string
  agent: string
  projectId: string
  project: string
  activity: 'working' | 'waiting' | 'off'
  /** Last chat-log write (ms), 0 if never. */
  updatedAt?: number
}

const RANK = { waiting: 0, working: 1, off: 2 } as const

export function orderSessions<T extends SessionRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    RANK[a.activity] - RANK[b.activity] || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.project.localeCompare(b.project) || a.agent.localeCompare(b.agent))
}

/** "now", "5m", "3h", "2d"; '' when never. */
export function sinceLabel(ms: number | undefined, now = Date.now()): string {
  if (!ms) return ''
  const m = Math.max(0, Math.floor((now - ms) / 60000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

export function sessionCounts(rows: SessionRow[]): Record<SessionRow['activity'], number> {
  const n = { working: 0, waiting: 0, off: 0 }
  for (const r of rows) n[r.activity]++
  return n
}
