import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  relayUrl, FEISHU_RELAY, redirectUri, newPkce, startUrl, parseRelayResponse, createFeishuAuth,
  REFRESH_MARGIN_MS, KEEPALIVE_LEFT_MS, type FeishuTokens, type FeishuStatus, type TokenStore
} from '../feishuAuth'
import { probeFeishu } from '../feishuProbe'

const OK_BODY = {
  ok: true, access_token: 'u-access', expires_in: 7200, refresh_token: 'ur-refresh',
  refresh_token_expires_in: 604800, scope: 'offline_access im:message', open_id: 'ou_1', name: 'Mei'
}

describe('relayUrl', () => {
  it('defaults to the Prime relay', () => {
    expect(relayUrl(undefined)).toBe(FEISHU_RELAY)
    expect(redirectUri(FEISHU_RELAY)).toBe('https://jira-prime-feishu.onrender.com/api/hive/oauth/callback')
  })
  it('accepts only a loopback override', () => {
    expect(relayUrl('http://127.0.0.1:4999')).toBe('http://127.0.0.1:4999')
    expect(relayUrl('https://evil.example.com')).toBe(FEISHU_RELAY)
    expect(relayUrl('http://127.0.0.1:4999.evil.com')).toBe(FEISHU_RELAY)
  })
})

