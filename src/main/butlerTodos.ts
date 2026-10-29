// Butler › Todo: things to follow up, with how each one went.
// <butler>/todos.jsonl is append-only — a todo is its "create" line plus every
// later event and status line, so nothing that happened is ever overwritten.
// Links to the rest of Hive are exact ids (approval, Feishu chat / message,
// Jira key, email key), never titles.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type TodoSource = 'chat' | 'feishu' | 'jira' | 'email' | 'agent' | 'manual'
export type TodoStatus = 'open' | 'done' | 'dropped'
export type TodoWho = 'owner' | 'butler' | 'agent'
/** 1 ⚡ 要命 · 2 🔥 冒烟 (default) · 3 🧊 冻着 */
export type TodoPriority = 1 | 2 | 3
export const PRIORITY_NAME: Record<TodoPriority, string> = { 1: '⚡ 要命', 2: '🔥 冒烟', 3: '🧊 冻着' }
export const isPriority = (v: unknown): v is TodoPriority => v === 1 || v === 2 || v === 3

export interface TodoRefs {
  approvalId?: string
  chatId?: string
  messageId?: string
  jiraKey?: string
  mailKey?: string
  agentId?: string
}

export interface TodoAssignee { agentId: string; agent: string; project: string }

export interface TodoEvent {
  at: number
  who: TodoWho
  /** created · note · action (something was done about it) · status */
  kind: 'created' | 'note' | 'action' | 'status'
  text: string
  /** What the line opens: a Jira URL, or a Hive place ("approval:<id>"). */
  link?: string
}

export interface Todo {
  id: string
  title: string
  createdAt: number
  createdBy: TodoWho
  source: TodoSource
  /** yyyy-MM-dd */
  due?: string
  priority: TodoPriority
  /** The agent it was given to (Butler dispatch), if any. */
  assignee?: TodoAssignee
  refs: TodoRefs
  status: TodoStatus
  closedAt?: number
  events: TodoEvent[]
}

type Line =
  | { op: 'create'; todo: Omit<Todo, 'events' | 'status' | 'priority'> & { events?: TodoEvent[]; priority?: TodoPriority } }
  | { op: 'event'; id: string; event: TodoEvent }
  | { op: 'status'; id: string; status: TodoStatus; at: number; who: TodoWho }
  | { op: 'due'; id: string; due: string; at: number; who: TodoWho }
  | { op: 'priority'; id: string; priority: TodoPriority; at: number; who: TodoWho }
  | { op: 'assign'; id: string; assignee: TodoAssignee; why: string; at: number; who: TodoWho }

const SOURCES: TodoSource[] = ['chat', 'feishu', 'jira', 'email', 'agent', 'manual']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const REF_KEYS: Array<keyof TodoRefs> = ['approvalId', 'chatId', 'messageId', 'jiraKey', 'mailKey', 'agentId']
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '')

export interface TodoInput { title: string; source?: TodoSource; due?: string; priority?: TodoPriority; refs?: TodoRefs; who?: TodoWho; note?: string; link?: string }

