// One-off capability check after Feishu sign-in: what the user token can
// actually do, before Butler's answer-for-me mode is designed around it.
// Read-only, and the report carries counts, kinds and times — never
// message text, names of chats or people.

const API = 'https://open.feishu.cn/open-apis'

type Get = (url: string, token: string) => Promise<{ status: number; body: any }>

export interface ProbeStep { ok: boolean; code?: number; msg?: string; [k: string]: unknown }

export interface ProbeReport {
  scope: string[]
  userInfo: ProbeStep
  chats: ProbeStep
  p2pMessages: ProbeStep
  groupMessages: ProbeStep
  calendars: ProbeStep
}

function step(r: { status: number; body: any }, extra: (data: any) => Record<string, unknown> = () => ({})): ProbeStep {
  const ok = r.status === 200 && r.body?.code === 0
  return ok ? { ok, ...extra(r.body.data) } : { ok, code: r.body?.code ?? r.status, msg: String(r.body?.msg ?? '').slice(0, 200) }
}

function messageShape(items: any[]) {
  return {
    count: items.length,
    types: Array.from(new Set(items.map(m => String(m?.msg_type ?? '?')))),
    senderTypes: Array.from(new Set(items.map(m => String(m?.sender?.sender_type ?? '?')))),
    newest: items[0]?.create_time ? new Date(Number(items[0].create_time)).toISOString() : null
  }
}

export async function probeFeishu(token: string, scope: string, get: Get): Promise<ProbeReport> {
  const safe = async (url: string) => {
    try { return await get(url, token) } catch (e) { return { status: 0, body: { code: -1, msg: e instanceof Error ? e.message : String(e) } } }
  }
  const userInfo = step(await safe(`${API}/authen/v1/user_info`), d => ({ hasOpenId: !!d?.open_id }))
  const chatsRes = await safe(`${API}/im/v1/chats?page_size=100&types=p2p,group&sort_type=ByActiveTimeDesc`)
  const items: any[] = chatsRes.body?.data?.items ?? []
  const modeOf = (c: any) => String(c?.chat_mode ?? c?.chat_type ?? '?')
  const chats = step(chatsRes, () => ({
    count: items.length,
    modes: Array.from(new Set(items.map(modeOf))),
    p2p: items.filter(c => modeOf(c) === 'p2p').length,
    hasMore: !!chatsRes.body?.data?.has_more
  }))
  const pick = (mode: string) => items.find(c => (c?.chat_mode ?? c?.chat_type) === mode)?.chat_id as string | undefined
  const messagesIn = async (chatId: string | undefined, label: string): Promise<ProbeStep> => {
    if (!chatId) return { ok: false, msg: `no ${label} chat in the first page` }
    const r = await safe(`${API}/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&sort_type=ByCreateTimeDesc&page_size=5`)
    return step(r, d => messageShape(d?.items ?? []))
  }
  const p2pMessages = await messagesIn(pick('p2p'), 'p2p')
  const groupMessages = await messagesIn(pick('group'), 'group')
  const calendars = step(await safe(`${API}/calendar/v4/calendars?page_size=50`), d => ({ count: (d?.calendar_list ?? d?.items ?? []).length }))
  return { scope: scope.split(/\s+/).filter(Boolean).sort(), userInfo, chats, p2pMessages, groupMessages, calendars }
}
