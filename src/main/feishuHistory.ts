// Chat history search for answer-for-me (`./hive chat-search`).
//
// The rule is the "private chats" guardrail in code: while answering someone,
// Butler may read this chat's older messages and the owner's other chats that
// the sender is also in (they could read those anyway) — never a chat the
// sender is not in. The owner's own Butler session (no run) may search all.
// Feishu's message search needs a scope some owners lack; then only this
// chat's older history is searched.

import { messageText } from './feishuAgent'

type Http = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>
const API = 'https://open.feishu.cn/open-apis'
const ok = (r: { status: number; body: any }) => r.status === 200 && r.body?.code === 0

export interface Hit { chatId: string; chatName: string; time: number; sender: string; text: string }
/** Who is being answered: the sender and the chat the question came from. */
export interface RunScope { senderId: string; chatId: string; chatName: string }

/** Lower-cased words to look for; 1–5 of them. */
export function queryWords(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().split(/[\s,，、;；]+/).map(w => w.trim()).filter(w => w.length >= 2))).slice(0, 5)
}

const matches = (text: string, words: string[]) => { const t = text.toLowerCase(); return words.some(w => t.includes(w)) }
const toHit = (m: any, chatId: string, chatName: string): Hit => ({
  chatId, chatName, time: Number(m?.create_time) || 0, sender: String(m?.sender?.id ?? ''), text: messageText(m).slice(0, 400)
})

/** This chat, newest first, up to `pages` × 50 messages back. */
export async function searchChat(http: Http, token: string, scope: RunScope, words: string[], pages = 5): Promise<Hit[]> {
  const hits: Hit[] = []
  let pageToken = ''
  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({ container_id_type: 'chat', container_id: scope.chatId, sort_type: 'ByCreateTimeDesc', page_size: '50', ...(pageToken ? { page_token: pageToken } : {}) })
    const r = await http('GET', `${API}/im/v1/messages?${q}`, token)
    if (!ok(r)) break
    for (const m of r.body.data?.items ?? []) if (!m?.deleted && matches(messageText(m), words)) hits.push(toHit(m, scope.chatId, scope.chatName))
    if (!r.body.data?.has_more || !r.body.data?.page_token) break
    pageToken = r.body.data.page_token
  }
  return hits
}

/** Is `openId` a member of `chatId`? (paged member list; cached by the caller) */
export async function isMember(http: Http, token: string, chatId: string, openId: string): Promise<boolean> {
  let pageToken = ''
  for (let p = 0; p < 20; p++) {
    const q = new URLSearchParams({ member_id_type: 'open_id', page_size: '100', ...(pageToken ? { page_token: pageToken } : {}) })
    const r = await http('GET', `${API}/im/v1/chats/${encodeURIComponent(chatId)}/members?${q}`, token)
    if (!ok(r)) return false
    if ((r.body.data?.items ?? []).some((m: any) => m?.member_id === openId)) return true
    if (!r.body.data?.has_more || !r.body.data?.page_token) return false
    pageToken = r.body.data.page_token
  }
  return false
}

/** Feishu's message search across the owner's chats; null when the scope is missing. */
export async function searchAllChats(http: Http, token: string, query: string): Promise<Array<{ messageId: string }> | null> {
  const r = await http('POST', `${API}/search/v2/message?user_id_type=open_id&page_size=20`, token, { query })
  if (!ok(r)) return null
  return (r.body.data?.items ?? []).filter((x: unknown) => typeof x === 'string').map((messageId: string) => ({ messageId }))
}

export function createHistorySearch(deps: { http: Http; token: () => Promise<string | null>; chats?: () => Promise<Array<{ id: string; name: string; p2p: boolean }>> }) {
  const membership = new Map<string, boolean>()
  async function member(token: string, chatId: string, openId: string) {
    const k = `${chatId}:${openId}`
    if (!membership.has(k)) membership.set(k, await isMember(deps.http, token, chatId, openId).catch(() => false))
    return membership.get(k)!
  }

  /** scope = answering someone (sender-bound); null = the owner asking for themselves. */
  return async function search(query: string, scope: RunScope | null): Promise<{ hits: Hit[]; note: string }> {
    const token = await deps.token()
    if (!token) return { hits: [], note: 'Feishu not signed in' }
    const words = queryWords(query)
    if (!words.length) return { hits: [], note: 'empty query' }
    const hits: Hit[] = scope ? await searchChat(deps.http, token, scope, words).catch(() => []) : []
    const found = await searchAllChats(deps.http, token, query).catch(() => null)
    let note = found === null ? (scope ? 'searched this chat only (no message-search permission)' : 'no message-search permission') : ''
    for (const { messageId } of found ?? []) {
      const r = await deps.http('GET', `${API}/im/v1/messages/${encodeURIComponent(messageId)}`, token).catch(() => null)
      const m = r && ok(r) ? r.body.data?.items?.[0] : null
      const chatId = typeof m?.chat_id === 'string' ? m.chat_id : ''
      if (!m || !chatId || hits.some(h => h.time === Number(m.create_time) && h.chatId === chatId)) continue
      // The guardrail: while answering someone, only chats they are in.
      if (scope && chatId !== scope.chatId && !(await member(token, chatId, scope.senderId))) { note = note || 'some results hidden: the sender is not in those chats'; continue }
      hits.push(toHit(m, chatId, chatId === scope?.chatId ? scope.chatName : ''))
    }
    // The owner asking for themselves without the search scope: chats named like the
    // query (a direct chat is named after the other person) — their latest messages.
    if (!scope && found === null && deps.chats) {
      const named = (await deps.chats().catch(() => [])).filter(c => words.some(w => c.name.toLowerCase().includes(w))).slice(0, 3)
      for (const c of named) {
        const latest = await searchChat(deps.http, token, { senderId: '', chatId: c.id, chatName: c.name }, [''], 1).catch(() => [])
        hits.push(...latest.slice(0, 10))
      }
      if (named.length) note = `no message-search permission: latest messages in ${named.map(c => `"${c.name}"`).join(', ')}`
    }
    hits.sort((a, b) => b.time - a.time)
    return { hits: hits.slice(0, 15), note }
  }
}
