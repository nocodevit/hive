import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createFeishuAgent, parseDecision, ensurePrefix, lockedTopicHit, inQuietHours, messageText, normalizeAgentSettings,
  defaultPrefix, FOLLOWUP_KIND, RECALL_WINDOW_MS
} from '../feishuAgent'
import { createApprovals } from '../approvals'
import { EMPTY_PROFILE } from '../butlerProfile'

const SELF = 'ou_me'
const MIN = 60_000
const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime()

type Msg = { message_id: string; create_time: string; sender: { id: string; sender_type: string }; msg_type: string; body: { content: string }; mentions?: any[]; chat_id: string }

function fakeFeishu(clock: () => number) {
  const chats = [{ chat_id: 'p1', name: 'Lin', chat_mode: 'p2p' }, { chat_id: 'g1', name: 'Team', chat_mode: 'group' }]
  const msgs: Record<string, Msg[]> = { p1: [], g1: [] }
  const sent: Array<{ replyTo: string; text: string; id: string }> = []
  const deleted: string[] = []
  let n = 0
  const add = (chat: string, from: string, text: string, at = clock(), mentions?: any[]) => {
    const m: Msg = {
      message_id: `om_${++n}`, create_time: String(at), sender: { id: from, sender_type: 'user' }, msg_type: 'text',
      body: { content: JSON.stringify({ text }) }, chat_id: chat, ...(mentions ? { mentions } : {})
    }
    msgs[chat].push(m)
    return m
  }
  const http = async (method: string, url: string, _token: string, body?: any) => {
    const u = new URL(url)
    const path = u.pathname.replace('/open-apis', '')
    if (method === 'GET' && path === '/im/v1/chats') return { status: 200, body: { code: 0, data: { items: chats, has_more: false } } }
    if (method === 'GET' && path === '/im/v1/messages') {
      const list = msgs[u.searchParams.get('container_id')!] ?? []
      if (u.searchParams.get('sort_type') === 'ByCreateTimeDesc') {
        const k = Number(u.searchParams.get('page_size'))
        return { status: 200, body: { code: 0, data: { items: list.slice().reverse().slice(0, k), has_more: false } } }
      }
      const since = Number(u.searchParams.get('start_time')) * 1000
      return { status: 200, body: { code: 0, data: { items: list.filter(m => Number(m.create_time) >= since), has_more: false } } }
    }
    const reply = path.match(/^\/im\/v1\/messages\/([^/]+)\/reply$/)
    if (method === 'POST' && reply) {
      const orig = Object.values(msgs).flat().find(m => m.message_id === decodeURIComponent(reply[1]))!
      const text = JSON.parse(body.content).text
      const m = add(orig.chat_id, SELF, text)
      sent.push({ replyTo: orig.message_id, text, id: m.message_id })
      return { status: 200, body: { code: 0, data: { message_id: m.message_id } } }
    }
    const del = path.match(/^\/im\/v1\/messages\/([^/]+)$/)
    if (method === 'DELETE' && del) { deleted.push(decodeURIComponent(del[1])); return { status: 200, body: { code: 0 } } }
    return { status: 404, body: { code: 404 } }
  }
  return { msgs, sent, deleted, add, http }
}