export function createTodoStore(dir: string, now: () => number = Date.now) {
  const file = join(dir, 'todos.jsonl')
  const write = (l: Line) => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(file, JSON.stringify(l) + '\n')
  }
  function all(): Todo[] {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { return [] }
    const byId = new Map<string, Todo>()
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue
      let l: Line
      try { l = JSON.parse(raw) } catch { continue }
      if (l.op === 'create') byId.set(l.todo.id, { ...l.todo, priority: isPriority(l.todo.priority) ? l.todo.priority : 2, status: 'open', events: l.todo.events ?? [] })
      else if (l.op === 'event') byId.get(l.id)?.events.push(l.event)
      else if (l.op === 'status') {
        const t = byId.get(l.id)
        if (!t) continue
        t.status = l.status
        t.closedAt = l.status === 'open' ? undefined : l.at
        t.events.push({ at: l.at, who: l.who, kind: 'status', text: l.status === 'done' ? 'Done' : l.status === 'dropped' ? 'Dropped' : 'Reopened' })
      } else if (l.op === 'due') {
        const t = byId.get(l.id)
        if (!t) continue
        t.events.push({ at: l.at, who: l.who, kind: 'action', text: t.due ? `Due ${t.due} → ${l.due}` : `Due ${l.due}` })
        t.due = l.due
      } else if (l.op === 'assign') {
        const t = byId.get(l.id)
        if (!t || !l.assignee?.agentId) continue
        const who = `${l.assignee.agent}${l.assignee.project ? ` (${l.assignee.project})` : ''}`
        t.events.push({ at: l.at, who: l.who, kind: 'action', text: `Assigned to ${who}${l.why ? ` — ${l.why}` : ''}` })
        t.assignee = l.assignee
      } else if (l.op === 'priority') {
        const t = byId.get(l.id)
        if (!t || !isPriority(l.priority)) continue
        t.events.push({ at: l.at, who: l.who, kind: 'action', text: `${PRIORITY_NAME[t.priority]} → ${PRIORITY_NAME[l.priority]}` })
        t.priority = l.priority
      }
    }
    return [...byId.values()]
  }
  const get = (id: string) => all().find(t => t.id === id)

  return {
    all,
    get,
    add(input: TodoInput): Todo | null {
      const title = clip(input.title, 200)
      if (!title) return null
      const refs: TodoRefs = {}
      for (const k of REF_KEYS) { const v = clip(input.refs?.[k], 200); if (v) refs[k] = v }
      const at = now()
      const who = input.who ?? 'owner'
      const todo = {
        id: randomUUID(), title, createdAt: at, createdBy: who,
        source: SOURCES.includes(input.source as TodoSource) ? input.source! : 'manual',
        ...(input.due && DATE.test(input.due) ? { due: input.due } : {}),
        ...(isPriority(input.priority) && input.priority !== 2 ? { priority: input.priority } : {}),
        refs,
        events: [{ at, who, kind: 'created' as const, text: clip(input.note, 1000) || title, ...(input.link ? { link: input.link } : {}) }]
      }
      write({ op: 'create', todo })
      return { ...todo, priority: isPriority(input.priority) ? input.priority : 2, status: 'open' }
    },
    event(id: string, e: Omit<TodoEvent, 'at'> & { at?: number }): boolean {
      if (!get(id)) return false
      write({ op: 'event', id, event: { at: e.at ?? now(), who: e.who, kind: e.kind, text: clip(e.text, 1000), ...(e.link ? { link: e.link } : {}) } })
      return true
    },
    setStatus(id: string, status: TodoStatus, who: TodoWho = 'owner'): boolean {
      const t = get(id)
      if (!t || t.status === status) return false
      write({ op: 'status', id, status, at: now(), who })
      return true
    },
    /** Moves the due date only; createdAt and the history stay as they were. */
    setDue(id: string, due: string, who: TodoWho = 'owner'): boolean {
      const t = get(id)
      if (!t || t.status !== 'open' || !DATE.test(due) || t.due === due) return false
      write({ op: 'due', id, due, at: now(), who })
      return true
    },
    /** Given to an agent (Butler dispatch): kept on the todo, told in its story. */
    assign(id: string, assignee: TodoAssignee, why = '', who: TodoWho = 'butler'): boolean {
      const t = get(id)
      if (!t || t.status !== 'open' || !assignee.agentId) return false
      write({ op: 'assign', id, assignee: { agentId: assignee.agentId, agent: clip(assignee.agent, 80), project: clip(assignee.project, 80) }, why: clip(why, 300), at: now(), who })
      return true
    },
    setPriority(id: string, priority: TodoPriority, who: TodoWho = 'owner'): boolean {
      const t = get(id)
      if (!t || t.status !== 'open' || !isPriority(priority) || t.priority === priority) return false
      write({ op: 'priority', id, priority, at: now(), who })
      return true
    },
    /** Open todos tied to exactly this ref (an approval, a Feishu chat, a Jira key …). */
    openByRef(kind: keyof TodoRefs, value: string): Todo[] {
      return value ? all().filter(t => t.status === 'open' && t.refs[kind] === value) : []
    }
  }
}
export type TodoStore = ReturnType<typeof createTodoStore>
