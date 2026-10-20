// Feishu answer-for-me (代管): Butler answers messages sent to the owner,
// as the owner (user token), with a prefix that says it is their agent.
//
// Real-time push for user-identity messages is not available, so this
// polls the chats the owner is in. Per chat it keeps an exact cursor
// (create_time + message id) plus a set of seen message ids, so a message
// is looked at once and answered at most once. Enabling starts from "now":
// history is never answered.
//
// Each new message waits `waitBeforeReplyMs`; if the owner wrote in that
// chat meanwhile, the owner took over and nothing is sent. Otherwise
// `claude -p` (the answer-feishu skill) decides answer / escalate. Locked
// topics (dates, prices, promises, approvals, customers + the owner's own
// list) always escalate: a holding reply goes out and a follow-up waits in
// the approval queue with a suggested answer.
//
// Side effects (HTTP, token, claude, notifications, clock) are deps.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ButlerProfile } from './butlerProfile'
import type { Approval } from './approvals'

export const FEISHU_API = 'https://open.feishu.cn/open-apis'

export type AgentScope = 'everyone' | 'picked'

export interface QuietHours { start: string; end: string }

export interface FeishuAgentSettings {
  enabled: boolean
  scope: AgentScope
  /** open_ids answered when scope is 'picked'. */
  picked: string[]
  waitBeforeReplyMs: number
  remindAfterMs: number
  /** '' = default (profile prefix, else 【<name> 的 AI 代理】). */
  prefix: string
  extraAskFirst: string[]
  pollMs: number
  maxRepliesPerChatPerHour: number
  quietHours: QuietHours | null
}

export const DEFAULT_AGENT_SETTINGS: FeishuAgentSettings = {
  enabled: false,
  scope: 'everyone',
  picked: [],
  waitBeforeReplyMs: 2 * 60_000,
  remindAfterMs: 30 * 60_000,
  prefix: '',
  extraAskFirst: [],
  pollMs: 60_000,
  maxRepliesPerChatPerHour: 10,
  quietHours: null
}

export const LOCKED_TOPICS: Array<{ id: string; words: string[] }> = [
  { id: 'dates', words: ['日期', '几号', '哪天', '什么时候', '何时', '截止', '期限', '上线时间', 'deadline', 'ddl', 'due date', 'eta', 'when will', 'what date'] },
  { id: 'prices', words: ['价格', '报价', '多少钱', '费用', '折扣', '优惠', 'price', 'pricing', 'cost', 'quote', 'discount'] },
  { id: 'promises', words: ['承诺', '保证', '答应', '确保', 'promise', 'guarantee', 'commit to'] },
  { id: 'approvals', words: ['审批', '批准', '批一下', '同意吗', '签字', 'approve', 'approval', 'sign off'] },
  { id: 'customers', words: ['客户', '甲方', 'customer', 'client'] }
]

const HOUR = 3600_000
const DAY = 24 * HOUR
export const RECALL_WINDOW_MS = DAY
const SEEN_KEEP = 2000
const MAX_CHAT_PAGES = 5

const clampInt = (v: unknown, min: number, max: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt
const strList = (v: unknown, max = 50) =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean))).slice(0, max) : []
const hhmm = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

export function normalizeAgentSettings(raw: unknown): FeishuAgentSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const d = DEFAULT_AGENT_SETTINGS
  const q = s.quietHours
  return {
    enabled: s.enabled === true,
    scope: s.scope === 'picked' ? 'picked' : 'everyone',
    picked: strList(s.picked, 500),
    waitBeforeReplyMs: clampInt(s.waitBeforeReplyMs, 0, 60 * 60_000, d.waitBeforeReplyMs),
    remindAfterMs: clampInt(s.remindAfterMs, 60_000, DAY, d.remindAfterMs),
    prefix: typeof s.prefix === 'string' ? s.prefix.trim().slice(0, 60) : '',
    extraAskFirst: strList(s.extraAskFirst).map(x => x.slice(0, 40)),
    pollMs: clampInt(s.pollMs, 15_000, 30 * 60_000, d.pollMs),
    maxRepliesPerChatPerHour: clampInt(s.maxRepliesPerChatPerHour, 1, 100, d.maxRepliesPerChatPerHour),
    quietHours: q && hhmm(q.start) && hhmm(q.end) && q.start !== q.end ? { start: q.start, end: q.end } : null
  }
}

