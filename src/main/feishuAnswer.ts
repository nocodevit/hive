import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// answer-feishu v2: what the model returns and the code-side gate that decides
// what is actually sent. The model classifies and drafts; this file never
// trusts it — PR content, unchecked Jira keys, a reply to the owner's boss, low
// confidence or a contradicted claim all lower the level before anything goes out.

export type Relation = 'boss' | 'report' | 'peer' | 'requester' | 'unknown'
export type Category =
  | 'chitchat-work' | 'chitchat-life' | 'product-status' | 'product-knowledge' | 'report-help'
  | 'new-request' | 'need-info' | 'meeting' | 'cannot-answer'
export type Level = 'auto' | 'approve' | 'hold'
export type Verdict = 'confirmed' | 'contradicted' | 'unverified'

export interface Claim { claim: string; verdict: Verdict; source: string }
/** An action the reply asks the sender to agree to; a later "ok" from them consents to exactly this. */
export interface Proposal {
  type: 'create_meeting' | 'notify' | 'forward_owner'
  summary: string
  /** create_meeting: local "YYYY-MM-DDTHH:MM" start / end and a title. */
  start?: string
  end?: string
  title?: string
}

/** A meeting Butler may create on its own: well-formed, ahead, 15 min – 3 h, within the
 *  next two weeks, on a working day between 09:00 and 19:00. Anything else → the owner. */
export function meetingSlot(p: Proposal, at: number): { start: number; end: number; title: string } | null {
  if (p.type !== 'create_meeting' || !p.start || !p.end) return null
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  if (!re.test(p.start) || !re.test(p.end)) return null
  const start = new Date(`${p.start}:00`).getTime()
  const end = new Date(`${p.end}:00`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  const min = (end - start) / 60_000
  const d = new Date(start)
  const h = d.getHours() + d.getMinutes() / 60
  const he = new Date(end).getHours() + new Date(end).getMinutes() / 60
  if (start <= at || start - at > 14 * 24 * 3600_000 || min < 15 || min > 180) return null
  if (d.getDay() === 0 || d.getDay() === 6 || h < 9 || he > 19 || new Date(end).toDateString() !== d.toDateString()) return null
  return { start, end, title: (p.title || p.summary).slice(0, 100) }
}
export interface Answer {
  category: Category
  level: Level
  confidence: 'high' | 'medium' | 'low'
  reply: string
  sources: string[]
  claims: Claim[]
  proposal?: Proposal
  /** Tickets whose status is wrong by what was verified; the owner approves each change. */
  jiraFixes: Array<{ key: string; to: string; why: string }>
  /** The one judgment that is the owner's ("escalate or not?"): the checked facts go out, this goes to the owner. */
  ownerQuestion?: string
}

/** "ok", "好的", "收到", 👍, a sticker … — an acknowledgement, nothing to answer. */
export function isAck(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t || /[?？]/.test(t)) return false
  if (/^\[(sticker|表情)\]$/.test(t)) return true
  if (/^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s)+$/u.test(t)) return true
  const w = t.replace(/[\s!！。.,，、~～…:：;；]+/gu, '')
  return /^(ok|okay|okk|k|好|好的|好滴|好嘞|好哒|行|可以|没问题|收到|收到了|嗯|嗯嗯|嗯呢|明白|明白了|了解|知道了|谢谢|谢了|多谢|感谢|thx|thanks|thank you|ty|got it|noted|sure|cool|great|好的谢谢|ok谢谢|收到谢谢|好的收到|thankyou|gotit)$/.test(w)
}

export const CATEGORIES: Category[] = ['chitchat-work', 'chitchat-life', 'product-status', 'product-knowledge', 'report-help', 'new-request', 'need-info', 'meeting', 'cannot-answer']
const LEVELS: Level[] = ['auto', 'approve', 'hold']
const VERDICTS: Verdict[] = ['confirmed', 'contradicted', 'unverified']
const RANK: Record<Level, number> = { auto: 0, approve: 1, hold: 2 }

