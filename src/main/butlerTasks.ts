// Butler's tasks: work given to an agent reports back on its own.
//
// Every brief ends with the task's tag ("Task #1a2b3c4d") and asks the agent to
// finish its reply with one line, DONE #1a2b3c4d: … or BLOCKED #1a2b3c4d: ….
// Hive already sees every event of every agent chat; this reads them:
//   a turn ends with DONE    → the todo is "check it" (the owner ticks it off or sends it back);
//   a turn ends with BLOCKED → a card for the owner; their answer goes back to the agent;
//   the agent asks a question / permission → "waiting for you";
//   a turn ends with neither → asked once to say where it is;
//   nothing for STALL_MS     → "no word for hours", the owner is told.
// A report names its task by the exact tag; untagged, it counts only when the
// agent has exactly one task open.

import type { Approval } from './approvals'
import type { Todo, TodoStore, WorkState } from './butlerTodos'

export const BLOCKED_KIND = 'task.blocked'
export const STALL_MS = 4 * 3600_000

export const taskTag = (todoId: string) => `#${todoId.slice(0, 8)}`

/** The lines a brief ends with: which task it is and how to report back. */
export function reportLine(todoId: string): string {
  const tag = taskTag(todoId)
  return `Task ${tag}. When it is done, or you are stuck and need the owner, end your reply with one line: DONE ${tag}: <what you did> / BLOCKED ${tag}: <what you need>`
}

export const withReportLine = (brief: string, todoId: string) =>
  brief.includes(taskTag(todoId)) ? brief : `${brief.trim()}\n\n${reportLine(todoId)}`

export interface Report { kind: 'done' | 'blocked'; tag?: string; text: string }

/** The last DONE / BLOCKED line of a reply. */
export function parseReport(text: string): Report | null {
  let last: Report | null = null
  for (const line of text.split('\n')) {
    const m = /^[\s>*_`-]*(DONE|BLOCKED)\b\**\s*(#[0-9a-f]{8})?\**\s*[:：]\**\s*(.+?)[*_`\s]*$/i.exec(line)
    if (m) last = { kind: m[1].toUpperCase() === 'DONE' ? 'done' : 'blocked', ...(m[2] ? { tag: m[2].toLowerCase() } : {}), text: m[3].trim() }
  }
  return last
}

