// Wake word "Hola Butler" — pure helpers: the phrase list (mirrors
// scripts/hive-speech.swift), helper line parsing, the spoken-command
// parser and the decision of where a command goes. No side effects.

import { resolveAgent, type AgentRow } from './butlerApi'

// "hola" is often heard as "ola" / "holla" / "hello" by an English
// recognizer and "butler" as "butter". Same list as the Swift helper.
export const WAKE_PHRASES: string[][] = [
  ['hola', 'butler'], ['ola', 'butler'], ['holla', 'butler'], ['oh', 'la', 'butler'],
  ['hello', 'butler'], ['hola', 'butter'], ['ola', 'butter']
]
export const CANCEL_WORDS = ['cancel', '取消', '算了', '不要了', '别发了']

/** Case, accents and width folded, one char in → one char out (indices stay valid). */
function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    const base = ch.normalize('NFKD').replace(/\p{M}/gu, '')
    const one = base.length === ch.length ? base : ch
    const low = one.toLowerCase()
    out += low.length === one.length ? low : one
  }
  return out
}

export function wakeTokens(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

const SEP = '[^\\p{L}\\p{N}]+'
const WAKE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${WAKE_PHRASES.map(p => p.join(SEP)).join('|')})(?![\\p{L}\\p{N}])`,
  'u'
)

/** Where the wake phrase is in `text` (original indices), or null. */
export function matchWake(text: string): { start: number; end: number } | null {
  const m = WAKE_RE.exec(fold(text))
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

/** The command without the wake phrase and anything before it. */
export function stripWake(text: string): string {
  const m = matchWake(text)
  return (m ? text.slice(m.end) : text).replace(/^[\s,，.。:：!！?？、\-—]+/u, '').trim()
}

export function isCancelText(text: string): boolean {
  const t = wakeTokens(text)
  if (t.length === 0) return false
  return CANCEL_WORDS.includes(t.join('')) || (t.length <= 2 && t.includes('cancel'))
}

export type WakeLine =
  | { kind: 'listening' }
  | { kind: 'wake' }
  | { kind: 'command'; path: string; fallback: string }
  | { kind: 'timeout' }
  | { kind: 'cancel' }

/** One stdout line of `hive-speech --wake`. */
export function parseWakeLine(line: string): WakeLine | null {
  if (line === 'listening:') return { kind: 'listening' }
  if (line === 'wake:') return { kind: 'wake' }
  if (line === 'timeout:') return { kind: 'timeout' }
  if (line === 'cancel:') return { kind: 'cancel' }
  if (!line.startsWith('command:')) return null
  const rest = line.slice('command:'.length)
  const tab = rest.indexOf('\t')
  const path = (tab === -1 ? rest : rest.slice(0, tab)).trim()
  if (!path) return null
  return { kind: 'command', path, fallback: tab === -1 ? '' : rest.slice(tab + 1).trim() }
}

export interface ParsedCommand {
  /** Agent name as it appears in Hive when one matched (case aside), else as heard. */
  agent?: string
  project?: string
  text: string
}

const ZH_VERB = /^(?:请)?(?:告诉|跟|和|给|让|叫|通知|问)\s*/u
const EN_VERB = /^(?:please\s+)?(?:tell|ask|message)\s+/i
const PROJECT_JOIN = /^\s*(?:的|'s|’s|\/|·)\s*/u
const EN_PROJECT_SUFFIX = /^\s+(?:in|on|from|at)\s+/i
const ZH_LEAD = /^[\s,，:：]*(?:说一下|说一声|说|讲)?[\s,，:：]*/u
const EN_LEAD = /^[\s,，:：]*(?:(?:to|that)\s+)?/i
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c)

/**
 * `name` at the start of `s` (case-insensitive, whole word for Latin
 * names) → the length it covers. Longest names are tried first so
 * "Missy 2" wins over "Missy".
 */
function leadingName(s: string, names: string[]): { name: string; len: number } | null {
  const lower = s.toLowerCase()
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length)
  for (const n of sorted) {
    if (!lower.startsWith(n.toLowerCase())) continue
    if (isWordChar(n[n.length - 1]) && isWordChar(s[n.length])) continue
    // Two names that differ only in case: say it the way it was heard, so
    // the exact resolver decides instead of us picking one.
    const same = sorted.filter(o => o.toLowerCase() === n.toLowerCase())
    const exact = same.find(o => s.startsWith(o))
    return { name: same.length === 1 ? n : exact ?? s.slice(0, n.length), len: n.length }
  }
  return null
}

/** A name Hive doesn't know: the first Latin word, else a short run of Han characters. */
function guessName(s: string): { name: string; len: number } | null {
  const m = /^[A-Za-z0-9][\w.-]*/.exec(s) || /^[\p{Script=Han}]{1,4}?(?=说|讲|[，,:：\s]|$)/u.exec(s) || /^[\p{Script=Han}]{2}/u.exec(s)
  return m ? { name: m[0], len: m[0].length } : null
}

/**
 * Spoken command → target + message. Forms: `告诉 Missy 继续做 e2e`,
 * `跟 Cube v2 的 Missy 说 …`, `让 Quinn …`, `tell Missy to …`,
 * `ask Quinn …`, `tell Missy in Cube v2 to …`. Names are found by exact
 * (case-insensitive) comparison with Hive's own names; nothing is fuzzy.
 * No verb at the start → no target (the text goes to the Butler chat).
 */
export function parseCommand(raw: string, names: { agents: string[]; projects: string[] }): ParsedCommand {
  const text = stripWake(raw)
  const zh = ZH_VERB.exec(text)
  const en = zh ? null : EN_VERB.exec(text)
  const verb = zh || en
  if (!verb) return { text }
  let rest = text.slice(verb[0].length)

  let project: string | undefined
  const p = leadingName(rest, names.projects)
  if (p) {
    const join = PROJECT_JOIN.exec(rest.slice(p.len))
    if (join) { project = p.name; rest = rest.slice(p.len + join[0].length) }
  }
  const a = leadingName(rest, names.agents) ?? guessName(rest)
  if (!a) return { text }
  rest = rest.slice(a.len)
  if (!project && en) {
    const suffix = EN_PROJECT_SUFFIX.exec(rest)
    const sp = suffix ? leadingName(rest.slice(suffix[0].length), names.projects) : null
    if (suffix && sp) { project = sp.name; rest = rest.slice(suffix[0].length + sp.len) }
  }
  const message = rest.replace(zh ? ZH_LEAD : EN_LEAD, '').trim()
  return { agent: a.name, ...(project ? { project } : {}), text: message }
}

export const BUTLER_CHAT_ID = 'chat-butler'

export type ForwardPlan =
  | { kind: 'agent'; row: AgentRow; text: string }
  | { kind: 'no_session'; row: AgentRow; text: string }
  | { kind: 'ambiguous'; name: string; project?: string; candidates: AgentRow[]; text: string }
  | { kind: 'not_found'; name: string; project?: string; candidates: AgentRow[]; text: string }
  | { kind: 'butler'; live: boolean; text: string }
  | { kind: 'empty' }

/** Where a parsed command goes. Only an exact, single, running target is sendable. */
export function planForward(cmd: ParsedCommand, rows: AgentRow[], butlerLive: boolean): ForwardPlan {
  if (!cmd.text) return { kind: 'empty' }
  if (!cmd.agent) return { kind: 'butler', live: butlerLive, text: cmd.text }
  const found = resolveAgent(rows, { agent: cmd.agent, project: cmd.project })
  if (found.ok) return found.row.chatLive
    ? { kind: 'agent', row: found.row, text: cmd.text }
    : { kind: 'no_session', row: found.row, text: cmd.text }
  const base = { name: cmd.agent, ...(cmd.project ? { project: cmd.project } : {}), candidates: found.candidates, text: cmd.text }
  return found.error === 'ambiguous' ? { kind: 'ambiguous', ...base } : { kind: 'not_found', ...base }
}

export function namesOf(rows: AgentRow[]): { agents: string[]; projects: string[] } {
  return {
    agents: [...new Set(rows.map(r => r.agent).filter(Boolean))],
    projects: [...new Set(rows.map(r => r.project).filter(Boolean))]
  }
}
