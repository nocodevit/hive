// Butler skills: one markdown file per task (reply-email, answer-feishu, …).
//
// Layers, per skill id:
//   default  resources/butler/skills/<id>.md      shipped, replaced on upgrade
//   overlay  <butler>/skills/<id>.json            the simple form (tone, length, …)
//   override <butler>/skills/<id>.md              full markdown ("Advanced")
// Effective = override (when it passes lint) else default + overlay.
// At session start the effective skills are written to
// <butler>/.claude/skills/<id>/SKILL.md, where Claude Code finds them.
// Hive never writes <butler>/skills/<id>.{md,json} except when the owner
// saves, and deletes them only on Reset.
//
// Guide for writing a skill: docs/butler-skills.md.

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const SKILL_ID_RE = /^[a-z][a-z0-9-]{0,31}$/
export const SECTIONS = ['Purpose', 'Input', 'Rules', 'Ask me first', 'Tone and format', 'Examples', 'Output'] as const
export type SectionName = (typeof SECTIONS)[number]
export const LOCKED_SECTIONS: readonly SectionName[] = ['Input', 'Output']
export const TONES = ['formal', 'direct', 'friendly'] as const
export type SkillTone = (typeof TONES)[number]
const LOCK = '🔒'

const TONE_TEXT: Record<SkillTone, string> = {
  formal: 'Formal — polite, complete sentences, professional wording.',
  direct: 'Direct — conclusion first, short sentences, no pleasantries.',
  friendly: 'Friendly — casual and warm, still short.'
}

export interface SkillOverlay {
  tone?: SkillTone
  maxLength?: string
  language?: string
  extraAskFirst?: string[]
  extra?: string
}

export interface ParsedSkill {
  name: string
  description: string
  /** 'reference': facts other skills read (no tone form, free sections after ## Purpose). */
  kind: 'task' | 'reference'
  sections: Array<{ title: string; body: string }>
}

export function isSkillId(id: unknown): id is string {
  return typeof id === 'string' && SKILL_ID_RE.test(id)
}

const norm = (s: string) => s.replace(/\r\n?/g, '\n')

export function parseSkill(md: string): ParsedSkill {
  const text = norm(md)
  let name = ''
  let description = ''
  let kind: ParsedSkill['kind'] = 'task'
  let rest = text
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/)
      if (!m) continue
      if (m[1] === 'name') name = m[2].trim()
      if (m[1] === 'description') description = m[2].trim()
      if (m[1] === 'kind' && m[2].trim() === 'reference') kind = 'reference'
    }
    rest = text.slice(fm[0].length)
  }
  const sections: ParsedSkill['sections'] = []
  let cur: { title: string; lines: string[] } | null = null
  for (const line of rest.split('\n')) {
    const h = line.match(/^## (.+?)\s*$/)
    if (h) {
      if (cur) sections.push({ title: cur.title, body: cur.lines.join('\n').trim() })
      cur = { title: h[1], lines: [] }
    } else if (cur) cur.lines.push(line)
  }
  if (cur) sections.push({ title: cur.title, body: cur.lines.join('\n').trim() })
  return { name, description, kind, sections }
}

export function renderSkill(p: ParsedSkill): string {
  const head = `---\nname: ${p.name}\ndescription: ${p.description}\n${p.kind === 'reference' ? 'kind: reference\n' : ''}---\n`
  return head + p.sections.map(s => `\n## ${s.title}\n\n${s.body}\n`).join('')
}

const section = (p: ParsedSkill, t: SectionName) => p.sections.find(s => s.title === t)

/** The 🔒 lines of "Ask me first", trimmed. */
export function lockedLines(md: string): string[] {
  const body = section(parseSkill(md), 'Ask me first')?.body ?? ''
  return body.split('\n').map(l => l.trim()).filter(l => l.startsWith(`- ${LOCK}`))
}

