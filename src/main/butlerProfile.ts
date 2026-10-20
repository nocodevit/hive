// "About you": who the owner is and how they talk, shared by everything
// Butler writes on their behalf. Stored as profile.json (the form) and
// rendered to profile.md in the Butler folder, which CLAUDE.md tells the
// session to follow.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const PROFILE_STYLES = ['direct', 'warm', 'formal'] as const
export type ProfileStyle = (typeof PROFILE_STYLES)[number]

export interface ButlerProfile {
  /** What the owner calls their assistant (shown in Hive; default "Butler"). */
  assistantName: string
  name: string
  role: string
  team: string
  responsibleFor: string
  worksWith: string
  style: ProfileStyle
  oftenSays: string
  neverSays: string
  language: string
  answerLike: string
  whenUnsure: string
  prefix: string
  intro: string
}

export const EMPTY_PROFILE: ButlerProfile = {
  assistantName: '', name: '', role: '', team: '', responsibleFor: '', worksWith: '', style: 'direct',
  oftenSays: '', neverSays: '', language: '', answerLike: '', whenUnsure: '', prefix: '', intro: ''
}

const STYLE_TEXT: Record<ProfileStyle, string> = {
  direct: 'Direct: lead with the conclusion, short sentences, no pleasantries.',
  warm: 'Warm: friendly and personal, still to the point.',
  formal: 'Formal: polite, complete sentences, professional wording.'
}

/** Anything not a known field, or not a string, is dropped. */
export function normalizeProfile(raw: unknown): ButlerProfile {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...EMPTY_PROFILE }
  for (const k of Object.keys(EMPTY_PROFILE) as Array<keyof ButlerProfile>) {
    const v = src[k]
    if (typeof v !== 'string') continue
    if (k === 'style') { if ((PROFILE_STYLES as readonly string[]).includes(v)) out.style = v as ProfileStyle }
    else out[k] = v.trim().slice(0, 500)
  }
  return out
}

export function isProfileEmpty(p: ButlerProfile): boolean {
  return !p.name && !p.role && !p.responsibleFor && !p.answerLike
}

/** What the Butler session reads. Empty fields are left out. */
export function renderProfileMd(p: ButlerProfile): string {
  const who = p.name || 'the owner'
  const lines = [
    '# About the owner',
    '',
    `You are ${who}'s personal AI agent${p.assistantName ? `, called ${p.assistantName}` : ''}. When you write anything on ${p.name || 'their'}${p.name ? "'s" : ''} behalf, sound like them and keep their level of expertise.`,
    ''
  ]
  const facts: Array<[string, string]> = [
    ['Name', p.name], ['Role', p.role], ['Team', p.team], ['Responsible for', p.responsibleFor],
    ['Works most with', p.worksWith]
  ]
  const known = facts.filter(([, v]) => v)
  if (known.length) lines.push('## Who', '', ...known.map(([k, v]) => `- ${k}: ${v}`), '')
  lines.push('## Style', '', `- ${STYLE_TEXT[p.style]}`)
  if (p.oftenSays) lines.push(`- Often says: ${p.oftenSays}`)
  if (p.neverSays) lines.push(`- Never says: ${p.neverSays}`)
  if (p.language) lines.push(`- Language: ${p.language}`)
  lines.push('')
  if (p.answerLike || p.whenUnsure) {
    lines.push('## Expertise', '')
    if (p.answerLike) lines.push(`- Answer like a ${p.answerLike}.`)
    if (p.whenUnsure) lines.push(`- When unsure: ${p.whenUnsure}`)
    lines.push('')
  }
  if (p.prefix || p.intro || p.assistantName) {
    lines.push('## As their agent', '')
    if (p.prefix) lines.push(`- Start every message you send for them with: ${p.prefix}`)
    if (p.intro) lines.push(`- Introduce yourself as: ${p.intro}`)
    else if (p.assistantName) lines.push(`- When you introduce yourself to others, say you are ${p.assistantName}, ${p.name || 'the owner'}'s AI agent.`)
    lines.push('')
  }
  return lines.join('\n')
}

export function readProfile(butlerDir: string): ButlerProfile {
  try { return normalizeProfile(JSON.parse(readFileSync(join(butlerDir, 'profile.json'), 'utf8'))) } catch { return { ...EMPTY_PROFILE } }
}

export function writeProfile(butlerDir: string, raw: unknown): ButlerProfile {
  const p = normalizeProfile(raw)
  if (!existsSync(butlerDir)) mkdirSync(butlerDir, { recursive: true })
  writeFileSync(join(butlerDir, 'profile.json'), JSON.stringify(p, null, 2) + '\n')
  writeFileSync(join(butlerDir, 'profile.md'), renderProfileMd(p))
  return p
}
