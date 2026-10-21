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
export interface Answer {
  category: Category
  level: Level
  confidence: 'high' | 'medium' | 'low'
  reply: string
  sources: string[]
  claims: Claim[]
}

export const CATEGORIES: Category[] = ['chitchat-work', 'chitchat-life', 'product-status', 'product-knowledge', 'report-help', 'new-request', 'need-info', 'meeting', 'cannot-answer']
const LEVELS: Level[] = ['auto', 'approve', 'hold']
const VERDICTS: Verdict[] = ['confirmed', 'contradicted', 'unverified']
const RANK: Record<Level, number> = { auto: 0, approve: 1, hold: 2 }

/** Jira keys of the projects a reply may name (PR is never quoted). */
const JIRA_KEY = /\b(?:FAE|P4|LFCS|OUTLET)-\d+\b/g
const PR_KEY = /\bPR-\d+\b/

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
  return { category, level, confidence, reply: str(j.reply, 2000), sources, claims }
}

export interface GateInput { answer: Answer | null; relation: Relation; calendarKnown?: boolean }
export interface GateResult {
  level: Level
  /** Why the level is lower than the model asked for (shown to the owner). */
  reasons: string[]
  /** The owner should hear about it even when it was sent. */
  notify: boolean
}

/** Decide what goes out. Only ever lowers the model's level. */
export function gateAnswer({ answer, relation, calendarKnown = false }: GateInput): GateResult {
  if (!answer) return { level: 'hold', reasons: ['unreadable answer'], notify: true }
  let level: Level = answer.level
  const reasons: string[] = []
  const lower = (to: Level, why: string) => { if (RANK[to] > RANK[level]) level = to; reasons.push(why) }
  let notify = false

  if (!answer.reply) lower('hold', 'empty reply')
  if (PR_KEY.test(answer.reply)) lower('hold', 'mentions a PR task')
  const cited = new Set(answer.sources.join(' ').match(JIRA_KEY) ?? [])
  const named = answer.reply.match(JIRA_KEY) ?? []
  const unchecked = named.filter(k => !cited.has(k))
  if (unchecked.length) lower('hold', `names ${unchecked.join(', ')} without looking it up`)
  for (const c of answer.claims) {
    if (c.verdict === 'confirmed' && !c.source) lower('approve', `"${c.claim.slice(0, 40)}" confirmed without a source`)
    if (c.verdict === 'contradicted') lower('approve', `corrects "${c.claim.slice(0, 40)}"`)
    if (c.verdict === 'unverified') notify = true
  }
  if (answer.confidence === 'low') lower('hold', 'low confidence')
  else if (answer.confidence === 'medium') lower('approve', 'medium confidence')
  if (answer.category === 'cannot-answer') lower('hold', 'cannot answer')
  if (answer.category === 'new-request') notify = true
  // Without the owner's calendar a meeting answer would be a guess.
  if (answer.category === 'meeting' && !calendarKnown) lower('hold', 'calendar not available')
  if (relation === 'boss') lower('hold', 'from your manager')
  if (level !== 'auto') notify = true
  return { level, reasons, notify }
}

export const RELATION_LABEL: Record<Relation, string> = {
  boss: "the owner's manager", report: 'reports to the owner', peer: "a colleague in the owner's department",
  requester: 'from another department (a requester)', unknown: 'relationship unknown'
}

/** Sent while the owner decides: says who is answering and that the owner will follow up. */
export function assistantHolding(ownerName: string): string {
  const n = ownerName.trim() || '主人'
  return `我是 ${n} 的助理，可能不太了解上下文，判断和回答不一定准确，我会转给 ${n} 处理。`
}

// ── Who is the sender to the owner (Feishu contacts) ─────────────────────

export interface Person { openId: string; leader: string; departments: string[] }

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
      if (u) p = { openId, leader: typeof u.leader_user_id === 'string' ? u.leader_user_id : '', departments: Array.isArray(u.department_ids) ? u.department_ids.filter((d: unknown) => typeof d === 'string') : [] }
    } catch { p = null }
    cache.set(openId, { p, at: now() })
    return p
  }
  return async (senderId: string): Promise<Relation> => {
    const self = deps.selfOpenId()
    const token = await deps.token()
    if (!self || !token) return 'unknown'
    const [owner, sender] = await Promise.all([person(self, token), person(senderId, token)])
    return owner && sender ? relationOf(owner, sender) : 'unknown'
  }
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