/** Any Jira-style key ("ABC-123"). Which projects are never quoted comes from the owner's jira-config. */
const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** The model's JSON, or null when it is not usable (→ hold). */
export function parseAnswer(output: string): Answer | null {
  const a = output.indexOf('{')
  const b = output.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  let j: any
  try { j = JSON.parse(output.slice(a, b + 1)) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const category = CATEGORIES.includes(j.category) ? j.category as Category : 'cannot-answer'
  const level = LEVELS.includes(j.level) ? j.level as Level : 'hold'
  const confidence = j.confidence === 'high' || j.confidence === 'medium' ? j.confidence : 'low'
  const sources = Array.isArray(j.sources) ? j.sources.map((s: unknown) => str(s, 300)).filter(Boolean).slice(0, 20) : []
  const claims: Claim[] = Array.isArray(j.claims) ? j.claims.slice(0, 10).map((c: any) => ({
    claim: str(c?.claim, 300), verdict: VERDICTS.includes(c?.verdict) ? c.verdict : 'unverified', source: str(c?.source, 300)
  })).filter((c: Claim) => c.claim) : []
  const pt = j.proposal?.type
  const proposal: Proposal | undefined = (pt === 'create_meeting' || pt === 'notify' || pt === 'forward_owner') && str(j.proposal?.summary, 300)
    ? {
        type: pt as Proposal['type'], summary: str(j.proposal.summary, 300),
        ...(str(j.proposal.start, 16) ? { start: str(j.proposal.start, 16) } : {}),
        ...(str(j.proposal.end, 16) ? { end: str(j.proposal.end, 16) } : {}),
        ...(str(j.proposal.title, 100) ? { title: str(j.proposal.title, 100) } : {})
      } : undefined
  const jiraFixes = (Array.isArray(j.jira_fixes) ? j.jira_fixes : []).slice(0, 5)
    .map((f: any) => ({ key: str(f?.key, 20), to: str(f?.to, 40), why: str(f?.why, 200) }))
    .filter((f: { key: string; to: string; why: string }) => /^[A-Z][A-Z0-9]+-\d+$/.test(f.key) && f.to && f.why)
  const ownerQuestion = str(j.owner_question, 300)
  return { category, level, confidence, reply: str(j.reply, 2000), sources, claims, jiraFixes, ...(proposal ? { proposal } : {}), ...(ownerQuestion ? { ownerQuestion } : {}) }
}

export interface GateInput { answer: Answer | null; relation: Relation; calendarKnown?: boolean; /** Projects whose keys never go out (engineering tasks). */ neverQuote?: string[] }
export interface GateResult {
  level: Level
  /** Why the level is lower than the model asked for (shown to the owner). */
  reasons: string[]
  /** The owner should hear about it even when it was sent. */
  notify: boolean
  /** Facts go out now; answer.ownerQuestion goes to the owner as a card. */
  split?: boolean
}

/** Decide what goes out. Only ever lowers the model's level. */
/** A reply that hands the question to the owner ("已转给 Megan", "will get back to you") is a promise:
 *  only the hold path keeps it, by putting a card in front of the owner. */
export const DEFERS_TO_OWNER = /转给|转交|反馈给|已告知|会告诉|看过后|确认后|稍后回复|回头回复|晚点回复|pass(?:ed)? (?:it |this )?(?:on )?to|forward(?:ed)? (?:it |this )?to|get back to you|will (?:reply|respond|follow up)/i

export function gateAnswer({ answer, relation, calendarKnown = false, neverQuote = [] }: GateInput): GateResult {
  if (!answer) return { level: 'hold', reasons: ['unreadable answer'], notify: true }
  let level: Level = answer.level
  const reasons: string[] = []
  const lower = (to: Level, why: string) => { if (RANK[to] > RANK[level]) level = to; reasons.push(why) }
  let notify = false

  if (!answer.reply) lower('hold', 'empty reply')
  const hidden = (answer.reply.match(JIRA_KEY) ?? []).filter(k => neverQuote.includes(k.split('-')[0]))
  if (hidden.length) lower('hold', `mentions ${hidden[0].split('-')[0]} (never quoted)`)
  const cited = new Set(answer.sources.join(' ').match(JIRA_KEY) ?? [])
  const named = answer.reply.match(JIRA_KEY) ?? []
  const unchecked = named.filter(k => !cited.has(k))
  if (unchecked.length) lower('hold', `names ${unchecked.join(', ')} without looking it up`)
  for (const c of answer.claims) {
    if (c.verdict === 'confirmed' && !c.source) lower('approve', `"${c.claim.slice(0, 40)}" confirmed without a source`)
    if (c.verdict === 'contradicted') lower('approve', `corrects "${c.claim.slice(0, 40)}"`)
    if (c.verdict === 'unverified') notify = true
  }
  // Every fact checked against a source, only a judgment left for the owner: send the facts, card the judgment.
  const factsChecked = answer.claims.length > 0 && answer.claims.every(c => c.verdict === 'confirmed' && !!c.source)
  const split = !!answer.ownerQuestion && !!answer.reply && factsChecked && level !== 'hold' && answer.confidence !== 'low' &&
    relation !== 'boss' && answer.category !== 'meeting' && answer.category !== 'cannot-answer' && !hidden.length && !unchecked.length
  if (split) return { level: 'auto', reasons: [`yours: ${answer.ownerQuestion}`], notify: true, split: true }
  const chitchat = answer.category === 'chitchat-work' || answer.category === 'chitchat-life'
  // Small talk with nothing checkable in it never waits for the owner over "medium".
  const plainChat = chitchat && !answer.claims.length && !answer.sources.length && !named.length
  if (answer.confidence === 'low') lower('hold', 'low confidence')
  else if (answer.confidence === 'medium' && !plainChat) lower('approve', 'medium confidence')
  if (answer.category === 'cannot-answer') lower('hold', 'cannot answer')
  if (answer.category === 'new-request') notify = true
  // Without the owner's calendar a meeting answer would be a guess.
  if (answer.category === 'meeting' && !calendarKnown) lower('hold', 'calendar not available')
  if (relation === 'boss') lower('hold', 'from your manager')
  // An offer waiting for their yes (a proposal) is not a promise yet.
  if (!answer.proposal && DEFERS_TO_OWNER.test(answer.reply)) lower('hold', 'reply hands it to you')
  if (level !== 'auto') notify = true
  return { level, reasons, notify }
}

export const RELATION_LABEL: Record<Relation, string> = {
  boss: "the owner's manager", report: 'reports to the owner', peer: "a colleague in the owner's department",
  requester: 'from another department (a requester)', unknown: 'relationship unknown'
}

// ── Who is the sender to the owner (Feishu contacts) ─────────────────────

export interface Person { openId: string; name: string; leader: string; departments: string[] }

/** Manager / report / same department / anyone else. */
export function relationOf(owner: Person, sender: Person): Relation {
  if (!owner.openId || !sender.openId) return 'unknown'
  if (owner.leader && owner.leader === sender.openId) return 'boss'
  if (sender.leader && sender.leader === owner.openId) return 'report'
  if (sender.departments.some(d => owner.departments.includes(d))) return 'peer'
  return 'requester'
}

type Get = (url: string, token: string) => Promise<{ status: number; body: any }>
const CONTACT = 'https://open.feishu.cn/open-apis/contact/v3/users'
const DAY_MS = 24 * 3600_000

/** Reads both people from Feishu contacts (cached a day). Any failure → 'unknown':
 *  without the contact scope the owner is simply treated as not knowing the sender. */
export function createRelationLookup(deps: { get: Get; token: () => Promise<string | null>; selfOpenId: () => string | null; now?: () => number }) {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { p: Person | null; at: number }>()
  async function person(openId: string, token: string): Promise<Person | null> {
    const hit = cache.get(openId)
    if (hit && now() - hit.at < DAY_MS) return hit.p
    let p: Person | null = null
    try {
      const r = await deps.get(`${CONTACT}/${encodeURIComponent(openId)}?user_id_type=open_id&department_id_type=open_department_id`, token)
      const u = r.status === 200 && r.body?.code === 0 ? r.body.data?.user : null
      if (u) p = { openId, name: typeof u.name === 'string' ? u.name : '', leader: typeof u.leader_user_id === 'string' ? u.leader_user_id : '', departments: Array.isArray(u.department_ids) ? u.department_ids.filter((d: unknown) => typeof d === 'string') : [] }
    } catch { p = null }
    cache.set(openId, { p, at: now() })
    return p
  }
  const relation = async (senderId: string): Promise<Relation> => {
    const self = deps.selfOpenId()
    const token = await deps.token()
    if (!self || !token) return 'unknown'
    const [owner, sender] = await Promise.all([person(self, token), person(senderId, token)])
    return owner && sender ? relationOf(owner, sender) : 'unknown'
  }
  /** The sender's display name ('' when contacts cannot be read). */
  const nameOf = async (openId: string): Promise<string> => {
    const token = await deps.token()
    return token ? (await person(openId, token))?.name ?? '' : ''
  }
  return Object.assign(relation, { nameOf })
}

// ── The owner's free / busy (meeting requests) ───────────────────────────

export interface AgendaLike { date: string; events: Array<{ start: number; end: number; allDay: boolean }>; errors: { feishu?: string; mac?: string } }
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** The next n working days (Mon–Fri) from `from`, today included. */
export function workingDays(from: Date, n: number): Date[] {
  const out: Date[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12)
  while (out.length < n) { if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d)); d.setDate(d.getDate() + 1) }
  return out
}