export function normalizeOverlay(raw: unknown): SkillOverlay {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: SkillOverlay = {}
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  if ((TONES as readonly unknown[]).includes(src.tone)) out.tone = src.tone as SkillTone
  const maxLength = str(src.maxLength, 80)
  if (maxLength) out.maxLength = maxLength
  const language = str(src.language, 80)
  if (language) out.language = language
  if (Array.isArray(src.extraAskFirst)) {
    const items = Array.from(new Set(src.extraAskFirst.map(v => str(v, 120).replace(new RegExp(`^${LOCK}\\s*`, 'u'), '')).filter(Boolean)))
    if (items.length) out.extraAskFirst = items.slice(0, 20)
  }
  const extra = typeof src.extra === 'string' ? src.extra.trim().slice(0, 2000) : ''
  if (extra) out.extra = extra
  return out
}

const isEmptyOverlay = (o: SkillOverlay) => Object.keys(o).length === 0

/** The default with the simple-form choices added to their sections. */
export function applyOverlay(defaultMd: string, overlay: SkillOverlay): string {
  if (isEmptyOverlay(overlay)) return norm(defaultMd)
  const p = parseSkill(defaultMd)
  const add = (t: SectionName, lines: string[]) => {
    const s = section(p, t)
    if (s && lines.length) s.body = [s.body, ...lines].filter(Boolean).join('\n')
  }
  if (overlay.extra) add('Rules', overlay.extra.split('\n').map(l => l.trim()).filter(Boolean).map(l => (l.startsWith('- ') ? l : `- ${l}`)))
  if (overlay.extraAskFirst?.length) {
    const have = new Set((section(p, 'Ask me first')?.body ?? '').split('\n').map(l => l.trim()))
    add('Ask me first', overlay.extraAskFirst.map(x => `- ${x}`).filter(l => !have.has(l)))
  }
  const tone: string[] = []
  if (overlay.tone) tone.push(`- Tone (owner's choice, wins over the lines above): ${TONE_TEXT[overlay.tone]}`)
  if (overlay.maxLength) tone.push(`- Max length: ${overlay.maxLength}.`)
  if (overlay.language) tone.push(`- Language: ${overlay.language}.`)
  add('Tone and format', tone)
  return renderSkill(p)
}

export interface LintProblem {
  rule: 'frontmatter' | 'name' | 'sections' | 'locked-section' | 'locked-line'
  message: string
}

/** Checks an override against its default before it is saved (and before it is used). */
export function lintSkill(id: string, md: string, defaultMd: string): LintProblem[] {
  const problems: LintProblem[] = []
  const p = parseSkill(md)
  const d = parseSkill(defaultMd)
  if (!/^---\n[\s\S]*?\n---/.test(norm(md))) problems.push({ rule: 'frontmatter', message: 'Missing frontmatter (--- name / description ---)' })
  else if (!p.description) problems.push({ rule: 'frontmatter', message: 'Frontmatter: description is empty' })
  if (p.name !== id) problems.push({ rule: 'name', message: `Frontmatter name must be "${id}" (is "${p.name}")` })
  const titles = p.sections.map(s => s.title)
  if (d.kind === 'reference') {
    if (p.kind !== 'reference') problems.push({ rule: 'frontmatter', message: 'Frontmatter: keep "kind: reference"' })
    if (titles[0] !== 'Purpose') problems.push({ rule: 'sections', message: 'A reference starts with ## Purpose' })
    if (new Set(titles).size !== titles.length) problems.push({ rule: 'sections', message: 'A section appears twice' })
    return problems
  }
  for (const t of SECTIONS) if (!titles.includes(t)) problems.push({ rule: 'sections', message: `Missing section: ## ${t}` })
  for (const t of titles) if (!(SECTIONS as readonly string[]).includes(t)) problems.push({ rule: 'sections', message: `Unknown section: ## ${t}` })
  const known = titles.filter(t => (SECTIONS as readonly string[]).includes(t))
  const expected = SECTIONS.filter(t => known.includes(t))
  if (known.length === expected.length && known.some((t, i) => t !== expected[i])) {
    problems.push({ rule: 'sections', message: `Sections out of order: ${SECTIONS.join(' → ')}` })
  }
  if (new Set(known).size !== known.length) problems.push({ rule: 'sections', message: 'A section appears twice' })
  for (const t of LOCKED_SECTIONS) {
    const mine = section(p, t)
    const def = section(d, t)
    if (mine && def && mine.body.trim() !== def.body.trim()) problems.push({ rule: 'locked-section', message: `## ${t} is locked: keep it as shipped` })
  }
  const askFirst = new Set((section(p, 'Ask me first')?.body ?? '').split('\n').map(l => l.trim()))
  for (const l of lockedLines(defaultMd)) if (!askFirst.has(l)) problems.push({ rule: 'locked-line', message: `Locked line removed: ${l.slice(2)}` })
  return problems
}