function setup(opts: { claude?: (p: string) => string | Promise<string>; settings?: any; profile?: Partial<typeof EMPTY_PROFILE> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hive-feishu-agent-'))
  let clock = T0
  const now = () => clock
  const fs = fakeFeishu(now)
  const approvals = createApprovals({ dir, now })
  const notes: string[] = []
  const prompts: string[] = []
  const deps = {
    dir, http: fs.http as any, now,
    token: async () => ({ ok: true, token: 'u-test' }),
    selfOpenId: () => SELF,
    profile: () => ({ ...EMPTY_PROFILE, name: 'Mei', ...opts.profile }),
    runClaude: async (p: string) => { prompts.push(p); return opts.claude ? opts.claude(p) : '{"decision":"answer","reply":"Missy 在修 iOS 失焦"}' },
    approvals,
    notify: (_t: string, b: string) => { notes.push(b) }
  }
  const agent = createFeishuAgent(deps)
  agent.setSettings({ enabled: true, ...opts.settings })
  return { dir, fs, agent, approvals, notes, prompts, deps, advance: (ms: number) => { clock += ms }, now }
}

describe('pure helpers', () => {
  it('parseDecision: strict JSON, anything else escalates', () => {
    expect(parseDecision('{"decision":"answer","reply":"ok"}')).toEqual({ decision: 'answer', reply: 'ok' })
    expect(parseDecision('Sure!\n```json\n{"decision":"escalate","reply":"draft","reason":"date"}\n```')).toEqual({ decision: 'escalate', reply: 'draft', reason: 'date' })
    expect(parseDecision('not json').decision).toBe('escalate')
    expect(parseDecision('{"decision":"maybe","reply":"x"}').decision).toBe('escalate')
    expect(parseDecision('{"decision":"answer","reply":"  "}')).toMatchObject({ decision: 'escalate', reason: 'empty_reply' })
    expect(parseDecision('{bad')).toMatchObject({ decision: 'escalate', reason: 'bad_json' })
  })

  it('ensurePrefix prepends once', () => {
    expect(ensurePrefix('hi', '【Mei 的 AI 代理】')).toBe('【Mei 的 AI 代理】hi')
    expect(ensurePrefix(' 【Mei 的 AI 代理】hi', '【Mei 的 AI 代理】')).toBe('【Mei 的 AI 代理】hi')
  })

  it('defaultPrefix: profile prefix, else name', () => {
    expect(defaultPrefix({ name: 'Mei', prefix: '' })).toBe('【Mei 的 AI 代理】')
    expect(defaultPrefix({ name: 'Mei', prefix: '[Mei bot]' })).toBe('[Mei bot]')
  })

  it('lockedTopicHit covers locked topics and extra words', () => {
    expect(lockedTopicHit('checkout 什么时候好？', [])).toBe('dates')
    expect(lockedTopicHit('报价多少', [])).toBe('prices')
    expect(lockedTopicHit('Can you approve this?', [])).toBe('approvals')
    expect(lockedTopicHit('客户那边怎么说', [])).toBe('customers')
    expect(lockedTopicHit('我们要招人吗', ['招人'])).toBe('招人')
    expect(lockedTopicHit('build 挂了吗', [])).toBeNull()
  })

  it('inQuietHours handles ranges across midnight', () => {
    const q = { start: '22:00', end: '08:00' }
    expect(inQuietHours(q, new Date(2026, 0, 1, 23, 0))).toBe(true)
    expect(inQuietHours(q, new Date(2026, 0, 1, 7, 59))).toBe(true)
    expect(inQuietHours(q, new Date(2026, 0, 1, 8, 0))).toBe(false)
    expect(inQuietHours(null, new Date())).toBe(false)
  })

  it('messageText resolves @mentions and post content', () => {
    expect(messageText({ msg_type: 'text', body: { content: '{"text":"@_user_1 进度?"}' }, mentions: [{ key: '@_user_1', name: 'Mei' }] })).toBe('@Mei 进度?')
    expect(messageText({ msg_type: 'post', body: { content: JSON.stringify({ title: 'T', content: [[{ tag: 'text', text: 'a' }]] }) } })).toBe('T\na')
    expect(messageText({ msg_type: 'image', body: { content: '{}' } })).toBe('[image]')
  })

  it('normalizeAgentSettings applies defaults and bounds', () => {
    const s = normalizeAgentSettings({ scope: 'x', waitBeforeReplyMs: -5, quietHours: { start: '25:00', end: '1' } })
    expect(s).toMatchObject({ enabled: false, scope: 'everyone', waitBeforeReplyMs: 0, quietHours: null, maxRepliesPerChatPerHour: 10 })
  })
})

describe('feishu agent', () => {
  it('first enable starts at now: history is never answered', async () => {
    const t = setup({ settings: { enabled: false } })
    t.fs.add('p1', 'ou_lin', 'old question', T0 - 10 * MIN)
    t.agent.setSettings({ enabled: true })
    t.advance(5 * MIN)
    await t.agent.tick()
    expect(t.agent.pendingJobs()).toHaveLength(0)
    expect(t.fs.sent).toHaveLength(0)
  })

  it('waits waitBeforeReplyMs, then answers with the prefix as a reply to that message', async () => {
    const t = setup()
    t.advance(1000)
    const q = t.fs.add('p1', 'ou_lin', 'build 状态?')
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(0)
    t.advance(1 * MIN)
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(0)
    t.advance(1 * MIN)
    const out = await t.agent.tick()
    expect(out).toEqual([{ messageId: q.message_id, result: 'answered' }])
    expect(t.fs.sent).toEqual([expect.objectContaining({ replyTo: q.message_id, text: '【Mei 的 AI 代理】Missy 在修 iOS 失焦' })])
    expect(t.prompts[0]).toContain('answer-feishu')
    expect(t.prompts[0]).toContain('build 状态?')
  })

  it('never answers the same message twice (cursor + seen ids, also across restarts)', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build 状态?')
    t.fs.add('p1', 'ou_lin', 'tests 呢?')
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(2)
    await t.agent.tick()
    t.advance(MIN)
    await t.agent.tick()
    const again = createFeishuAgent({ ...t.deps, approvals: createApprovals({ dir: t.dir, now: t.now }) })
    await again.tick()
    expect(t.fs.sent).toHaveLength(2)
    const state = JSON.parse(readFileSync(join(t.dir, 'feishu-agent-state.json'), 'utf8'))
    expect(state.chats.p1.lastId).toBe(t.fs.msgs.p1[t.fs.msgs.p1.length - 1].message_id)
  })

  it('a message in the same second as the cursor is still picked up once', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'one', T0 + 1000)
    await t.agent.tick()
    t.fs.add('p1', 'ou_lin', 'two', T0 + 1500)
    t.advance(1000)
    await t.agent.tick()
    expect(t.fs.sent.map(s => s.replyTo)).toEqual(['om_1', 'om_3'])
  })

  it('skips when the owner replied during the wait (owner took over)', async () => {
    const t = setup()
    t.advance(1000)
    const q = t.fs.add('p1', 'ou_lin', 'build 状态?')
    await t.agent.tick()
    t.advance(MIN)
    t.fs.add('p1', SELF, '我来回答')
    t.advance(MIN)
    const out = await t.agent.tick()
    expect(out).toEqual([{ messageId: q.message_id, result: 'skipped', why: 'owner_took_over' }])
    expect(t.fs.sent).toHaveLength(0)
  })

  it("Butler's own replies do not count as the owner taking over", async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 2 * MIN } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'a?')
    await t.agent.tick()
    t.advance(MIN)
    t.fs.add('p1', 'ou_lin', 'b?')
    await t.agent.tick()
    t.advance(MIN)
    await t.agent.tick() // answers a
    t.advance(MIN)
    await t.agent.tick() // b: only Butler's reply came after it
    expect(t.fs.sent).toHaveLength(2)
  })

  it('groups: only when the owner is @mentioned; p2p always', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 } })
    t.advance(1000)
    t.fs.add('g1', 'ou_lin', 'anyone?')
    const m = t.fs.add('g1', 'ou_lin', '@_user_1 build?', undefined, [{ key: '@_user_1', id: SELF, name: 'Mei' }])
    t.fs.add('g1', 'ou_ben', '@_user_1 hi', undefined, [{ key: '@_user_1', id: 'ou_other', name: 'Ben' }])
    await t.agent.tick()
    expect(t.fs.sent.map(s => s.replyTo)).toEqual([m.message_id])
  })

  it('scope picked: only the picked people', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, scope: 'picked', picked: ['ou_ben'] } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(0)
    expect(t.agent.senders()).toEqual({ ou_lin: 'Lin' })
  })

  it('enforces the prefix even when the model omits or adds it', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, prefix: '[bot]' }, claude: () => '{"decision":"answer","reply":"[bot]已在修"}' })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    await t.agent.tick()
    expect(t.fs.sent[0].text).toBe('[bot]已在修')
  })

  it('locked topic overrides an "answer": holding reply + follow-up approval; approving replies to the original', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 }, claude: () => '{"decision":"answer","reply":"周五上线"}' })
    t.advance(1000)
    const q = t.fs.add('p1', 'ou_lin', 'checkout 什么时候好？')
    const out = await t.agent.tick()
    expect(out[0]).toEqual({ messageId: q.message_id, result: 'escalated' })
    expect(t.fs.sent).toEqual([expect.objectContaining({ replyTo: q.message_id, text: '【Mei 的 AI 代理】我需要和 Mei 确认，稍后回复你' })])
    const [item] = t.approvals.pending()
    expect(item).toMatchObject({ kind: FOLLOWUP_KIND, draft: '周五上线', action: 'Reply' })
    expect(item.payload).toMatchObject({ messageId: q.message_id, chatId: 'p1', question: 'checkout 什么时候好？', topic: 'dates' })
    const r = await t.approvals.approve(item.id, '下周一上线')
    expect(r.ok).toBe(true)
    expect(t.fs.sent[1]).toEqual(expect.objectContaining({ replyTo: q.message_id, text: '【Mei 的 AI 代理】下周一上线' }))
    expect(t.agent.log(5)[0]).toMatchObject({ kind: 'followup', inReplyTo: q.message_id })
  })

  it('a locked word in the model reply also escalates; extraAskFirst too', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, extraAskFirst: ['招人'] }, claude: () => '{"decision":"answer","reply":"报价是 5 万"}' })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', '那个方案怎么样')
    t.fs.add('p1', 'ou_lin', '要招人吗')
    await t.agent.tick()
    expect(t.approvals.pending().map(i => (i.payload as any).topic)).toEqual(['prices', '招人'])
  })

  it('bad JSON from claude escalates; a claude failure escalates too', async () => {
    let call = 0
    const t = setup({ settings: { waitBeforeReplyMs: 0 }, claude: () => { if (call++ === 0) return 'oops'; throw new Error('timeout') } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    t.fs.add('p1', 'ou_lin', 'tests?')
    const out = await t.agent.tick()
    expect(out.map(o => o.result)).toEqual(['escalated', 'escalated'])
    expect(t.approvals.pending()).toHaveLength(2)
    expect(t.fs.sent.every(s => s.text.endsWith('稍后回复你'))).toBe(true)
  })

  it('reminds once when a follow-up is still pending after remindAfterMs', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, remindAfterMs: 30 * MIN }, claude: () => '{"decision":"escalate","reply":"draft"}' })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    await t.agent.tick()
    t.advance(29 * MIN)
    await t.agent.tick()
    expect(t.notes).toHaveLength(0)
    t.advance(2 * MIN)
    await t.agent.tick()
    await t.agent.tick()
    expect(t.notes).toHaveLength(1)
  })

  it('no reminder once the follow-up was handled', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 }, claude: () => '{"decision":"escalate","reply":"draft"}' })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    await t.agent.tick()
    t.approvals.reject(t.approvals.pending()[0].id)
    t.advance(60 * MIN)
    await t.agent.tick()
    expect(t.notes).toHaveLength(0)
  })

  it('rate limit: at most N replies per chat per hour', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, maxRepliesPerChatPerHour: 2 } })
    t.advance(1000)
    for (const q of ['a', 'b', 'c']) t.fs.add('p1', 'ou_lin', q)
    const out = await t.agent.tick()
    expect(out.map(o => o.result)).toEqual(['answered', 'answered', 'skipped'])
    expect(out[2]).toMatchObject({ why: 'rate_limited' })
    t.advance(61 * MIN)
    t.fs.add('p1', 'ou_lin', 'd')
    expect((await t.agent.tick()).map(o => o.result)).toEqual(['answered'])
  })

  it('quiet hours hold replies until they end', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, quietHours: { start: '09:00', end: '10:30' } } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'build?')
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(0)
    t.advance(31 * MIN)
    await t.agent.tick()
    expect(t.fs.sent).toHaveLength(1)
  })

  it('recall within 24 h deletes the message; after 24 h it refuses', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'a?')
    t.fs.add('p1', 'ou_lin', 'b?')
    await t.agent.tick()
    const [b, a] = t.agent.log()
    expect(await t.agent.recall(a.id)).toEqual({ ok: true })
    expect(t.fs.deleted).toEqual([a.id])
    expect(await t.agent.recall(a.id)).toEqual({ ok: false, error: 'already_recalled' })
    expect(t.agent.log().find(e => e.id === a.id)?.recalled).toBe(true)
    t.advance(RECALL_WINDOW_MS + 1)
    expect(await t.agent.recall(b.id)).toEqual({ ok: false, error: 'too_old' })
    expect(await t.agent.recall('nope')).toEqual({ ok: false, error: 'not_found' })
    expect(t.fs.deleted).toHaveLength(1)
  })

  it('logs every sent message to feishu-log.jsonl', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0 } })
    t.advance(1000)
    t.fs.add('p1', 'ou_lin', 'a?')
    await t.agent.tick()
    const lines = readFileSync(join(t.dir, 'feishu-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines).toEqual([expect.objectContaining({ chatId: 'p1', chatName: 'Lin', inReplyTo: 'om_1', kind: 'answer', time: T0 + 1000 })])
  })

  it('does nothing while disabled or signed out', async () => {
    const t = setup({ settings: { waitBeforeReplyMs: 0, enabled: false } })
    t.fs.add('p1', 'ou_lin', 'a?')
    await t.agent.tick()
    const signedOut = createFeishuAgent({ ...t.deps, dir: mkdtempSync(join(tmpdir(), 'hive-fa-')), selfOpenId: () => null })
    signedOut.setSettings({ enabled: true })
    await signedOut.tick()
    expect(signedOut.lastError()).toBe('signed_out')
    expect(t.fs.sent).toHaveLength(0)
    expect(existsSync(join(t.dir, 'feishu-log.jsonl'))).toBe(false)
  })
})
