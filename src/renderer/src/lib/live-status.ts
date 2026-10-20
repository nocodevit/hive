// Agent dots come from Claude Code hook events (a tool ran → working, a turn
// ended → waiting). A chat that is open but idle — e.g. just resumed — sends
// none, so it stayed gray ("done") and its project looked inactive. The main
// process knows which chats are live; this folds that into the dots.

export interface LiveRow { agentId: string; chatLive: boolean; activity: 'working' | 'waiting' | 'off' }
type Status = 'working' | 'waiting' | 'done'

/** Same array back when nothing changes (no re-render). */
export function reconcileLiveStatus<A extends { id: string; status: Status }>(agents: A[], rows: LiveRow[]): A[] {
  const live = new Map(rows.filter(r => r.chatLive).map(r => [r.agentId, r.activity]))
  let changed = false
  const next = agents.map(a => {
    const activity = live.get(a.id)
    if (!activity) return a
    const status: Status = activity === 'working' ? 'working' : a.status === 'done' ? 'waiting' : a.status
    if (status === a.status) return a
    changed = true
    return { ...a, status }
  })
  return changed ? next : agents
}
