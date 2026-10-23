// Butler › Todo: the shapes the tab shows and how it groups / sorts them.

export type TodoSource = 'chat' | 'feishu' | 'jira' | 'email' | 'agent' | 'manual'
export interface TodoEventView { at: number; who: 'owner' | 'butler' | 'agent'; kind: 'created' | 'note' | 'action' | 'status'; text: string; link?: string }
export interface TodoView {
  id: string; title: string; createdAt: number; createdBy: 'owner' | 'butler' | 'agent'; source: TodoSource
  due?: string; refs: { approvalId?: string; chatId?: string; messageId?: string; jiraKey?: string; mailKey?: string; agentId?: string }
  status: 'open' | 'done' | 'dropped'; closedAt?: number; events: TodoEventView[]
}

export type GroupBy = 'created' | 'source' | 'due'
export type SortBy = 'newest' | 'oldest' | 'due'

export const SOURCE_LABEL: Record<TodoSource, string> = { chat: 'Chat', feishu: 'Feishu', jira: 'Jira', email: 'Email', agent: 'Agent', manual: 'Manual' }

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function sortTodos(list: TodoView[], by: SortBy): TodoView[] {
  const due = (t: TodoView) => t.due ?? '9999-99-99'
  return [...list].sort((a, b) => by === 'oldest' ? a.createdAt - b.createdAt
    : by === 'due' ? due(a).localeCompare(due(b)) || b.createdAt - a.createdAt
    : b.createdAt - a.createdAt)
}

/** Open todos in groups (empty groups left out), each sorted. */
export function groupTodos(list: TodoView[], by: GroupBy, sort: SortBy, now = new Date()): Array<{ label: string; items: TodoView[] }> {
  const today = dayStart(now), DAY = 86_400_000, t0 = ymd(now)
  const weekEnd = ymd(new Date(today + 6 * DAY))
  const key = (t: TodoView): string => {
    if (by === 'source') return SOURCE_LABEL[t.source]
    if (by === 'due') return !t.due ? 'No due date' : t.due < t0 ? 'Overdue' : t.due === t0 ? 'Due today' : t.due <= weekEnd ? 'This week' : 'Later'
    return t.createdAt >= today ? 'Today' : t.createdAt >= today - DAY ? 'Yesterday' : t.createdAt >= today - 6 * DAY ? 'This week' : 'Earlier'
  }
  const order = by === 'due' ? ['Overdue', 'Due today', 'This week', 'Later', 'No due date']
    : by === 'created' ? ['Today', 'Yesterday', 'This week', 'Earlier'] : Object.values(SOURCE_LABEL)
  const groups = new Map<string, TodoView[]>()
  for (const t of list) { const k = key(t); groups.set(k, [...(groups.get(k) ?? []), t]) }
  return order.filter(k => groups.has(k)).map(k => ({ label: k, items: sortTodos(groups.get(k)!, sort) }))
}

export const isOverdue = (t: TodoView, now = new Date()) => t.status === 'open' && !!t.due && t.due < ymd(now)

/** "10-22 16:40". */
export function whenShort(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A todo → the Butler chat, with its whole story. */
export function todoDiscussText(t: TodoView): string {
  return [
    `Help me with this todo. Do not send or change anything until I confirm.`,
    `- ${t.title}${t.due ? ` (due ${t.due})` : ''}${t.refs.jiraKey ? ` · ${t.refs.jiraKey}` : ''}`,
    'What happened so far:',
    ...t.events.map(e => `- ${whenShort(e.at)} ${e.who}: ${e.text}`)
  ].join('\n')
}
