// Feishu sign-in for Butler: the user's own user_access_token, so Butler
// can read and answer their messages as them.
//
// Exchanging a code and refreshing a token need the Feishu app's secret,
// which must never ship in Hive (open source). That half runs on the Jira
// Prime relay (nocodevit/jira-prime-feishu, README "Hive 授权中转"); this
// module is the client half of that contract. Day-to-day API calls go
// straight to Feishu with the user token — the relay never sees messages.
//
// Side effects (HTTP, browser, loopback server, storage) are deps so the
// flow is testable without Feishu.

import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'

export const FEISHU_RELAY = 'https://jira-prime-feishu.onrender.com'

/** Loopback overrides only, for tests — never point Hive at another host. */
export function relayUrl(override: string | undefined): string {
  return override && /^http:\/\/127\.0\.0\.1:\d+$/.test(override) ? override : FEISHU_RELAY
}

export function redirectUri(relay: string): string {
  return `${relay}/api/hive/oauth/callback`
}

/** state: 32 random bytes; verifier: 48; challenge = S256(verifier). All base64url, no padding. */
export function newPkce(rand: (n: number) => Buffer = randomBytes) {
  const state = rand(32).toString('base64url')
  const verifier = rand(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { state, verifier, challenge }
}

export function startUrl(relay: string, port: number, state: string, challenge: string): string {
  const q = new URLSearchParams({ port: String(port), state, code_challenge: challenge })
  return `${relay}/api/hive/oauth/start?${q}`
}

export interface FeishuTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  accessExpiresAt: number
  refreshExpiresAt: number
  scope: string
  openId: string
  name: string
}

export type RelayError = 'invalid_grant' | 'invalid_request' | 'rate_limited' | 'feishu_error' | 'not_configured' | 'network'

/** `tokens` is set exactly when `ok`; `error` exactly when not. */
export interface RelayResult {
  ok: boolean
  tokens?: FeishuTokens
  error?: RelayError
  retryAfterSec?: number
  detail?: string
}

/** Relay JSON → tokens. `prev` carries identity across a refresh (refresh omits it). */
export function parseRelayResponse(
  status: number,
  body: any,
  retryAfter: string | null,
  now: number,
  prev?: Pick<FeishuTokens, 'openId' | 'name'>
): RelayResult {
  if (status === 200 && body?.ok === true && typeof body.access_token === 'string' && typeof body.refresh_token === 'string') {
    const expiresIn = Number(body.expires_in) || 0
    const refreshIn = Number(body.refresh_token_expires_in) || 0
    return {
      ok: true,
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        accessExpiresAt: now + expiresIn * 1000,
        refreshExpiresAt: now + refreshIn * 1000,
        scope: typeof body.scope === 'string' ? body.scope : '',
        openId: typeof body.open_id === 'string' ? body.open_id : prev?.openId || '',
        name: typeof body.name === 'string' ? body.name : prev?.name || ''
      }
    }
  }
  const known: RelayError[] = ['invalid_grant', 'invalid_request', 'rate_limited', 'feishu_error', 'not_configured']
  const error: RelayError = known.includes(body?.error) ? body.error : status === 429 ? 'rate_limited' : 'feishu_error'
  const detail = [body?.feishu_code, body?.feishu_msg].filter(v => v !== undefined && v !== '').join(' ')
  const retry = Number(retryAfter)
  return { ok: false, error, ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}), ...(detail ? { detail } : {}) }
}

/** Refresh when less than this is left on the access token. */
export const REFRESH_MARGIN_MS = 5 * 60_000
export const RELAY_TIMEOUT_MS = 90_000
export const LOGIN_TIMEOUT_MS = 10 * 60_000

export type FeishuStatus =
  | { state: 'signed_out' }
  | { state: 'signing_in' }
  | { state: 'signed_in'; name: string; openId: string; scope: string; refreshExpiresAt: number }
  | { state: 'expired' }
  | { state: 'error'; error: string }

export interface TokenStore {
  load(): FeishuTokens | null
  save(t: FeishuTokens): void
  clear(): void
}

export interface FeishuAuthDeps {
  relay: string
  store: TokenStore
  post: (url: string, body: unknown) => Promise<{ status: number; retryAfter: string | null; body: any }>
  openBrowser: (url: string) => void
  onStatus: (s: FeishuStatus) => void
  now?: () => number
  /** Test seam: a loopback server factory (defaults to node:http). */
  listen?: (handler: (path: string, query: URLSearchParams) => { status: number; html: string }) => Promise<{ port: number; close: () => void }>
}