export function defaultPrefix(profile: Pick<ButlerProfile, 'name' | 'prefix'> & { assistantName?: string }): string {
  const named = profile.assistantName?.trim()
  return profile.prefix.trim() || `【${profile.name.trim() || '我'} 的 AI 代理${named ? ` · ${named}` : ''}】`
}

export function effectivePrefix(settings: FeishuAgentSettings, profile: Pick<ButlerProfile, 'name' | 'prefix'>): string {
  return settings.prefix || defaultPrefix(profile)
}

/** The prefix is enforced here, never left to the model. */
export function ensurePrefix(text: string, prefix: string): string {
  const t = text.trim()
  return t.startsWith(prefix) ? t : prefix + t
}

export function holdingReply(name: string): string {
  return `我需要和 ${name.trim() || 'TA'} 确认，稍后回复你`
}

export interface Decision { decision: 'answer' | 'escalate'; reply: string; reason?: string }

/** Strict JSON from the model; anything unusable escalates. */
export function parseDecision(out: string): Decision {
  const bad = (reason: string): Decision => ({ decision: 'escalate', reply: '', reason })
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start === -1 || end <= start) return bad('bad_json')
  let j: any
  try { j = JSON.parse(out.slice(start, end + 1)) } catch { return bad('bad_json') }
  if (!j || (j.decision !== 'answer' && j.decision !== 'escalate')) return bad('bad_json')
  const reply = typeof j.reply === 'string' ? j.reply.trim() : ''
  const reason = typeof j.reason === 'string' ? j.reason.slice(0, 200) : undefined
  if (j.decision === 'answer' && !reply) return bad('empty_reply')
  return { decision: j.decision, reply, ...(reason ? { reason } : {}) }
}

/** First locked topic (or owner-added word) the text touches, else null. */
export function lockedTopicHit(text: string, extra: string[]): string | null {
  const t = text.toLowerCase()
  for (const topic of LOCKED_TOPICS) if (topic.words.some(w => t.includes(w))) return topic.id
  for (const w of extra) if (w && t.includes(w.toLowerCase())) return w
  return null
}

const minutesOf = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
export function inQuietHours(q: QuietHours | null, at: Date): boolean {
  if (!q) return false
  const m = at.getHours() * 60 + at.getMinutes()
  const a = minutesOf(q.start), b = minutesOf(q.end)
  return a < b ? m >= a && m < b : m >= a || m < b
}

/** Readable text of a Feishu message (text / post); @-keys become names. */
export function messageText(m: any): string {
  let content: any = {}
  try { content = JSON.parse(m?.body?.content ?? '{}') } catch { /* not JSON */ }
  let text = ''
  if (m?.msg_type === 'text') text = String(content?.text ?? '')
  else if (m?.msg_type === 'post') {
    const post = content?.content ? content : content?.zh_cn ?? content?.en_us ?? Object.values(content)[0] ?? {}
    const lines: any[] = Array.isArray(post?.content) ? post.content : []
    text = [post?.title, ...lines.map(l => (Array.isArray(l) ? l : []).map((e: any) => e?.text ?? (e?.tag === 'at' ? `@${e?.user_name ?? ''}` : '')).join(''))]
      .filter(Boolean).join('\n')
  } else text = `[${m?.msg_type ?? 'message'}]`
  for (const at of Array.isArray(m?.mentions) ? m.mentions : []) {
    if (at?.key) text = text.split(at.key).join(`@${at.name ?? ''}`)
  }
  return text.trim()
}

export type LogKind = 'answer' | 'holding' | 'followup'
export interface LogEntry {
  /** The sent message's id (what recall deletes). */
  id: string
  time: number
  chatId: string
  chatName: string
  inReplyTo: string
  text: string
  kind: LogKind
  recalled?: boolean
}