/** Busy blocks only — never a title. Unknown when no calendar is on or a source failed. */
export function freeBusyText(days: AgendaLike[], sourcesOn: boolean): { known: boolean; text: string } {
  if (!sourcesOn || !days.length || days.some(d => d.errors.feishu || d.errors.mac)) return { known: false, text: '' }
  const lines = days.map(d => {
    const day = new Date(`${d.date}T12:00:00`)
    const label = `${WEEKDAY[day.getDay()]} ${day.getMonth() + 1}/${day.getDate()}`
    if (d.events.some(e => e.allDay)) return `${label}: busy all day`
    const blocks = d.events.filter(e => !e.allDay).sort((a, b) => a.start - b.start).map(e => `${hhmm(e.start)}–${hhmm(e.end)}`)
    return `${label}: ${blocks.length ? `busy ${blocks.join(', ')}` : 'free'}`
  })
  return { known: true, text: lines.join('\n') }
}

export function meetingCreatedReply(m: { start: number; end: number; title: string }, link: string, reminder: number): string {
  const d = new Date(m.start)
  const hm = (x: number) => { const t = new Date(x); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
  return `好的，会议已创建：${m.title}，${d.getMonth() + 1}/${d.getDate()} ${hm(m.start)}–${hm(m.end)}，已设 ${reminder} 分钟提醒。${link ? ` ${link}` : ''}`
}

// ── The owner's own people list (when contacts cannot be read) ───────────

const RELATIONS: Relation[] = ['boss', 'report', 'peer', 'requester']
/** <butler>/feishu-people.json: open_id → relation, set by the owner (exact ids, no name matching). */
export function readPeople(folder: string): Record<string, Relation> {
  try {
    const j = JSON.parse(readFileSync(join(folder, 'feishu-people.json'), 'utf8'))
    const out: Record<string, Relation> = {}
    for (const [k, v] of Object.entries(j ?? {})) if (/^ou_/.test(k) && RELATIONS.includes(v as Relation)) out[k] = v as Relation
    return out
  } catch { return {} }
}
export function setPerson(folder: string, openId: string, relation: Relation | 'unknown'): Record<string, Relation> {
  const all = readPeople(folder)
  if (!/^ou_/.test(openId)) return all
  if (relation === 'unknown' || !RELATIONS.includes(relation)) delete all[openId]
  else all[openId] = relation
  writeFileSync(join(folder, 'feishu-people.json'), JSON.stringify(all, null, 2) + '\n')
  return all
}
