// Telegram away push: the guided setup and the send. The owner makes a bot
// with @BotFather, pastes its token (checked with getMe), sends /start to
// the bot, and Hive finds the chat id itself in getUpdates.
// The token is never logged and never leaves this module's callers in main.

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

export const BOTFATHER_URL = 'https://t.me/BotFather'
const API = 'https://api.telegram.org'
const TIMEOUT_MS = 15_000

/** "123456789:AA…" — the shape BotFather hands out. */
export function looksLikeToken(t: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t.trim())
}

async function call(fetchFn: FetchLike, token: string, method: string, body?: unknown): Promise<any> {
  const r = await fetchFn(`${API}/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  return r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))
}

export type TgResult<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Check a pasted token: the bot's @username, or why not. */
export async function checkToken(fetchFn: FetchLike, token: string): Promise<TgResult<{ bot: string }>> {
  if (!looksLikeToken(token)) return { ok: false, error: 'not_a_token' }
  try {
    const j = await call(fetchFn, token.trim(), 'getMe')
    if (!j?.ok || !j.result?.username) return { ok: false, error: 'rejected' }
    return { ok: true, bot: String(j.result.username) }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** The private chat that most recently sent /start to the bot. */
export async function findStartChat(fetchFn: FetchLike, token: string): Promise<TgResult<{ chatId: string; name: string }>> {
  try {
    const j = await call(fetchFn, token, 'getUpdates')
    if (!j?.ok || !Array.isArray(j.result)) return { ok: false, error: 'rejected' }
    for (const u of [...j.result].reverse()) {
      const m = u?.message
      if (m?.chat?.type === 'private' && typeof m.text === 'string' && m.text.trim().startsWith('/start') && m.chat.id !== undefined) {
        const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || ''
        return { ok: true, chatId: String(m.chat.id), name }
      }
    }
    return { ok: false, error: 'no_start_yet' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function sendMessage(fetchFn: FetchLike, token: string, chatId: string, text: string): Promise<TgResult<object>> {
  try {
    const j = await call(fetchFn, token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true })
    return j?.ok ? { ok: true } : { ok: false, error: 'rejected' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function pushText(title: string, body: string): string {
  return body ? `🐝 ${title}\n${body}` : `🐝 ${title}`
}