const DONE_HTML = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Hive</title><body style="font:15px -apple-system;padding:40px;text-align:center">${msg}</body>`

function defaultListen(handler: (path: string, q: URLSearchParams) => { status: number; html: string }) {
  return new Promise<{ port: number; close: () => void }>((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1')
      const out = req.method === 'GET' ? handler(u.pathname, u.searchParams) : { status: 405, html: '' }
      res.writeHead(out.status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(out.html)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ port: typeof addr === 'object' && addr ? addr.port : 0, close: () => server.close() })
    })
  })
}

export function createFeishuAuth(deps: FeishuAuthDeps) {
  const now = deps.now ?? Date.now
  const listen = deps.listen ?? defaultListen
  let status: FeishuStatus = { state: 'signed_out' }
  let inflight: Promise<RelayResult> | null = null
  let cancelLogin: (() => void) | null = null
  // Only the latest sign-in may change the status (a cancelled earlier one
  // finishes after the new one started).
  let loginGen = 0

  const set = (s: FeishuStatus) => { status = s; deps.onStatus(s) }
  const signedIn = (t: FeishuTokens): FeishuStatus =>
    ({ state: 'signed_in', name: t.name, openId: t.openId, scope: t.scope, refreshExpiresAt: t.refreshExpiresAt })

  function init() {
    const t = deps.store.load()
    if (!t) return set({ state: 'signed_out' })
    if (t.refreshExpiresAt <= now()) { deps.store.clear(); return set({ state: 'expired' }) }
    set(signedIn(t))
  }

  async function callRelay(path: string, body: unknown, prev?: Pick<FeishuTokens, 'openId' | 'name'>): Promise<RelayResult> {
    try {
      const r = await deps.post(`${deps.relay}${path}`, body)
      return parseRelayResponse(r.status, r.body, r.retryAfter, now(), prev)
    } catch (e) {
      return { ok: false, error: 'network', detail: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Browser sign-in. Resolves when it finished one way or another. */
  async function login(): Promise<FeishuStatus> {
    cancelLogin?.()
    const gen = ++loginGen
    const mine = (s: FeishuStatus) => { if (gen === loginGen) set(s) }
    const { state, verifier, challenge } = newPkce()
    set({ state: 'signing_in' })
    let settle!: (r: { code?: string; error?: string }) => void
    const answered = new Promise<{ code?: string; error?: string }>(r => { settle = r })
    let server: { port: number; close: () => void }
    try {
      server = await listen((path, q) => {
      if (path !== '/callback') return { status: 404, html: '' }
      // Anything not carrying our state is not our sign-in: ignore it.
      if (q.get('state') !== state) return { status: 400, html: DONE_HTML('Wrong sign-in link. Start again from Hive.') }
      const error = q.get('error')
      const code = q.get('code')
      settle(error ? { error } : code ? { code } : { error: 'no_code' })
      return { status: 200, html: DONE_HTML(error ? 'Sign-in cancelled. You can close this tab.' : 'Signed in to Feishu. You can close this tab and go back to Hive.') }
      })
    } catch (e) {
      mine({ state: 'error', error: `local_port: ${e instanceof Error ? e.message : String(e)}` })
      return status
    }
    const timer = setTimeout(() => settle({ error: 'timeout' }), LOGIN_TIMEOUT_MS)
    cancelLogin = () => settle({ error: 'cancelled' })
    deps.openBrowser(startUrl(deps.relay, server.port, state, challenge))
    const got = await answered
    clearTimeout(timer)
    if (gen === loginGen) cancelLogin = null
    server.close()
    if (!got.code) {
      const t = deps.store.load()
      mine(t ? signedIn(t) : got.error === 'access_denied' || got.error === 'cancelled' ? { state: 'signed_out' } : { state: 'error', error: got.error || 'unknown' })
      return status
    }
    // The code is good for 5 minutes, once: exchange it right away.
    const r = await callRelay('/api/hive/oauth/token', { code: got.code, code_verifier: verifier, redirect_uri: redirectUri(deps.relay) })
    if (!r.ok) {
      mine({ state: 'error', error: r.detail ? `${r.error}: ${r.detail}` : r.error })
      return status
    }
    try {
      deps.store.save(r.tokens)
    } catch (e) {
      mine({ state: 'error', error: `storage: ${e instanceof Error ? e.message : String(e)}` })
      return status
    }
    mine(signedIn(r.tokens))
    return status
  }

  function refreshNow(t: FeishuTokens): Promise<RelayResult> {
    // One refresh at a time: a refresh token works once, so a second
    // concurrent call would burn the user's session.
    if (inflight) return inflight
    inflight = callRelay('/api/hive/oauth/refresh', { refresh_token: t.refreshToken }, t).then(r => {
      if (r.ok) {
        // Not saving the new single-use refresh token would lose the
        // session at the next refresh — but the access token still works.
        try { deps.store.save(r.tokens) } catch { /* reported at next init */ }
        set(signedIn(r.tokens))
      }
      else if (r.error === 'invalid_grant') { deps.store.clear(); set({ state: 'expired' }) }
      return r
    }).finally(() => { inflight = null })
    return inflight
  }

  /** A usable access token, refreshing first when close to expiry. */
  async function accessToken(): Promise<{ ok: boolean; token?: string; error?: string }> {
    const t = deps.store.load()
    if (!t) return { ok: false, error: status.state === 'expired' ? 'expired' : 'signed_out' }
    if (t.accessExpiresAt - now() > REFRESH_MARGIN_MS) return { ok: true, token: t.accessToken }
    const r = await refreshNow(t)
    if (r.ok) return { ok: true, token: r.tokens.accessToken }
    // Rate limit / network: the old token may still have a few minutes.
    if (r.error !== 'invalid_grant' && t.accessExpiresAt > now()) return { ok: true, token: t.accessToken }
    return { ok: false, error: r.error }
  }

  function logout() {
    loginGen++
    cancelLogin?.()
    deps.store.clear()
    set({ state: 'signed_out' })
  }

  return { init, login, logout, accessToken, getStatus: () => status }
}
