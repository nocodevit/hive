// Butler "About me" + Skills settings: types from main/butlerSkills.ts and
// the pure bits the UI needs.

export type SkillTone = 'formal' | 'direct' | 'friendly'
export interface SkillOverlay { tone?: SkillTone; maxLength?: string; language?: string; extraAskFirst?: string[]; extra?: string }
export interface LintProblem { rule: string; message: string }
export interface DiffLine { op: ' ' | '+' | '-'; text: string }
export interface SkillInfo {
  id: string
  name: string
  description: string
  customized: 'none' | 'form' | 'override'
  defaultUpdated: boolean
  overrideProblems: LintProblem[]
}
export interface SkillDetail extends SkillInfo {
  defaultMd: string
  effective: string
  override: string | null
  overlay: SkillOverlay
  locked: string[]
  path: string
}
export interface EditProposal {
  ok: boolean
  error?: string
  md?: string
  example?: string
  chips?: string[]
  diff?: DiffLine[]
  problems?: LintProblem[]
}
export type IpcError = { ok: false; error: string }

export const isIpcError = (v: unknown): v is IpcError =>
  !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false && typeof (v as { error?: unknown }).error === 'string' && !('problems' in (v as object))

export const TONE_OPTS: ReadonlyArray<[SkillTone, string]> = [['formal', 'Formal'], ['direct', 'Direct'], ['friendly', 'Friendly']]

const META: Record<string, { icon: string; label: string; sample: string }> = {
  'morning-plan': { icon: '🌅', label: 'Morning plan', sample: 'Today, 9:00' },
  'evening-report': { icon: '🌙', label: 'Evening report', sample: 'Today, 18:30' },
  'sort-inbox': { icon: '📥', label: 'Sort inbox', sample: 'Lin (customer): dashboard shows no data\nPMO: sprint notes\nNewsletter: AI weekly' },
  'reply-email': { icon: '✉️', label: 'Reply email', sample: 'From Lin: "The dashboard shows no data since this morning."\nOwner: fixed' },
  'answer-feishu': { icon: '💬', label: 'Answer Feishu', sample: 'Ben: checkout 什么时候好？' },
  'jira-check': { icon: '🎫', label: 'Jira check', sample: 'CUBE-812 blocked, SPH-77 no update 8 days' }
}

export function skillMeta(id: string): { icon: string; label: string; sample: string } {
  return META[id] ?? { icon: '📝', label: id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()), sample: '' }
}

/** "🔒 dates — any date…" → "dates" */
export function chipLabel(line: string): string {
  return line.replace(/^-\s*/, '').replace(/^🔒\s*/u, '').split(/\s+—\s+/)[0].trim()
}

/** Overlay to save: blanks dropped, chips de-duplicated, locked labels never stored as user chips. */
export function cleanOverlay(o: SkillOverlay, locked: string[] = []): SkillOverlay {
  const out: SkillOverlay = {}
  if (o.tone) out.tone = o.tone
  for (const k of ['maxLength', 'language', 'extra'] as const) {
    const v = (o[k] ?? '').trim()
    if (v) out[k] = v
  }
  const lockedLabels = new Set(locked.map(chipLabel))
  const chips = [...new Set((o.extraAskFirst ?? []).map(s => s.trim()).filter(s => s && !lockedLabels.has(s)))]
  if (chips.length) out.extraAskFirst = chips
  return out
}

export function sameOverlay(a: SkillOverlay, b: SkillOverlay): boolean {
  return JSON.stringify(cleanOverlay(a)) === JSON.stringify(cleanOverlay(b))
}

/** The diff with long unchanged runs folded, for the collapsed "Diff" view. */
export function foldDiff(diff: DiffLine[], context = 1): Array<DiffLine | { op: '…'; text: string }> {
  const keep = diff.map((l, i) => l.op !== ' ' || diff.slice(Math.max(0, i - context), i + context + 1).some(x => x.op !== ' '))
  const out: Array<DiffLine | { op: '…'; text: string }> = []
  diff.forEach((l, i) => {
    if (keep[i]) out.push(l)
    else if (out.length === 0 || out[out.length - 1].op !== '…') out.push({ op: '…', text: '' })
  })
  return out
}

// ── About me ──────────────────────────────────────────────────────────

export const PROFILE_KEYS = ['assistantName', 'name', 'role', 'team', 'responsibleFor', 'worksWith', 'style', 'oftenSays', 'neverSays', 'language', 'answerLike', 'whenUnsure', 'prefix', 'intro'] as const
export type ProfileKey = (typeof PROFILE_KEYS)[number]
export type Profile = Record<ProfileKey, string>

export const PROFILE_FRONT: ReadonlyArray<[ProfileKey, string, string]> = [
  ['role', 'Role', '产品负责人'],
  ['responsibleFor', 'Responsible for', 'Cube v2、需求排期'],
  ['answerLike', 'Answer like a', '资深 IoT 产品经理'],
  ['whenUnsure', 'When unsure', '说“我去确认”，转给我']
]
export const PROFILE_MORE: ReadonlyArray<[ProfileKey, string, string]> = [
  ['name', 'Name', 'Mei Yang'],
  ['team', 'Team', 'IoT 平台'],
  ['worksWith', 'Works with', 'Ben、PMO'],
  ['oftenSays', 'Often says', '先说结论'],
  ['neverSays', 'Never says', '您好、亲'],
  ['language', 'Language', '跟对方'],
  ['prefix', 'Prefix', '【Mei 的 AI 代理】'],
  ['intro', 'Intro', '我是 Mei 的 AI 代理']
]

export function toProfile(raw: Record<string, unknown> | null | undefined): Profile {
  const out = {} as Profile
  for (const k of PROFILE_KEYS) out[k] = typeof raw?.[k] === 'string' ? (raw[k] as string) : ''
  if (!['direct', 'warm', 'formal'].includes(out.style)) out.style = 'direct'
  return out
}

export function sameProfile(a: Profile, b: Profile): boolean {
  return PROFILE_KEYS.every(k => a[k].trim() === b[k].trim())
}
