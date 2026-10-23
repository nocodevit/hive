// Butler › Todo wiring: IPC for the tab, "+ Todo" from an Approve card, and the
// automatic links — when a card a todo is about gets approved / dismissed, the
// todo's history says so (and an answered follow-up closes it).

import type { IpcMain } from 'electron'
import type { Approval } from './approvals'
import type { TodoInput, TodoSource, TodoStatus, TodoStore } from './butlerTodos'

const str = (p: Record<string, unknown> | undefined, k: string) => (typeof p?.[k] === 'string' ? (p[k] as string) : '')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function sourceOf(kind: string): TodoSource {
  const k = kind.split('.')[0]
  return k === 'feishu' ? 'feishu' : k === 'jira' ? 'jira' : k === 'email' ? 'email' : 'manual'
}

/** An Approve card → a todo about it (exact refs from the card). */
export function todoFromApproval(a: Pick<Approval, 'id' | 'kind' | 'title' | 'subtitle' | 'draft' | 'payload'>, who: TodoInput['who'] = 'owner', note?: string): TodoInput {
  const p = a.payload
  return {
    title: str(p, 'topic') && str(p, 'sent') ? `${a.title.split(' · ')[0]} · ${str(p, 'topic')}` : a.title,
    source: sourceOf(a.kind),
    who,
    refs: { approvalId: a.id, chatId: str(p, 'chatId') || undefined, messageId: str(p, 'messageId') || undefined, jiraKey: str(p, 'key') || undefined },
    note: note ?? (str(p, 'question') ? `${str(p, 'chatName') || a.title.split(' · ')[0]}: ${clip(str(p, 'question'), 400)}` : a.subtitle),
    link: `approval:${a.id}`
  }
}

/** A card left the queue: say what happened on every todo about it; an answered one is done. */
export function noteApprovalOutcome(store: TodoStore, a: Pick<Approval, 'id' | 'status' | 'draft' | 'error' | 'kind'>): void {
  for (const t of store.openByRef('approvalId', a.id)) {
    const text = a.status === 'approved'
      ? `${a.kind.startsWith('jira') ? 'Done in Jira' : 'You replied'}${a.draft.trim() ? `: ${clip(a.draft.trim(), 200)}` : ''}`
      : a.status === 'rejected' ? 'Card dismissed' : `Failed: ${a.error ?? 'unknown'}`
    store.event(t.id, { who: 'owner', kind: 'action', text, link: `approval:${a.id}` })
    if (a.status === 'approved') store.setStatus(t.id, 'done', 'owner')
  }
}

export function registerTodosIpc(d: {
  ipcMain: Pick<IpcMain, 'handle'>
  store: () => TodoStore
  approvals: { get: (id: string) => Approval | undefined }
  changed: () => void
}): void {
  const h = d.ipcMain.handle.bind(d.ipcMain)
  const done = <T>(v: T): T => { d.changed(); return v }
  h('todos:list', () => d.store().all())
  h('todos:add', (_e, input: unknown) => {
    const i = (input && typeof input === 'object' ? input : {}) as TodoInput
    return done(d.store().add({ title: String(i.title ?? ''), due: i.due, source: i.source ?? 'manual', who: 'owner' }))
  })
  h('todos:setStatus', (_e, id: unknown, status: unknown) =>
    typeof id === 'string' && (status === 'open' || status === 'done' || status === 'dropped') ? done(d.store().setStatus(id, status as TodoStatus)) : false)
  h('todos:note', (_e, id: unknown, text: unknown) =>
    typeof id === 'string' && typeof text === 'string' && text.trim() ? done(d.store().event(id, { who: 'owner', kind: 'note', text })) : false)
  h('todos:fromApproval', (_e, id: unknown, note: unknown) => {
    if (typeof id !== 'string') return null
    const a = d.approvals.get(id)
    if (!a) return null
    const s = d.store()
    const existing = s.openByRef('approvalId', id)[0]
    if (existing) { if (typeof note === 'string' && note) s.event(existing.id, { who: 'owner', kind: 'note', text: note }); return done(s.get(existing.id)) }
    const t = s.add(todoFromApproval(a, 'owner'))
    if (t && typeof note === 'string' && note) s.event(t.id, { who: 'owner', kind: 'action', text: note })
    return done(t ? s.get(t.id) : null)
  })
}