interface Job {
  messageId: string
  chatId: string
  chatName: string
  p2p: boolean
  senderId: string
  text: string
  createTime: number
  dueAt: number
}
interface Followup { approvalId: string; createdAt: number; reminded: boolean }
interface AgentState {
  since: number
  chats: Record<string, { lastTime: number; lastId: string }>
  seen: string[]
  jobs: Job[]
  followups: Followup[]
  /** open_id → a label to pick people by (p2p chat name). */
  senders: Record<string, string>
}

export type Outcome =
  | { messageId: string; result: 'answered' | 'escalated' }
  | { messageId: string; result: 'skipped'; why: 'owner_took_over' | 'rate_limited' }
  | { messageId: string; result: 'failed'; error: string }

type Http = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, body?: unknown) => Promise<{ status: number; body: any }>

export interface FeishuAgentDeps {
  dir: string
  http: Http
  token: () => Promise<{ ok: boolean; token?: string; error?: string }>
  selfOpenId: () => string | null
  profile: () => ButlerProfile
  /** Runs `claude -p <prompt>` in the Butler folder; resolves with stdout. */
  runClaude: (prompt: string) => Promise<string>
  approvals: {
    add: (i: Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>) => Approval
    register: (kind: string, exec: (item: Approval) => Promise<{ ok: boolean; error?: string }>) => void
    get: (id: string) => Approval | undefined
  }
  notify: (title: string, body: string) => void
  /** Agents' status and latest progress, as text for the prompt. */
  context?: () => string
  /** The owner profile as the Butler session reads it (profile.md). */
  profileMd?: () => string
  now?: () => number
  onChange?: () => void
}

export const FOLLOWUP_KIND = 'feishu.followup'

const ok = (r: { status: number; body: any }) => r.status === 200 && r.body?.code === 0
const errOf = (r: { status: number; body: any }) => `feishu ${r.body?.code ?? r.status}: ${String(r.body?.msg ?? '').slice(0, 120)}`
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

