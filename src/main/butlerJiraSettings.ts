// Butler settings › Jira: the owner's company specifics — which projects play
// which role, their final statuses, who owns what, the dev lead, thresholds,
// what labels mean. Saved as <butler>/jira-config.json (read by handle-jira)
// and rendered to <butler>/jira.md, which the Jira-aware skills read next to
// the generic jira-knowledge skill. Nothing here ships with Hive.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { readJiraConfig, type JiraConfig, type OwnerRule, type RequestProject } from './handleJira'

export interface JiraSettings extends JiraConfig {
  /** One line per project: what it holds ("FAE: requests from field engineers and sales"). */
  projectNotes?: Record<string, string>
  /** What the labels mean (requester, product line, area …), free text. */
  labelNotes?: string
  /** Anything else Butler should know about how this Jira is used. */
  notes?: string
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const list = (v: unknown, n = 30) => (Array.isArray(v) ? [...new Set(v.map(x => str(x, 80)).filter(Boolean))].slice(0, n) : [])
const KEY = /^[A-Z][A-Z0-9]{0,19}$/
const days = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3650 ? Math.round(v) : d)

export function normalizeJiraSettings(raw: unknown): JiraSettings | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const productKey = str(r.product?.key, 20)
  if (!KEY.test(productKey)) return null
  const requests: Record<string, RequestProject> = {}
  for (const [k, v] of Object.entries((r.requests ?? {}) as Record<string, any>)) {
    if (!KEY.test(k) || k === productKey || !str(v?.final, 60)) continue
    requests[k] = {
      final: str(v.final, 60),
      ...(list(v.closed).length ? { closed: list(v.closed) } : {}),
      ...(list(v.analysis).length ? { analysis: list(v.analysis) } : {}),
      ...(list(v.designPath).length ? { designPath: list(v.designPath) } : {}),
      ...(str(v.waitingReporter, 60) ? { waitingReporter: str(v.waitingReporter, 60) } : {})
    }
  }
  const devKey = str(r.dev?.key, 20)
  const owners: OwnerRule[] = (Array.isArray(r.owners) ? r.owners : []).map((o: any) => ({
    ...(list(o?.labels).length ? { labels: list(o.labels) } : {}),
    ...(list(o?.projects).filter(p => KEY.test(p)).length ? { projects: list(o.projects).filter(p => KEY.test(p)) } : {}),
    user: str(o?.user, 120), name: str(o?.name, 60)
  })).filter((o: OwnerRule) => o.user && o.name && (o.labels?.length || o.projects?.length)).slice(0, 50)
  const active: Record<string, number> = {}
  for (const [k, v] of Object.entries((r.stale?.active ?? {}) as Record<string, unknown>)) if (str(k, 60)) active[str(k, 60)] = days(v, 7)
  const notes: Record<string, string> = {}
  for (const [k, v] of Object.entries((r.projectNotes ?? {}) as Record<string, unknown>)) if (KEY.test(k) && str(v, 300)) notes[k] = str(v, 300)
  return {
    requests,
    product: { key: productKey, done: list(r.product?.done).length ? list(r.product.done) : ['Done'], ready: { minChars: days(r.product?.ready?.minChars, 400) } },
    ...(KEY.test(devKey) && str(r.dev?.lead, 120) ? { dev: { key: devKey, lead: str(r.dev.lead, 120) } } : {}),
    ...(list(r.parked).length ? { parked: list(r.parked) } : {}),
    stale: { active, waitingDays: days(r.stale?.waitingDays, 30), deadDays: days(r.stale?.deadDays, 90) },
    ...(owners.length ? { owners } : {}),
    ...(list(r.keepFrom).length ? { keepFrom: list(r.keepFrom) } : {}),
    ...(Object.keys(notes).length ? { projectNotes: notes } : {}),
    ...(str(r.labelNotes, 4000) ? { labelNotes: str(r.labelNotes, 4000) } : {}),
    ...(str(r.notes, 4000) ? { notes: str(r.notes, 4000) } : {})
  }
}

export function readJiraSettings(butlerDir: string): JiraSettings | null {
  return readJiraConfig(butlerDir) as JiraSettings | null
}

