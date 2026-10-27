// ./hive cards · ./hive card show|edit|close|reopen — Butler reads Approve
// cards and keeps them right after talking them over with the owner. It can
// rewrite a draft, close a card (with why) or bring one back; sending stays
// the owner's button.

import type { Approval, Approvals } from './approvals'

type Store = Pick<Approvals, 'pending' | 'history' | 'editDraft' | 'reject' | 'reopen'>
type Reply = { status: number; body: Record<string, unknown> }

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** What Butler needs to talk about a card: what they said, what was sent, the draft, the open question. */
export function cardView(a: Approval) {
  const p = a.payload ?? {}
  return {
    id: a.id, kind: a.kind, title: a.title, subtitle: a.subtitle, action: a.action, status: a.status,
    createdAt: a.createdAt, draft: a.draft,
    their: str(p.original) || str(p.question), about: str(p.about), question: a.kind.endsWith('.decide') ? str(p.question) : '',
    sent: str(p.sent), topic: str(p.topic), url: str(p.url),
    ...(a.edited ? { edited: a.edited } : {}), ...(a.closed ? { closed: a.closed } : {})
  }
}

/** Exact id or a unique prefix (≥ 4 chars), like ./hive todo. */
export function pickCard(items: Approval[], ref: unknown): Approval | null {
  const r = str(ref).trim()
  const hits = r.length >= 4 ? items.filter(i => i.id === r || i.id.startsWith(r)) : []
  return hits.length === 1 ? hits[0] : null
}

export function cardRoute(store: Store, method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | null): Reply {
  if (method === 'GET' && path === '/cards') {
    const list = query.get('all') === '1' ? [...store.pending(), ...store.history()] : store.pending()
    return { status: 200, body: { ok: true, cards: list.map(cardView) } }
  }
  const pool = [...store.pending(), ...store.history()]
  const card = pickCard(pool, method === 'GET' ? query.get('id') : body?.id)
  if (!card) return { status: 404, body: { ok: false, error: 'no_such_card' } }
  if (method === 'GET' && path === '/cards/show') return { status: 200, body: { ok: true, card: cardView(card) } }
  if (method !== 'POST') return { status: 400, body: { ok: false, error: 'bad_request' } }
  if (path === '/cards/edit') {
    const draft = str(body?.draft)
    if (!draft.trim()) return { status: 400, body: { ok: false, error: 'empty_draft' } }
    // A needs-you card has no draft to send: the owner answers it, then Butler writes the reply.
    if (card.kind.endsWith('.decide')) return { status: 409, body: { ok: false, error: 'needs_owner_answer' } }
    return store.editDraft(card.id, draft) ? { status: 200, body: { ok: true, id: card.id } } : { status: 409, body: { ok: false, error: 'not_pending' } }
  }
  if (path === '/cards/close') {
    const why = str(body?.why).trim()
    if (!why) return { status: 400, body: { ok: false, error: 'why_required' } }
    return store.reject(card.id, 'butler', why) ? { status: 200, body: { ok: true, id: card.id } } : { status: 409, body: { ok: false, error: 'not_pending' } }
  }
  if (path === '/cards/reopen') return store.reopen(card.id) ? { status: 200, body: { ok: true, id: card.id } } : { status: 409, body: { ok: false, error: 'not_closed' } }
  return { status: 400, body: { ok: false, error: 'bad_request' } }
}