export type DiffLine = { op: ' ' | '+' | '-'; text: string }

/** Line diff (LCS). Skills are short, O(n·m) is fine. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = norm(a).split('\n')
  const y = norm(b).split('\n')
  const n = x.length
  const m = y.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i] }); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: x[i++] })
    else out.push({ op: '+', text: y[j++] })
  }
  while (i < n) out.push({ op: '-', text: x[i++] })
  while (j < m) out.push({ op: '+', text: y[j++] })
  return out
}

const SHORT: Record<string, string> = { 'Tone and format': 'Tone', 'Ask me first': 'Ask first' }
const clip = (s: string, n = 36) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** A few short labels for what changed, by section: "Tone ＋ casual, no 您好". */
export function changeChips(before: string, after: string, max = 4): string[] {
  const a = parseSkill(before)
  const b = parseSkill(after)
  const chips: string[] = []
  if (a.description !== b.description) chips.push('Description')
  const titles = Array.from(new Set([...a.sections.map(s => s.title), ...b.sections.map(s => s.title)]))
  for (const t of titles) {
    const sa = a.sections.find(s => s.title === t)?.body ?? ''
    const sb = b.sections.find(s => s.title === t)?.body ?? ''
    if (sa === sb) continue
    const label = SHORT[t] ?? t
    const d = lineDiff(sa, sb).filter(l => l.op !== ' ' && l.text.trim())
    const clean = (s: string) => s.trim().replace(/^[-*>]\s*|^\d+\.\s*/, '')
    const added = d.filter(l => l.op === '+')
    const removed = d.filter(l => l.op === '-')
    if (added.length) chips.push(`${label} ＋ ${clip(clean(added[0].text))}`)
    else if (removed.length) chips.push(`${label} − ${clip(clean(removed[0].text))}`)
  }
  if (chips.length > max) return [...chips.slice(0, max - 1), `+${chips.length - max + 1} more`]
  return chips
}

export const hashText = (s: string) => createHash('sha256').update(norm(s)).digest('hex').slice(0, 16)

// ── Files ──────────────────────────────────────────────────────────────

export type Runner = (prompt: string) => Promise<string>

export interface SkillStore {
  /** resources/butler/skills */
  defaultsDir: string
  /** The Butler folder (~/.hive/butler). */
  butlerDir: string
}

const userDir = (s: SkillStore) => join(s.butlerDir, 'skills')
const metaPath = (s: SkillStore) => join(userDir(s), '.meta.json')
export const overridePath = (s: SkillStore, id: string) => join(userDir(s), `${id}.md`)
const overlayPath = (s: SkillStore, id: string) => join(userDir(s), `${id}.json`)