const ACTIVE: WorkState[] = ['sent', 'working', 'needs_you', 'quiet', 'stalled', 'blocked']
const clip = (s: string, n: number) => { const one = s.replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n - 1)}…` : one }

export interface TaskTrackerDeps {
  todos: () => TodoStore
  deliver: (agentId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  approvals: {
    add: (i: Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>) => Approval
    register: (kind: string, exec: (item: Approval) => Promise<{ ok: boolean; error?: string }>) => void
    pending: () => Approval[]
    reject: (id: string, by?: 'owner' | 'butler', why?: string) => boolean
  }
  /** 'check' = the owner has to look (says done); 'stuck' = no word for hours. */
  notify: (kind: 'check' | 'stuck', title: string, body: string, agentId: string) => void
  /** Is the agent generating right now (a long turn is not a stall)? */
  busy?: (agentId: string) => boolean
  now?: () => number
}

export function createTaskTracker(deps: TaskTrackerDeps) {
  const now = deps.now ?? Date.now
  const turnText = new Map<string, string>()
  /** Agents whose current turn is working on a task message (the brief, an answer, a send-back): only those are asked where it is. */
  const taskTurn = new Set<string>()
  const TURN_KEEP = 20_000

  // Every assistant event of every chat lands here: the todo file is read at most every few seconds.
  let cache: { at: number; open: Todo[] } | null = null
  const openTasks = (): Todo[] => {
    if (!cache || now() - cache.at > 5000) cache = { at: now(), open: deps.todos().all().filter(t => t.status === 'open' && !!t.assignee && !!t.work) }
    return cache.open
  }
  const setWork: TodoStore['setWork'] = (...a) => { cache = null; return deps.todos().setWork(...a) }

  /** Open todos given to this agent that it still owes a report on. */
  const active = (agentId: string): Todo[] => openTasks().filter(t => t.assignee!.agentId === agentId && ACTIVE.includes(t.work!.state))

  function target(agentId: string, tag?: string): Todo | null {
    const mine = active(agentId)
    if (tag) {
      const hit = openTasks().filter(t => t.assignee!.agentId === agentId && taskTag(t.id) === tag)
      return hit.length === 1 ? hit[0] : null
    }
    return mine.length === 1 ? mine[0] : null
  }

  const label = (t: Todo) => t.assignee?.agent || 'Agent'

  // The owner answered a BLOCKED card: the answer goes back to the agent.
  deps.approvals.register(BLOCKED_KIND, async item => {
    const p = item.payload as { todoId?: string; agentId?: string }
    if (typeof p.todoId !== 'string' || typeof p.agentId !== 'string') return { ok: false, error: 'bad_payload' }
    if (!item.draft.trim()) return { ok: false, error: 'empty_draft' }
    if (deps.todos().get(p.todoId)?.status !== 'open') return { ok: false, error: 'task_closed' }
    const r = await deps.deliver(p.agentId, `[From the owner] ${withReportLine(item.draft, p.todoId)}`)
    if (r.ok) setWork(p.todoId, 'sent', `Your answer: ${clip(item.draft, 200)}`, 'owner')
    return r
  })

  /** A BLOCKED card for a task that moved on (done, closed) is withdrawn: answering it would send an old answer. */
  function closeBlockedCards(todoId: string | null, why: string) {
    for (const a of deps.approvals.pending()) {
      if (a.kind !== BLOCKED_KIND) continue
      const id = String(a.payload.todoId ?? '')
      if (todoId ? id === todoId : deps.todos().get(id)?.status !== 'open') deps.approvals.reject(a.id, 'butler', why)
    }
  }

  async function onTurnEnd(agentId: string, text: string, onTask: boolean) {
    const report = parseReport(text)
    const t = target(agentId, report?.tag)
    if (!t) return
    const s = deps.todos()
    if (report?.kind === 'done') {
      if (t.work?.state === 'check' && t.work.text === clip(report.text, 1000)) return
      setWork(t.id, 'check', report.text)
      closeBlockedCards(t.id, 'the agent reported done')
      deps.notify('check', `${label(t)} says done — check it`, `${clip(t.title, 60)} · ${clip(report.text, 80)}`, agentId)
      return
    }
    if (report?.kind === 'blocked') {
      if (t.work?.state === 'blocked' && t.work.text === clip(report.text, 1000)) return
      setWork(t.id, 'blocked', report.text)
      const card = deps.approvals.add({
        kind: BLOCKED_KIND,
        title: `${label(t)} · stuck: ${clip(t.title, 40)}`,
        subtitle: `Task ${taskTag(t.id)} · ${clip(report.text, 80)}`,
        draft: '',
        payload: { todoId: t.id, agentId, agent: label(t), blocked: report.text },
        action: 'Reply to agent'
      })
      s.event(t.id, { who: 'butler', kind: 'action', text: 'Asked you on a card', link: `approval:${card.id}` })
      return
    }
    // No report after working on the task: once per task, ask where it is. The owner's own chats with the agent are left alone.
    if (!onTask || t.work?.state === 'needs_you' || t.work?.state === 'blocked' || t.work?.state === 'check') return
    if (t.work?.nudged) { setWork(t.id, 'quiet', clip(text, 300)); return }
    setWork(t.id, 'quiet', clip(text, 300), 'agent', true)
    await deps.deliver(agentId, `[From Butler] Where is task ${taskTag(t.id)} (${clip(t.title, 80)})? ${reportLine(t.id)}`)
  }

  return {
    /** Something else changed the todos (an assign): read them afresh. */
    invalidate() { cache = null },
    /** Feed one stream-json event of an agent chat. */
    onEvent(agentId: string, ev: any): Promise<void> | void {
      const type = ev?.type
      if (type === 'system' && ev.subtype === 'init') { turnText.delete(agentId); taskTurn.delete(agentId); return }
      if (type === 'assistant' && !ev.parent_tool_use_id) {
        const blocks = Array.isArray(ev.message?.content) ? ev.message.content : []
        const text = blocks.filter((b: any) => b?.type === 'text' && b.text).map((b: any) => String(b.text)).join('\n')
        if (text) turnText.set(agentId, `${turnText.get(agentId) ?? ''}\n${text}`.slice(-TURN_KEEP))
        for (const t of active(agentId)) {
          if (t.work!.state === 'sent') taskTurn.add(agentId)
          if (t.work!.state === 'sent' || t.work!.state === 'needs_you' || t.work!.state === 'stalled') setWork(t.id, 'working')
        }
        return
      }
      if (type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
        const q = ev.request.tool_name === 'AskUserQuestion' ? 'asks you a question' : `asks permission: ${String(ev.request.tool_name ?? '')}`
        for (const t of active(agentId)) if (t.work!.state !== 'needs_you') setWork(t.id, 'needs_you', q)
        return
      }
      if (type === 'result') {
        const text = typeof ev.result === 'string' && ev.result.trim() ? ev.result : turnText.get(agentId) ?? ''
        turnText.delete(agentId)
        const onTask = taskTurn.delete(agentId)
        return onTurnEnd(agentId, text, onTask)
      }
    },

    /** Tasks with no word for STALL_MS: flagged once, the owner is told. */
    sweep(): number {
      let n = 0
      const s = deps.todos()
      for (const t of s.all()) {
        if (t.status !== 'open' || !t.assignee || !t.work || !['sent', 'working', 'quiet'].includes(t.work.state)) continue
        if (now() - t.work.at < STALL_MS || deps.busy?.(t.assignee.agentId)) continue
        if (setWork(t.id, 'stalled', '', 'butler')) { n++; deps.notify('stuck', `${label(t)} has gone quiet`, clip(t.title, 80), t.assignee.agentId) }
      }
      closeBlockedCards(null, 'the task was closed')
      return n
    },

    /** The owner: not done yet — back to the same agent with what is missing. */
    async sendBack(todoId: string, note: string): Promise<{ ok: boolean; error?: string }> {
      const t = deps.todos().get(todoId)
      if (!t || t.status !== 'open' || !t.assignee) return { ok: false, error: 'no_such_task' }
      if (!note.trim()) return { ok: false, error: 'empty_note' }
      const r = await deps.deliver(t.assignee.agentId, `[From the owner] Task ${taskTag(t.id)} (${clip(t.title, 80)}) is not done yet: ${note.trim()}\n\n${reportLine(t.id)}`)
      if (r.ok) setWork(t.id, 'sent', `Sent back: ${clip(note, 200)}`, 'owner')
      return r
    },

    /** Everything given to an agent: open ones, and the ones closed in the last day. */
    list(): Array<{ id: string; tag: string; title: string; agent: string; project: string; state: WorkState | 'closed'; status: Todo['status']; at: number; text: string }> {
      const cutoff = now() - 24 * 3600_000
      return deps.todos().all()
        .filter(t => t.assignee && t.work && (t.status === 'open' || (t.closedAt ?? 0) > cutoff))
        .sort((a, b) => b.work!.at - a.work!.at)
        .map(t => ({ id: t.id, tag: taskTag(t.id), title: t.title, agent: t.assignee!.agent, project: t.assignee!.project, state: t.status === 'open' ? t.work!.state : 'closed', status: t.status, at: t.work!.at, text: t.work!.text }))
    }
  }
}
export type TaskTracker = ReturnType<typeof createTaskTracker>