/** What the Jira-aware skills read: the company specifics, as plain markdown. */
export function renderJiraMd(s: JiraSettings): string {
  const P = s.product.key
  const rows = [
    ...Object.entries(s.requests).map(([k, r]) => `| ${k} | request | ${r.final}${r.closed?.length ? ` (also closed: ${r.closed.join(', ')})` : ''} | ${s.projectNotes?.[k] ?? ''} |`),
    `| ${P} | product (sprints, versions) | ${s.product.done.join(' / ')} | ${s.projectNotes?.[P] ?? ''} |`,
    ...(s.dev ? [`| ${s.dev.key} | engineering tasks (progress only, never quoted) | — | ${s.projectNotes?.[s.dev.key] ?? ''} |`] : [])
  ]
  const req = Object.entries(s.requests)
  return [
    '# Jira (Butler settings)', '',
    '## Projects', '', '| Key | Role | Final status | What it holds |', '|---|---|---|---|', ...rows, '',
    '## Flow', '',
    `- A request is accepted into the product when a ${P} issue is linked to it; the request closes when that ${P} issue ships (${s.product.done.join(' / ')}).`,
    ...req.filter(([, r]) => r.analysis?.length).map(([k, r]) => `- ${k} is being worked out while in: ${r.analysis!.join(', ')}.`),
    ...req.filter(([, r]) => r.designPath?.length).map(([k, r]) => `- After the ${P} issue exists, ${k} moves through: ${r.designPath!.join(' → ')}.`),
    ...req.filter(([, r]) => r.waitingReporter).map(([k, r]) => `- ${k} in "${r.waitingReporter}" waits for the reporter to verify.`),
    ...(s.dev ? [`- ${P} progress is its linked ${s.dev.key} tasks; ${s.dev.key} content is never quoted. Dev lead: ${s.dev.lead}.`] : []),
    `- A ${P} issue is ready when its description is detailed (${s.product.ready?.minChars ?? 400}+ characters) or links a PRD.`, '',
    '## Owners', '',
    ...(s.owners?.length ? s.owners.map(o => `- ${o.name} (${o.user}): ${[...(o.projects ?? []), ...(o.labels ?? [])].join(', ')}`) : ['- Everything is the owner\'s.']),
    ...(s.keepFrom?.length ? [`- Tickets handed over by ${s.keepFrom.join(', ')} stay with the owner.`] : []), '',
    '## Labels', '', s.labelNotes || '(not described)', '',
    ...(s.notes ? ['## Notes', '', s.notes, ''] : [])
  ].join('\n')
}

export function writeJiraSettings(butlerDir: string, raw: unknown): JiraSettings | null {
  const s = normalizeJiraSettings(raw)
  if (!s) return null
  if (!existsSync(butlerDir)) mkdirSync(butlerDir, { recursive: true })
  writeFileSync(join(butlerDir, 'jira-config.json'), JSON.stringify(s, null, 2) + '\n')
  writeFileSync(join(butlerDir, 'jira.md'), renderJiraMd(s))
  return s
}

export function readJiraMd(butlerDir: string): string {
  try { return readFileSync(join(butlerDir, 'jira.md'), 'utf8') } catch { return '' }
}

/** For "Set up from Jira": the model looks around with the owner's read-only Jira tools and drafts the settings. */
export function discoverPrompt(): string {
  return [
    'Work out how this person uses Jira, using only your read-only Jira tools, and draft their Butler Jira settings.',
    '1. jira_get_user_profile: who they are.',
    '2. jira_search: "(assignee = currentUser() OR reporter = currentUser()) AND updated >= -180d", fields project,status,issuelinks,labels,issuetype — which projects they work in.',
    '3. Roles: the product project has sprints and fixVersions and is linked FROM request projects; request projects (requirements, customer support) link TO product issues; an engineering project holds tasks linked to product issues (Blocks / Relates) that deliver them.',
    '4. Final statuses: per project, the status that closes a ticket for good (statusCategory done); note statuses that are done-category but not final, and a "waiting for the reporter to verify" status if there is one. Use jira_get_transitions on an open ticket when unsure.',
    '5. Labels: which mark the requester / business unit, the product line, the area. For labels and projects often assigned to one other person, that person is their owner (username + display name).',
    '6. The dev lead: the person who most often owns engineering tasks.',
    'Reply ONLY with JSON:',
    '{"requests": {"KEY": {"final": "", "closed": [], "analysis": [], "waitingReporter": ""}}, "product": {"key": "", "done": []}, "dev": {"key": "", "lead": ""},',
    ' "owners": [{"labels": [], "projects": [], "user": "", "name": ""}], "projectNotes": {"KEY": "what it holds"}, "labelNotes": "", "stale": {"active": {"In Review": 7, "In Progress": 14, "Blocked": 7}, "waitingDays": 30, "deadDays": 90}}',
    'Leave out what you could not find. Never invent a project, status or person.'
  ].join('\n')
}

/** The model's draft → settings (not saved: the owner reviews it first). */
export function parseDiscovery(out: string): JiraSettings | null {
  const a = out.indexOf('{')
  const b = out.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return normalizeJiraSettings(JSON.parse(out.slice(a, b + 1))) } catch { return null }
}