const read = (p: string): string | null => {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

/** Shipped skill ids, sorted. */
export function defaultIds(s: SkillStore): string[] {
  try {
    return readdirSync(s.defaultsDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).filter(isSkillId).sort()
  } catch { return [] }
}

function assertId(s: SkillStore, id: unknown): asserts id is string {
  if (!isSkillId(id)) throw new Error('bad_id')
  if (!existsSync(join(s.defaultsDir, `${id}.md`))) throw new Error('unknown_skill')
}

/** What the owner's copy is based on: the shipped text's hash and version; notifiedHash = already told about this update. */
type Meta = Record<string, { defaultHash: string; version?: number; notifiedHash?: string }>

export interface SkillChange { version: number; date: string; changes: string[]; hash?: string }

/** <defaults>/changelog.json: every shipped skill's versions, newest last. */
export function readChangelog(s: SkillStore): Record<string, SkillChange[]> {
  try {
    const j = JSON.parse(readFileSync(join(s.defaultsDir, 'changelog.json'), 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
export function skillVersion(s: SkillStore, id: string): number {
  const l = readChangelog(s)[id] ?? []
  return l.length ? Math.max(...l.map(c => Number(c.version) || 0)) : 1
}
function readMeta(s: SkillStore): Meta {
  try {
    const j = JSON.parse(readFileSync(metaPath(s), 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
function writeMeta(s: SkillStore, m: Meta) {
  mkdirSync(userDir(s), { recursive: true })
  writeFileSync(metaPath(s), JSON.stringify(m, null, 2) + '\n')
}

export function readDefault(s: SkillStore, id: string): string {
  assertId(s, id)
  return norm(readFileSync(join(s.defaultsDir, `${id}.md`), 'utf8'))
}
export function readOverlay(s: SkillStore, id: string): SkillOverlay {
  assertId(s, id)
  try { return normalizeOverlay(JSON.parse(readFileSync(overlayPath(s, id), 'utf8'))) } catch { return {} }
}
export function readOverride(s: SkillStore, id: string): string | null {
  assertId(s, id)
  const t = read(overridePath(s, id))
  return t === null ? null : norm(t)
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  kind: ParsedSkill['kind']
  customized: 'none' | 'form' | 'override'
  /** The shipped default changed since the owner wrote their override. */
  defaultUpdated: boolean
  /** The shipped version now. */
  version: number
  /** The version the owner's copy is based on (= version when nothing to review). */
  baseVersion: number
  /** What changed since the owner's copy (newest first), when defaultUpdated. */
  updates: SkillChange[]
  /** The override on disk fails lint (edited by hand): the default + form is used. */
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

export function effectiveSkill(s: SkillStore, id: string): { md: string; problems: LintProblem[] } {
  const def = readDefault(s, id)
  const ov = readOverride(s, id)
  if (ov !== null) {
    const problems = lintSkill(id, ov, def)
    if (!problems.length) return { md: ov, problems }
    return { md: applyOverlay(def, readOverlay(s, id)), problems }
  }
  return { md: applyOverlay(def, readOverlay(s, id)), problems: [] }
}

export function skillInfo(s: SkillStore, id: string): SkillInfo {
  const def = readDefault(s, id)
  const ov = readOverride(s, id)
  const overlay = readOverlay(s, id)
  const p = parseSkill(def)
  const meta = readMeta(s)[id]
  const hash = meta?.defaultHash
  const version = skillVersion(s, id)
  const defaultUpdated = ov !== null && !!hash && hash !== hashText(def)
  const baseVersion = defaultUpdated ? Math.min(meta?.version ?? version - 1, version) : version
  return {
    id,
    name: p.name,
    description: p.description,
    kind: p.kind,
    customized: ov !== null ? 'override' : isEmptyOverlay(overlay) ? 'none' : 'form',
    defaultUpdated,
    version,
    baseVersion,
    updates: defaultUpdated ? (readChangelog(s)[id] ?? []).filter(c => c.version > baseVersion).sort((a, b) => b.version - a.version) : [],
    overrideProblems: ov !== null ? lintSkill(id, ov, def) : []
  }
}

export function listSkills(s: SkillStore): SkillInfo[] {
  return defaultIds(s).map(id => skillInfo(s, id))
}

export function skillDetail(s: SkillStore, id: string): SkillDetail {
  const defaultMd = readDefault(s, id)
  return {
    ...skillInfo(s, id),
    defaultMd,
    effective: effectiveSkill(s, id).md,
    override: readOverride(s, id),
    overlay: readOverlay(s, id),
    locked: lockedLines(defaultMd).map(l => l.slice(2)),
    path: overridePath(s, id)
  }
}

function rememberDefault(s: SkillStore, id: string) {
  const m = readMeta(s)
  m[id] = { ...m[id], defaultHash: hashText(readDefault(s, id)), version: skillVersion(s, id) }
  writeMeta(s, m)
}

export function saveOverlay(s: SkillStore, id: string, raw: unknown): SkillOverlay {
  assertId(s, id)
  const o = normalizeOverlay(raw)
  mkdirSync(userDir(s), { recursive: true })
  if (isEmptyOverlay(o)) { try { unlinkSync(overlayPath(s, id)) } catch { /* none */ } }
  else writeFileSync(overlayPath(s, id), JSON.stringify(o, null, 2) + '\n')
  rememberDefault(s, id)
  return o
}

export function saveOverride(s: SkillStore, id: string, md: unknown): { ok: boolean; problems: LintProblem[] } {
  assertId(s, id)
  if (typeof md !== 'string') return { ok: false, problems: [{ rule: 'frontmatter', message: 'Empty skill' }] }
  const text = norm(md).trimEnd() + '\n'
  const problems = lintSkill(id, text, readDefault(s, id))
  if (problems.length) return { ok: false, problems }
  mkdirSync(userDir(s), { recursive: true })
  writeFileSync(overridePath(s, id), text)
  rememberDefault(s, id)
  return { ok: true, problems: [] }
}

/** "Keep mine" after Compare: the override now counts as based on the new default. */
export function ackDefault(s: SkillStore, id: string): void {
  assertId(s, id)
  rememberDefault(s, id)
}

/** "Overwrite": the new shipped text replaces the owner's markdown (form settings like tone stay). */
export function useNewDefault(s: SkillStore, id: string): void {
  assertId(s, id)
  try { unlinkSync(overridePath(s, id)) } catch { /* none */ }
  rememberDefault(s, id)
}

/** "Save mine as a copy": the owner's markdown is kept beside it (<id>.saved-<stamp>.md), the new text is used. */
export function saveMineAsCopy(s: SkillStore, id: string, at = new Date()): string | null {
  assertId(s, id)
  const mine = readOverride(s, id)
  if (mine === null) return null
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${p2(at.getMonth() + 1)}${p2(at.getDate())}-${p2(at.getHours())}${p2(at.getMinutes())}`
  const copy = join(userDir(s), `${id}.saved-v${readMeta(s)[id]?.version ?? 1}-${stamp}.md`)
  writeFileSync(copy, mine)
  useNewDefault(s, id)
  return copy
}

/** Skills whose shipped text changed under the owner's own markdown and were not announced yet (marks them told). */
export function newSkillUpdates(s: SkillStore): Array<{ id: string; name: string; version: number; changes: string[] }> {
  const m = readMeta(s)
  const out: Array<{ id: string; name: string; version: number; changes: string[] }> = []
  for (const id of defaultIds(s)) {
    const info = skillInfo(s, id)
    const h = hashText(readDefault(s, id))
    if (!info.defaultUpdated || m[id]?.notifiedHash === h) continue
    out.push({ id, name: info.name, version: info.version, changes: info.updates.flatMap(u => u.changes) })
    m[id] = { ...m[id], notifiedHash: h }
  }
  if (out.length) writeMeta(s, m)
  return out
}

/** Back to the shipped default: the owner's files for this id are removed. */
export function resetSkill(s: SkillStore, id: string): void {
  assertId(s, id)
  for (const p of [overridePath(s, id), overlayPath(s, id)]) { try { unlinkSync(p) } catch { /* none */ } }
  const m = readMeta(s)
  if (m[id]) { delete m[id]; writeMeta(s, m) }
}

export function compareSkill(s: SkillStore, id: string): { defaultMd: string; mine: string; diff: DiffLine[] } {
  const defaultMd = readDefault(s, id)
  const mine = readOverride(s, id) ?? effectiveSkill(s, id).md
  return { defaultMd, mine, diff: lineDiff(mine, defaultMd) }
}

/** Write every effective skill to <butler>/.claude/skills/<id>/SKILL.md. */
/** Skills renamed between versions: the owner's form / markdown follow the new id. */
export const RENAMED_SKILLS: Record<string, string> = { 'jira-check': 'handle-jira' }

export function migrateRenamedSkills(s: SkillStore): void {
  for (const [from, to] of Object.entries(RENAMED_SKILLS)) {
    for (const ext of ['json', 'md']) {
      const a = join(userDir(s), `${from}.${ext}`)
      const b = join(userDir(s), `${to}.${ext}`)
      if (!existsSync(a)) continue
      if (!existsSync(b)) {
        let text = readFileSync(a, 'utf8')
        if (ext === 'md') text = text.replace(new RegExp(`^name: ${from}$`, 'm'), `name: ${to}`)
        writeFileSync(b, text)
      }
      unlinkSync(a)
    }
  }
}

export function composeSkills(s: SkillStore): string[] {
  migrateRenamedSkills(s)
  const ids = defaultIds(s)
  // A skill Hive no longer ships (e.g. jira-check → handle-jira) leaves its composed copy behind.
  const root = join(s.butlerDir, '.claude', 'skills')
  try { for (const d of readdirSync(root)) if (isSkillId(d) && !ids.includes(d)) rmSync(join(root, d), { recursive: true, force: true }) } catch { /* none yet */ }
  for (const id of ids) {
    const dir = join(s.butlerDir, '.claude', 'skills', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), effectiveSkill(s, id).md)
  }
  return ids
}

// ── claude -p: Try it, Describe a change ──────────────────────────────

export const WRITING_GUIDE = `How a Butler skill is written:
- Frontmatter: name (the skill id, unchanged) and description (one sentence: what it does + when to use it).
- Sections, in this order, all present: ## Purpose, ## Input, ## Rules, ## Ask me first, ## Tone and format, ## Examples, ## Output. No other ## sections.
- ## Input and ## Output are locked: copy them unchanged.
- ## Ask me first: lines starting with "- 🔒" are locked: keep every one unchanged. Add new items as "- <topic> — <when>".
- Rules are short bullet lines, imperative, one rule per line. No essays.
- Examples show input then the exact output, short.
- Change only what the owner asked for; keep everything else word for word.`

const profileBlock = (profileMd: string) => (profileMd.trim() ? `<profile>\n${profileMd.trim()}\n</profile>\n\n` : '')

export function tryPrompt(skillMd: string, sample: string, profileMd: string): string {
  return [
    'This is a dry run of a Butler skill. Follow the skill exactly on the sample input and write only the output it asks for.',
    'Do not run tools, do not send or change anything. Where the skill needs live data you do not have, make a plausible short placeholder.',
    '',
    profileBlock(profileMd) + `<skill>\n${skillMd.trim()}\n</skill>`,
    '',
    `<input>\n${sample.trim()}\n</input>`
  ].join('\n')
}

export function editPrompt(currentMd: string, request: string, problems: LintProblem[] = []): string {
  return [
    'Rewrite this Butler skill to do what the owner asks. Follow the guide.',
    '',
    WRITING_GUIDE,
    '',
    `<skill>\n${currentMd.trim()}\n</skill>`,
    '',
    `Owner's request: ${request.trim()}`,
    ...(problems.length ? ['', 'Your previous version failed these checks, fix them:', ...problems.map(p => `- ${p.message}`)] : []),
    '',
    'Reply with exactly two blocks and nothing else:',
    '<<<SKILL',
    '(the complete new skill markdown, starting with ---)',
    'SKILL>>>',
    '<<<EXAMPLE',
    '(one short example output the new skill would produce)',
    'EXAMPLE>>>'
  ].join('\n')
}

export function parseEditReply(out: string): { md: string; example: string } {
  const t = norm(out)
  const skill = t.match(/<<<SKILL\n([\s\S]*?)\nSKILL>>>/)
  const example = t.match(/<<<EXAMPLE\n([\s\S]*?)\nEXAMPLE>>>/)
  let md = skill ? skill[1] : t
  md = md.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1').trim()
  return { md: md + '\n', example: example ? example[1].trim() : '' }
}

/** A dry run has no tools: anything specific in it is invented. Said first, every time. */
export const DRY_RUN_NOTE = 'Dry run · no tools ran — any ticket keys, dates or facts below are made up'

const jsonOf = (out: string): any => {
  const a = out.indexOf('{')
  const b = out.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(out.slice(a, b + 1)) } catch { return null }
}
const list = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []) as string[]

/** Skills that answer in JSON for the code are shown as what they mean, not as JSON. */
export function readableOutput(id: string, out: string): string {
  const j = jsonOf(out)
  if (!j) return out
  if (id === 'answer-feishu') {
    const claims = (Array.isArray(j.claims) ? j.claims : []).map((c: any) => `- ${c?.claim} → ${c?.verdict}${c?.source ? ` (${c.source})` : ''}`)
    return [
      `Reply: ${j.reply ?? ''}`,
      `${String(j.level ?? '').toUpperCase()} · ${j.category ?? ''} · confidence ${j.confidence ?? ''}`,
      list(j.sources).length ? `Sources: ${list(j.sources).join(', ')}` : '',
      claims.length ? `Claims:\n${claims.join('\n')}` : '',
      j.proposal?.summary ? `Proposes: ${j.proposal.summary}` : ''
    ].filter(Boolean).join('\n')
  }
  if (id === 'reply-email') {
    return j.decision === 'draft'
      ? [`About: ${j.about ?? ''}`, '', String(j.reply ?? '')].join('\n')
      : [`About: ${j.about ?? ''}`, `Needs you: ${j.question ?? ''}`].join('\n')
  }
  return out
}

export async function tryIt(s: SkillStore, id: string, sample: unknown, run: Runner, opts: { md?: unknown; profileMd?: string } = {}): Promise<{ ok: boolean; output?: string; error?: string }> {
  assertId(s, id)
  if (typeof sample !== 'string' || !sample.trim()) return { ok: false, error: 'empty_input' }
  const md = typeof opts.md === 'string' && opts.md.trim() ? opts.md : effectiveSkill(s, id).md
  try {
    const output = (await run(tryPrompt(md, sample.slice(0, 8000), opts.profileMd ?? ''))).trim()
    return output ? { ok: true, output: `${DRY_RUN_NOTE}\n\n${readableOutput(id, output)}` } : { ok: false, error: 'empty_output' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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

/** Ask claude to rewrite the skill; nothing is saved (Accept = saveOverride). One retry when lint fails. */
export async function proposeEdit(s: SkillStore, id: string, request: unknown, run: Runner): Promise<EditProposal> {
  assertId(s, id)
  if (typeof request !== 'string' || !request.trim()) return { ok: false, error: 'empty_request' }
  const def = readDefault(s, id)
  const current = effectiveSkill(s, id).md
  let problems: LintProblem[] = []
  let reply = { md: '', example: '' }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      reply = parseEditReply(await run(editPrompt(current, request.slice(0, 2000), problems)))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    problems = lintSkill(id, reply.md, def)
    if (!problems.length) break
  }
  return { ok: true, md: reply.md, example: reply.example, chips: changeChips(current, reply.md), diff: lineDiff(current, reply.md), problems }
}