describe('newPkce / startUrl', () => {
  it('produces relay-valid state, verifier and S256 challenge', () => {
    const { state, verifier, challenge } = newPkce()
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('builds the start URL', () => {
    expect(startUrl('http://127.0.0.1:1', 5123, 'S', 'C')).toBe('http://127.0.0.1:1/api/hive/oauth/start?port=5123&state=S&code_challenge=C')
  })
})

describe('parseRelayResponse', () => {
  it('maps a token response to absolute expiry times', () => {
    const r = parseRelayResponse(200, OK_BODY, null, 1000)
    expect(r).toEqual({ ok: true, tokens: {
      accessToken: 'u-access', refreshToken: 'ur-refresh', accessExpiresAt: 1000 + 7200_000,
      refreshExpiresAt: 1000 + 604800_000, scope: 'offline_access im:message', openId: 'ou_1', name: 'Mei'
    } })
  })
  it('keeps the identity across a refresh, which omits it', () => {
    const { open_id, name, ...refresh } = OK_BODY
    expect(parseRelayResponse(200, refresh, null, 0, { openId: 'ou_1', name: 'Mei' }).tokens).toMatchObject({ openId: 'ou_1', name: 'Mei' })
  })
  it.each([
    [400, { ok: false, error: 'invalid_grant', feishu_code: 20064, feishu_msg: 'used' }, null, { ok: false, error: 'invalid_grant', detail: '20064 used' }],
    [429, { ok: false, error: 'rate_limited' }, '12', { ok: false, error: 'rate_limited', retryAfterSec: 12 }],
    [429, {}, null, { ok: false, error: 'rate_limited' }],
    [503, { ok: false, error: 'not_configured' }, null, { ok: false, error: 'not_configured' }],
    [502, { nonsense: 1 }, null, { ok: false, error: 'feishu_error' }]
  ])('status %i → %j', (status, body, retry, want) => {
    expect(parseRelayResponse(status as number, body, retry as string | null, 0)).toEqual(want)
  })
})

function memStore(initial: FeishuTokens | null = null): TokenStore & { value: FeishuTokens | null } {
  const s = { value: initial, load: () => s.value, save: (t: FeishuTokens) => { s.value = t }, clear: () => { s.value = null } }
  return s
}

function harness(opts: { store?: ReturnType<typeof memStore>; responses?: Array<{ status: number; body: any; retryAfter?: string }>; holdFirstPost?: boolean; listenFails?: boolean } = {}) {
  const store = opts.store ?? memStore()
  const posts: Array<{ url: string; body: any }> = []
  const opened: string[] = []
  const statuses: FeishuStatus[] = []
  let clock = 1_000_000
  let handler: ((path: string, q: URLSearchParams) => { status: number; html: string }) | null = null
  let closed = 0
  const queue = [...(opts.responses ?? [])]
  let release: (() => void) | null = null
  const auth = createFeishuAuth({
    relay: 'http://127.0.0.1:4999',
    store,
    post: async (url, body) => {
      posts.push({ url, body })
      if (opts.holdFirstPost && posts.length === 1) await new Promise<void>(r => { release = r })
      const next = queue.shift() ?? { status: 200, body: OK_BODY }
      return { status: next.status, retryAfter: next.retryAfter ?? null, body: next.body }
    },
    openBrowser: u => opened.push(u),
    onStatus: s => statuses.push(s),
    now: () => clock,
    listen: async h => { if (opts.listenFails) throw new Error('EADDRINUSE'); handler = h; return { port: 5555, close: () => { closed++ } } }
  })
  const tick = () => new Promise(r => setTimeout(r, 0))
  return {
    auth, store, posts, opened, statuses, tick,
    callback: (q: Record<string, string>) => handler!('/callback', new URLSearchParams(q)),
    stateFromOpened: () => new URL(opened[opened.length - 1]).searchParams.get('state')!,
    closed: () => closed,
    advance: (ms: number) => { clock += ms },
    releasePost: () => release?.()
  }
}

describe('login', () => {
  it('opens the relay start URL, takes the callback, exchanges the code and stores the tokens', async () => {
    const h = harness()
    const done = h.auth.login()
    await h.tick()
    expect(h.auth.getStatus()).toEqual({ state: 'signing_in' })
    const u = new URL(h.opened[0])
    expect(u.pathname).toBe('/api/hive/oauth/start')
    expect(u.searchParams.get('port')).toBe('5555')
    const reply = h.callback({ code: 'C0DE', state: h.stateFromOpened() })
    expect(reply.status).toBe(200)
    expect(await done).toMatchObject({ state: 'signed_in', name: 'Mei', openId: 'ou_1' })
    expect(h.posts[0].url).toBe('http://127.0.0.1:4999/api/hive/oauth/token')
    expect(h.posts[0].body).toMatchObject({ code: 'C0DE', redirect_uri: 'http://127.0.0.1:4999/api/hive/oauth/callback' })
    // The verifier sent is the one whose hash went to /start.
    expect(createHash('sha256').update(h.posts[0].body.code_verifier).digest('base64url')).toBe(u.searchParams.get('code_challenge'))
    expect(h.store.value?.accessToken).toBe('u-access')
    expect(h.closed()).toBe(1)
  })

  it('ignores a callback with someone else\'s state', async () => {
    const h = harness()
    const done = h.auth.login()
    await h.tick()
    expect(h.callback({ code: 'X', state: 'not-ours' }).status).toBe(400)
    expect(h.posts).toHaveLength(0)
    h.callback({ code: 'C', state: h.stateFromOpened() })
    expect((await done).state).toBe('signed_in')
  })

  it('a refusal in Feishu leaves you signed out', async () => {
    const h = harness()
    const done = h.auth.login()
    await h.tick()
    h.callback({ error: 'access_denied', state: h.stateFromOpened() })
    expect(await done).toEqual({ state: 'signed_out' })
    expect(h.posts).toHaveLength(0)
  })

  it('a failed exchange shows the relay error', async () => {
    const h = harness({ responses: [{ status: 400, body: { ok: false, error: 'invalid_grant', feishu_code: 20003 } }] })
    const done = h.auth.login()
    await h.tick()
    h.callback({ code: 'C', state: h.stateFromOpened() })
    expect(await done).toEqual({ state: 'error', error: 'invalid_grant: 20003' })
    expect(h.store.value).toBeNull()
  })

  it('a local port that cannot open is an error, not a stuck sign-in', async () => {
    const h = harness({ listenFails: true })
    expect(await h.auth.login()).toEqual({ state: 'error', error: 'local_port: EADDRINUSE' })
    expect(h.opened).toHaveLength(0)
  })

  it('a store that cannot save is an error, not a stuck sign-in', async () => {
    const store = memStore()
    store.save = () => { throw new Error('encryption unavailable') }
    const h = harness({ store })
    const done = h.auth.login()
    await h.tick()
    h.callback({ code: 'C', state: h.stateFromOpened() })
    expect(await done).toEqual({ state: 'error', error: 'storage: encryption unavailable' })
  })

  it('a second sign-in supersedes the first, which cannot change the status afterwards', async () => {
    const h = harness()
    const first = h.auth.login()
    await h.tick()
    const second = h.auth.login()
    await first
    expect(h.auth.getStatus()).toEqual({ state: 'signing_in' })
    await h.tick()
    h.callback({ code: 'C', state: h.stateFromOpened() })
    expect((await second).state).toBe('signed_in')
  })
})

const tokens = (over: Partial<FeishuTokens> = {}): FeishuTokens => ({
  accessToken: 'u-old', refreshToken: 'ur-old', accessExpiresAt: 1_000_000 + 3600_000,
  refreshExpiresAt: 1_000_000 + 7 * 86400_000, scope: 's', openId: 'ou_1', name: 'Mei', ...over
})

describe('accessToken / refresh', () => {
  it('returns the stored token while it has time left', async () => {
    const h = harness({ store: memStore(tokens()) })
    expect(await h.auth.accessToken()).toEqual({ ok: true, token: 'u-old' })
    expect(h.posts).toHaveLength(0)
  })

  it('refreshes inside the margin and replaces the single-use refresh token', async () => {
    const h = harness({ store: memStore(tokens({ accessExpiresAt: 1_000_000 + REFRESH_MARGIN_MS - 1 })) })
    expect(await h.auth.accessToken()).toEqual({ ok: true, token: 'u-access' })
    expect(h.posts[0]).toEqual({ url: 'http://127.0.0.1:4999/api/hive/oauth/refresh', body: { refresh_token: 'ur-old' } })
    expect(h.store.value?.refreshToken).toBe('ur-refresh')
    expect(h.store.value?.name).toBe('Mei')
  })

  it('concurrent callers share one refresh request', async () => {
    {
      const h = harness({ store: memStore(tokens({ accessExpiresAt: 1_000_000 })), holdFirstPost: true })
      const a = h.auth.accessToken()
      const b = h.auth.accessToken()
      await h.tick()
      h.releasePost()
      expect(await a).toEqual({ ok: true, token: 'u-access' })
      expect(await b).toEqual({ ok: true, token: 'u-access' })
      expect(h.posts).toHaveLength(1)
    }
  })

  it('invalid_grant clears the tokens and asks for a new sign-in', async () => {
    const h = harness({ store: memStore(tokens({ accessExpiresAt: 1_000_000 })), responses: [{ status: 400, body: { ok: false, error: 'invalid_grant' } }] })
    expect(await h.auth.accessToken()).toEqual({ ok: false, error: 'invalid_grant' })
    expect(h.store.value).toBeNull()
    expect(h.auth.getStatus()).toEqual({ state: 'expired' })
  })

  it('a rate limit is not a lost session: the old token is used while still valid', async () => {
    const h = harness({ store: memStore(tokens({ accessExpiresAt: 1_000_000 + 60_000 })), responses: [{ status: 429, body: { ok: false, error: 'rate_limited' }, retryAfter: '5' }] })
    expect(await h.auth.accessToken()).toEqual({ ok: true, token: 'u-old' })
    expect(h.store.value?.refreshToken).toBe('ur-old')
    expect(h.auth.getStatus().state).not.toBe('expired')
  })

  it('a network failure with an expired access token reports it, keeping the session', async () => {
    const h = harness({ store: memStore(tokens({ accessExpiresAt: 999_000 })), responses: [{ status: 502, body: { ok: false, error: 'feishu_error' } }] })
    expect(await h.auth.accessToken()).toEqual({ ok: false, error: 'feishu_error' })
    expect(h.store.value).not.toBeNull()
  })
})

describe('init / logout', () => {
  it('signed in from storage; expired refresh token → expired and cleared', () => {
    const a = harness({ store: memStore(tokens()) })
    a.auth.init()
    expect(a.auth.getStatus()).toMatchObject({ state: 'signed_in', name: 'Mei' })
    const b = harness({ store: memStore(tokens({ refreshExpiresAt: 1 })) })
    b.auth.init()
    expect(b.auth.getStatus()).toEqual({ state: 'expired' })
    expect(b.store.value).toBeNull()
  })
  it('logout clears the tokens', () => {
    const h = harness({ store: memStore(tokens()) })
    h.auth.logout()
    expect(h.store.value).toBeNull()
    expect(h.auth.getStatus()).toEqual({ state: 'signed_out' })
  })
})

describe('probeFeishu', () => {
  it('reports counts and kinds only — no message text or chat names', async () => {
    const calls: string[] = []
    const report = await probeFeishu('u-x', 'im:message offline_access', async (url) => {
      calls.push(url)
      if (url.includes('/authen/v1/user_info')) return { status: 200, body: { code: 0, data: { open_id: 'ou_1', name: 'Mei' } } }
      if (url.includes('/im/v1/chats')) return { status: 200, body: { code: 0, data: { has_more: false, items: [
        { chat_id: 'oc_p2p', chat_mode: 'p2p', name: 'Secret DM' }, { chat_id: 'oc_grp', chat_mode: 'group', name: 'Secret group' }] } } }
      if (url.includes('oc_p2p')) return { status: 200, body: { code: 0, data: { items: [
        { msg_type: 'text', create_time: '1792400000000', sender: { sender_type: 'user' }, body: { content: '{"text":"private words"}' } }] } } }
      if (url.includes('oc_grp')) return { status: 200, body: { code: 99991672, msg: 'no permission' } }
      return { status: 200, body: { code: 0, data: { calendar_list: [{}, {}] } } }
    })
    expect(report.scope).toEqual(['im:message', 'offline_access'])
    expect(report.chats).toEqual({ ok: true, count: 2, modes: ['p2p', 'group'], hasMore: false })
    expect(report.p2pMessages).toMatchObject({ ok: true, count: 1, types: ['text'], senderTypes: ['user'] })
    expect(report.groupMessages).toEqual({ ok: false, code: 99991672, msg: 'no permission' })
    expect(report.calendars).toEqual({ ok: true, count: 2 })
    const text = JSON.stringify(report)
    expect(text).not.toContain('private words')
    expect(text).not.toContain('Secret')
    expect(text).not.toContain('Mei')
  })
})

describe('keepAlive', () => {
  it('leaves a fresh session alone', async () => {
    const h = harness({ store: memStore(tokens({ refreshExpiresAt: 1_000_000 + KEEPALIVE_LEFT_MS + 60_000 })) })
    expect(await h.auth.keepAlive()).toBe(true)
    expect(h.posts).toHaveLength(0)
  })
  it('refreshes once the refresh token is a day old', async () => {
    const h = harness({ store: memStore(tokens({ refreshExpiresAt: 1_000_000 + KEEPALIVE_LEFT_MS - 1 })) })
    expect(await h.auth.keepAlive()).toBe(true)
    expect(h.posts[0].url).toContain('/oauth/refresh')
    expect(h.store.value?.refreshToken).toBe('ur-refresh')
  })
  it('an already dead session is cleared and reported expired', async () => {
    const h = harness({ store: memStore(tokens({ refreshExpiresAt: 999_000 })) })
    expect(await h.auth.keepAlive()).toBe(false)
    expect(h.auth.getStatus()).toEqual({ state: 'expired' })
    expect(h.posts).toHaveLength(0)
  })
  it('signed out → nothing to do', async () => {
    const h = harness()
    expect(await h.auth.keepAlive()).toBe(false)
  })
})
