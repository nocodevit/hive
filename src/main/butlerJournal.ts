// Butler journal: one markdown file per day in <butler dir>/journal/
// YYYY-MM-DD.md with "## Plan" (a checklist the Today tab ticks),
// "## Feishu", "## Jira" and "## Summary" sections written by the routines.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { JournalDay, JournalItem } from '../shared/butler-routines'

export const JOURNAL_SECTIONS = ['Plan', 'Feishu', 'Jira', 'Summary'] as const
export type JournalSection = typeof JOURNAL_SECTIONS[number]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function journalDir(butlerFolder: string): string {
  return join(butlerFolder, 'journal')
}

/** Local calendar date, YYYY-MM-DD. */
export function localDate(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function isJournalDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s)
}

function fileOf(dir: string, date: string): string {
  if (!isJournalDate(date)) throw new Error('bad_date')
  return join(dir, `${date}.md`)
}

export function readJournalText(dir: string, date: string): string {
  try { return readFileSync(fileOf(dir, date), 'utf8') } catch { return '' }
}

function writeJournalText(dir: string, date: string, text: string) {
  mkdirSync(dir, { recursive: true })
  const f = fileOf(dir, date)
  writeFileSync(f + '.tmp', text)
  renameSync(f + '.tmp', f)
}

/** Split a journal into its "## Name" sections (text before the first heading is dropped). */
export function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let name: string | null = null
  let buf: string[] = []
  const flush = () => { if (name !== null) out.set(name, buf.join('\n').trim()) }
  for (const line of text.split('\n')) {
    const m = line.match(/^## (.+?)\s*$/)
    if (m) { flush(); name = m[1]; buf = [] } else if (name !== null) buf.push(line)
  }
  flush()
  return out
}

export function renderJournal(date: string, sections: Map<string, string>): string {
  const order = [...JOURNAL_SECTIONS.filter(s => sections.has(s)), ...[...sections.keys()].filter(k => !(JOURNAL_SECTIONS as readonly string[]).includes(k))]
  const parts = [`# ${date}`]
  for (const k of order) parts.push(`## ${k}\n${sections.get(k)!.trim()}`)
  return parts.join('\n\n') + '\n'
}

/** Replace one section, keeping the others as they are. */
export function setJournalSection(dir: string, date: string, section: JournalSection, body: string): void {
  const sections = splitSections(readJournalText(dir, date))
  sections.set(section, body.trim())
  writeJournalText(dir, date, renderJournal(date, sections))
}

const ITEM_RE = /^\s*[-*] \[( |x|X)\] (.*)$/
const SOURCE_RE = /\s#(draft|jira)\s*$/i

export function parseChecklist(body: string): JournalItem[] {
  const items: JournalItem[] = []
  for (const line of body.split('\n')) {
    const m = line.match(ITEM_RE)
    if (!m) continue
    const src = m[2].match(SOURCE_RE)
    items.push({
      index: items.length,
      text: (src ? m[2].slice(0, src.index) : m[2]).trim(),
      done: m[1] !== ' ',
      source: src ? (src[1].toLowerCase() as 'draft' | 'jira') : null
    })
  }
  return items
}

/**
 * Model output → checklist lines. Accepts "- [ ] x", "- x", "* x", "1. x";
 * everything else is dropped. Items come back unchecked.
 */
export function toChecklist(output: string): string {
  const lines: string[] = []
  for (const raw of output.split('\n')) {
    const m = raw.match(/^\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/)
    if (m && m[1].trim()) lines.push(`- [ ] ${m[1].trim()}`)
  }
  return lines.join('\n')
}

export function readJournalDay(dir: string, date: string): JournalDay {
  const s = splitSections(readJournalText(dir, date))
  const plan = s.get('Plan') ?? ''
  const late = plan.split('\n').find(l => l.startsWith('> late'))
  return {
    date,
    plan: parseChecklist(plan),
    planLate: late ? late.slice(2).trim() : null,
    summary: s.get('Summary') ?? '',
    feishu: s.get('Feishu') ?? '',
    jira: s.get('Jira') ?? '',
    meetings: s.get('Meetings') ?? '',
    butler: s.get('Butler') ?? ''
  }
}

/**
 * Tick / untick one plan item. The item is named by its exact index and
 * text: if the plan was rewritten since the UI read it, nothing changes.
 */
export function toggleJournalItem(dir: string, date: string, index: number, text: string, done: boolean): { ok: boolean; error?: string } {
  const sections = splitSections(readJournalText(dir, date))
  const plan = sections.get('Plan')
  if (plan === undefined) return { ok: false, error: 'no_plan' }
  let n = -1
  let hit = false
  const lines = plan.split('\n').map(line => {
    const m = line.match(ITEM_RE)
    if (!m) return line
    n++
    if (n !== index) return line
    const src = m[2].match(SOURCE_RE)
    const t = (src ? m[2].slice(0, src.index) : m[2]).trim()
    if (t !== text) return line
    hit = true
    return line.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]')
  })
  if (!hit) return { ok: false, error: 'changed' }
  sections.set('Plan', lines.join('\n'))
  writeJournalText(dir, date, renderJournal(date, sections))
  return { ok: true }
}

/** Days that have a journal, newest first. */
export function listJournalDates(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(n => n.endsWith('.md') && isJournalDate(n.slice(0, -3)))
    .map(n => n.slice(0, -3))
    .sort()
    .reverse()
}

/** The newest day before `date` whose journal has the given section. */
export function previousWithSection(dir: string, date: string, section: JournalSection): { date: string; body: string } | null {
  for (const d of listJournalDates(dir)) {
    if (d >= date) continue
    const body = splitSections(readJournalText(dir, d)).get(section)
    if (body) return { date: d, body }
  }
  return null
}
