import { useEffect, useState } from 'react'

export const MANY_OPEN_AGENTS = 12
const POLL_MS = 5000

/** Agents whose claude process is running, from main (closed panes and Butler do not count). */
export function useRunningAgentCount(agentIds: string[]): number {
  const [live, setLive] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    const load = () => window.api.chat.liveAgents().then(ids => { if (alive) setLive(ids) }).catch(() => {})
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const known = new Set(agentIds)
  return live.filter(id => known.has(id)).length
}

/**
 * Stays up while 12+ agents are running. Hive never closes one by itself
 * (owner, 11-04); this only says that many running agents use a lot of memory.
 */
export function ManyAgentsBanner({ open }: { open: number }) {
  if (open < MANY_OPEN_AGENTS) return null
  return (
    <div role="status" aria-label={`${open} agents open`}
      className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-bg-secondary shadow-e3 border border-status-waiting/60 text-[13px]">
      <span className="w-[7px] h-[7px] rounded-full bg-status-waiting" />
      <span className="font-semibold text-text-primary">{open} agents open</span>
      <span className="text-text-muted">Close the ones you are done with to free memory</span>
    </div>
  )
}