export function createFeishuAgent(deps: FeishuAgentDeps) {
  const now = deps.now ?? Date.now
  const settingsFile = join(deps.dir, 'feishu-agent.json')
  const stateFile = join(deps.dir, 'feishu-agent-state.json')
  const logFile = join(deps.dir, 'feishu-log.jsonl')

  const readJson = (f: string) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
  const writeJson = (f: string, v: unknown) => {
    if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true })
    writeFileSync(f + '.tmp', JSON.stringify(v, null, 2))
    renameSync(f + '.tmp', f)
  }

  let settings = normalizeAgentSettings(readJson(settingsFile))
  const loadState = (): AgentState => {
    const j = readJson(stateFile) ?? {}
    return {
      since: typeof j.since === 'number' ? j.since : now(),
      chats: j.chats && typeof j.chats === 'object' ? j.chats : {},
      seen: Array.isArray(j.seen) ? j.seen.filter((x: unknown) => typeof x === 'string') : [],
      jobs: Array.isArray(j.jobs) ? j.jobs : [],
      followups: Array.isArray(j.followups) ? j.followups : [],
      senders: j.senders && typeof j.senders === 'object' ? j.senders : {}
    }
  }
  let state = loadState()
  let seen = new Set(state.seen)
  const saveState = () => { state.seen = Array.from(seen).slice(-SEEN_KEEP); seen = new Set(state.seen); writeJson(stateFile, state) }

  const readLog = (): LogEntry[] => {
    try {
      return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
    } catch { return [] }
  }
  const appendLog = (e: LogEntry) => {
    if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true })
    appendFileSync(logFile, JSON.stringify(e) + '\n')
    deps.onChange?.()
  }

  const prefix = () => effectivePrefix(settings, deps.profile())

  async function reply(token: string, job: Pick<Job, 'messageId' | 'chatId' | 'chatName'>, text: string, kind: LogKind) {
    const full = ensurePrefix(text, prefix())
    const r = await deps.http('POST', `${FEISHU_API}/im/v1/messages/${encodeURIComponent(job.messageId)}/reply`, token,
      { msg_type: 'text', content: JSON.stringify({ text: full }) })
    if (!ok(r)) return { ok: false as const, error: errOf(r) }
    const id = String(r.body?.data?.message_id ?? '')
    appendLog({ id, time: now(), chatId: job.chatId, chatName: job.chatName, inReplyTo: job.messageId, text: full, kind })
    return { ok: true as const, id }
  }

  deps.approvals.register(FOLLOWUP_KIND, async item => {
    const p = item.payload as { messageId?: string; chatId?: string; chatName?: string }
    if (typeof p.messageId !== 'string' || typeof p.chatId !== 'string') return { ok: false, error: 'bad_payload' }
    if (!item.draft.trim()) return { ok: false, error: 'empty_draft' }
    const tok = await deps.token()
    if (!tok.ok || !tok.token) return { ok: false, error: tok.error || 'signed_out' }
    const r = await reply(tok.token, { messageId: p.messageId, chatId: p.chatId, chatName: String(p.chatName ?? '') }, item.draft, 'followup')
    return r.ok ? { ok: true } : r
  })

  async function listChats(token: string) {
    const out: Array<{ id: string; name: string; p2p: boolean }> = []
    let pageToken = ''
    for (let i = 0; i < MAX_CHAT_PAGES; i++) {
      const q = new URLSearchParams({ page_size: '100' })
      if (pageToken) q.set('page_token', pageToken)
      const r = await deps.http('GET', `${FEISHU_API}/im/v1/chats?${q}`, token)
      if (!ok(r)) throw new Error(errOf(r))
      for (const c of r.body.data?.items ?? []) {
        if (typeof c?.chat_id !== 'string') continue
        out.push({ id: c.chat_id, name: String(c.name ?? ''), p2p: (c.chat_mode ?? c.chat_type) === 'p2p' })
      }
      if (!r.body.data?.has_more || !r.body.data?.page_token) break
      pageToken = r.body.data.page_token
    }
    return out
  }

  async function messagesSince(token: string, chatId: string, sinceMs: number) {
    const items: any[] = []
    let pageToken = ''
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({
        container_id_type: 'chat', container_id: chatId, start_time: String(Math.floor(sinceMs / 1000)),
        sort_type: 'ByCreateTimeAsc', page_size: '50'
      })
      if (pageToken) q.set('page_token', pageToken)
      const r = await deps.http('GET', `${FEISHU_API}/im/v1/messages?${q}`, token)
      if (!ok(r)) throw new Error(errOf(r))
      items.push(...(r.body.data?.items ?? []))
      if (!r.body.data?.has_more || !r.body.data?.page_token) break
      pageToken = r.body.data.page_token
    }
    return items
  }

  async function recentMessages(token: string, chatId: string, n: number) {
    const q = new URLSearchParams({ container_id_type: 'chat', container_id: chatId, sort_type: 'ByCreateTimeDesc', page_size: String(n) })
    const r = await deps.http('GET', `${FEISHU_API}/im/v1/messages?${q}`, token)
    if (!ok(r)) throw new Error(errOf(r))
    return ((r.body.data?.items ?? []) as any[]).slice().reverse()
  }

  async function poll(token: string, self: string) {
    const chats = await listChats(token)
    for (const chat of chats) {
      const cur = state.chats[chat.id] ?? { lastTime: state.since, lastId: '' }
      let items: any[]
      try { items = await messagesSince(token, chat.id, cur.lastTime) } catch { continue }
      for (const m of items) {
        const id = typeof m?.message_id === 'string' ? m.message_id : ''
        const ct = Number(m?.create_time)
        if (!id || !Number.isFinite(ct) || seen.has(id) || ct < cur.lastTime) continue
        seen.add(id)
        cur.lastTime = ct
        cur.lastId = id
        if (m.deleted) continue
        const sender = String(m?.sender?.id ?? '')
        if (sender === self || m?.sender?.sender_type !== 'user') continue
        const mentioned = Array.isArray(m.mentions) && m.mentions.some((x: any) => x?.id === self || x?.id?.open_id === self)
        if (!chat.p2p && !mentioned) continue
        if (chat.p2p && chat.name) state.senders[sender] = chat.name
        if (settings.scope === 'picked' && !settings.picked.includes(sender)) continue
        state.jobs.push({
          messageId: id, chatId: chat.id, chatName: chat.name, p2p: chat.p2p, senderId: sender,
          text: messageText(m), createTime: ct, dueAt: Math.max(ct + settings.waitBeforeReplyMs, now())
        })
      }
      state.chats[chat.id] = cur
    }
    saveState()
  }

  function buildPrompt(job: Job, history: any[], self: string): string {
    const p = deps.profile()
    const name = p.name || 'the owner'
    const lines = history.map(m => `${m?.sender?.id === self ? name : 'them'}: ${clip(messageText(m), 500)}`)
    const locked = [...LOCKED_TOPICS.map(t => t.id), ...settings.extraAskFirst].join(', ')
    return [
      `Use the answer-feishu skill (.claude/skills/answer-feishu/SKILL.md) to answer a Feishu message sent to ${name}.`,
      '',
      '## Owner profile',
      deps.profileMd?.() || `Name: ${name}`,
      '',
      '## Agents status (what the team is working on)',
      deps.context?.() || '(none)',
      '',
      `## Recent messages in ${job.p2p ? 'this direct chat' : `group "${job.chatName}"`}`,
      ...lines,
      '',
      '## Message to answer',
      job.text,
      '',
      `Escalate (do not answer) anything about: ${locked}, or anything you are not sure ${name} would say.`,
      'For escalate, put in "reply" the answer you suggest the owner sends after checking.',
      'Do not add any prefix. Reply ONLY with JSON: {"decision":"answer"|"escalate","reply":"…","reason":"…"}'
    ].join('\n')
  }

  function sentInLastHour(chatId: string) {
    const cutoff = now() - HOUR
    return readLog().filter(e => e.chatId === chatId && e.time > cutoff && (e.kind === 'answer' || e.kind === 'holding')).length
  }

  async function handle(token: string, self: string, job: Job): Promise<Outcome> {
    const ownSent = new Set(readLog().map(e => e.id))
    let history: any[] = []
    try { history = await recentMessages(token, job.chatId, 20) } catch (e) {
      return { messageId: job.messageId, result: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
    const tookOver = history.some(m => m?.sender?.id === self && Number(m?.create_time) > job.createTime && !ownSent.has(m?.message_id))
    if (tookOver) return { messageId: job.messageId, result: 'skipped', why: 'owner_took_over' }
    if (sentInLastHour(job.chatId) >= settings.maxRepliesPerChatPerHour) return { messageId: job.messageId, result: 'skipped', why: 'rate_limited' }

    let d: Decision
    try { d = parseDecision(await deps.runClaude(buildPrompt(job, history, self))) } catch (e) {
      d = { decision: 'escalate', reply: '', reason: `claude: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
    }
    const topic = lockedTopicHit(job.text, settings.extraAskFirst) ?? lockedTopicHit(d.reply, settings.extraAskFirst)
      ?? (d.decision === 'escalate' ? d.reason || 'unsure' : null)

    if (topic === null) {
      const r = await reply(token, job, d.reply, 'answer')
      return r.ok ? { messageId: job.messageId, result: 'answered' } : { messageId: job.messageId, result: 'failed', error: r.error }
    }
    const r = await reply(token, job, holdingReply(deps.profile().name), 'holding')
    if (!r.ok) return { messageId: job.messageId, result: 'failed', error: r.error }
    const item = deps.approvals.add({
      kind: FOLLOWUP_KIND,
      title: `${job.chatName || 'Feishu'} · ${clip(job.text.replace(/\s+/g, ' '), 40)}`,
      subtitle: `Feishu follow-up · ${clip(topic, 30)}`,
      draft: d.reply.startsWith(prefix()) ? d.reply.slice(prefix().length) : d.reply,
      payload: { messageId: job.messageId, chatId: job.chatId, chatName: job.chatName, question: job.text, topic },
      action: 'Reply'
    })
    state.followups.push({ approvalId: item.id, createdAt: now(), reminded: false })
    return { messageId: job.messageId, result: 'escalated' }
  }

  function remind() {
    let changed = false
    state.followups = state.followups.filter(f => {
      const item = deps.approvals.get(f.approvalId)
      if (!item || item.status !== 'pending') { changed = true; return false }
      if (!f.reminded && now() - f.createdAt >= settings.remindAfterMs) {
        deps.notify('Feishu · waiting for you', item.title)
        f.reminded = true
        changed = true
      }
      return true
    })
    if (changed) saveState()
  }

  let busy = false
  const outcomes: Outcome[] = []
  let lastError = ''

  async function tick(): Promise<Outcome[]> {
    if (busy) return []
    busy = true
    const done: Outcome[] = []
    try {
      remind()
      if (!settings.enabled) return done
      const self = deps.selfOpenId()
      if (!self) { lastError = 'signed_out'; return done }
      const tok = await deps.token()
      if (!tok.ok || !tok.token) { lastError = tok.error || 'signed_out'; return done }
      try { await poll(tok.token, self); lastError = '' } catch (e) { lastError = e instanceof Error ? e.message : String(e) }
      if (inQuietHours(settings.quietHours, new Date(now()))) return done
      const due = state.jobs.filter(j => j.dueAt <= now()).sort((a, b) => a.createTime - b.createTime)
      for (const job of due) {
        // Off the queue before anything is sent: a crash mid-send must not
        // answer the same message again on the next start.
        state.jobs = state.jobs.filter(j => j.messageId !== job.messageId)
        saveState()
        const o = await handle(tok.token, self, job)
        saveState()
        done.push(o)
      }
      outcomes.push(...done)
      outcomes.splice(0, Math.max(0, outcomes.length - 50))
      if (done.length) deps.onChange?.()
      return done
    } finally {
      busy = false
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  function start() {
    if (timer) return
    const loop = () => { timer = setTimeout(() => { void tick().finally(loop) }, settings.pollMs); (timer as any).unref?.() }
    loop()
  }
  function stop() { if (timer) clearTimeout(timer); timer = null }

  return {
    tick,
    start,
    stop,
    getSettings: () => ({ ...settings }),
    setSettings(patch: Partial<FeishuAgentSettings>): FeishuAgentSettings {
      const next = normalizeAgentSettings({ ...settings, ...patch })
      if (next.enabled && !settings.enabled) {
        // Start from now: what arrived while off is never answered.
        state.since = now()
        state.chats = {}
        state.jobs = []
      }
      if (!next.enabled) state.jobs = []
      settings = next
      writeJson(settingsFile, settings)
      saveState()
      deps.onChange?.()
      return { ...settings }
    },
    prefix,
    senders: () => ({ ...state.senders }),
    pendingJobs: () => state.jobs.map(j => ({ ...j })),
    outcomes: () => [...outcomes],
    lastError: () => lastError,
    log: (n = 20): LogEntry[] => readLog().slice(-n).reverse(),
    async recall(id: string): Promise<{ ok: boolean; error?: string }> {
      const all = readLog()
      const e = all.find(x => x.id === id)
      if (!e) return { ok: false, error: 'not_found' }
      if (e.recalled) return { ok: false, error: 'already_recalled' }
      if (now() - e.time > RECALL_WINDOW_MS) return { ok: false, error: 'too_old' }
      const tok = await deps.token()
      if (!tok.ok || !tok.token) return { ok: false, error: tok.error || 'signed_out' }
      const r = await deps.http('DELETE', `${FEISHU_API}/im/v1/messages/${encodeURIComponent(id)}`, tok.token)
      if (!ok(r)) return { ok: false, error: errOf(r) }
      e.recalled = true
      writeFileSync(logFile + '.tmp', all.map(x => JSON.stringify(x)).join('\n') + '\n')
      renameSync(logFile + '.tmp', logFile)
      deps.onChange?.()
      return { ok: true }
    }
  }
}

export type FeishuAgent = ReturnType<typeof createFeishuAgent>
