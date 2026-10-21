// handle-jira: each morning, look at the owner's tickets and act at the right
// level — L2 (do it, then tell), L1 (a card the owner approves), L0 (a line in
// Today). Detection is code over Jira search results, so it is stable and
// testable; the model only writes (questions, comments, a P4 draft).
//
// Nothing company-specific lives here: projects, final statuses, owners and
// thresholds come from the owner's <butler>/jira-config.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { jiraAssignApproval, jiraCommentApproval, jiraFixApproval, transitionTo } from './butlerJira'
import type { Approval } from './approvals'
import { join } from 'path'

export interface RequestProject {
  /** The status that closes it for good. */
  final: string
  /** Also finished (no action). */
  closed?: string[]
  /** Statuses where the PM is still working out the requirement. */
  analysis?: string[]
  /** Statuses Jira walks through to reach "design" after the product issue exists. */
  designPath?: string[]
  /** Waiting for the reporter to verify; not "forgotten". */
  waitingReporter?: string
}

export interface OwnerRule { labels?: string[]; projects?: string[]; user: string; name: string }

export interface JiraConfig {
  /** Request projects (e.g. FAE, LFCS, OUTLET) by key. */
  requests: Record<string, RequestProject>
  /** The product project and its "shipped" statuses. */
  product: { key: string; done: string[]; ready?: { minChars: number } }
  /** Engineering tasks that deliver a product issue: read for progress, never quoted. */
  dev?: { key: string; lead: string }
  /** Parked on purpose: only in the monthly list. */
  parked?: string[]
  stale: { active: Record<string, number>; waitingDays: number; deadDays: number }
  owners?: OwnerRule[]
  /** Tickets these people hand to the owner stay with the owner. */
  keepFrom?: string[]
}

export function readJiraConfig(butlerFolder: string): JiraConfig | null {
  try {
    const j = JSON.parse(readFileSync(join(butlerFolder, 'jira-config.json'), 'utf8'))
    if (!j || typeof j !== 'object' || !j.requests || !j.product?.key || !j.stale) return null
    return j as JiraConfig
  } catch { return null }
}

// ── Issues as jira_search returns them (fields we ask for) ──────────────

export interface Issue {
  key: string
  fields: {
    summary?: string
    status?: { name?: string }
    updated?: string
    labels?: string[]
    description?: string | null
    fixVersions?: Array<{ name?: string; releaseDate?: string; released?: boolean }>
    customfield_10105?: unknown[] | null
    assignee?: { name?: string; displayName?: string } | null
    issuelinks?: Array<{ type?: { name?: string }; inwardIssue?: LinkedIssue; outwardIssue?: LinkedIssue }>
  }
}
interface LinkedIssue { key: string; fields?: { summary?: string; status?: { name?: string } } }

export type Level = 'L2' | 'L1' | 'L0'
export type Kind =
  | 'close-source' | 'nudge-source' | 'stuck-analysis' | 'p4-no-pr' | 'p4-pr-done' | 'p4-no-version'
  | 'stale-active' | 'stale-waiting' | 'stale-dead' | 'to-product'
export interface Finding { key: string; kind: Kind; level: Level; summary: string; detail: string; related?: string; to?: string }

const project = (key: string) => key.split('-')[0]
const status = (i: { fields?: { status?: { name?: string } } }) => i.fields?.status?.name ?? ''
const days = (iso: string | undefined, at: number) => (iso ? Math.floor((at - new Date(iso).getTime()) / 86_400_000) : 0)
const linked = (i: Issue): LinkedIssue[] => (i.fields.issuelinks ?? []).map(l => l.inwardIssue ?? l.outwardIssue).filter((x): x is LinkedIssue => !!x?.key)

/** The owner's open tickets → what to do about each (at most one finding per ticket, most useful first). */
export function classify(issues: Issue[], cfg: JiraConfig, at: number): Finding[] {
  const out: Finding[] = []
  const P = cfg.product.key
  const shipped = new Set(cfg.product.done)
  for (const i of issues) {
    const p = project(i.key)
    const st = status(i)
    const sum = i.fields.summary ?? ''
    const idle = days(i.fields.updated, at)
    const req = cfg.requests[p]
    const links = linked(i)
    const add = (f: Omit<Finding, 'key' | 'summary'>) => { out.push({ key: i.key, summary: sum, ...f }) }

    if (req) {
      if (st === req.final || (req.closed ?? []).includes(st)) continue
      // Waiting for the reporter to verify: their move, not a forgotten ticket.
      if (req.waitingReporter && st === req.waitingReporter) continue
      // Its product issue shipped but this request was never closed.
      const done = links.find(l => project(l.key) === P && shipped.has(status(l)))
      if (done) { add({ kind: 'close-source', level: 'L2', detail: `${done.key} ${status(done)}`, related: done.key, to: req.final }); continue }
      if ((req.analysis ?? []).includes(st) && idle > 7) {
        const hasProduct = links.some(l => project(l.key) === P)
        add(hasProduct
          ? { kind: 'stuck-analysis', level: 'L1', detail: `${st} ${idle}d` }
          : { kind: 'stuck-analysis', level: 'L1', detail: `${st} ${idle}d · no ${P} yet` })
        continue
      }
    }

    if (p === P && !shipped.has(st)) {
      const dev = cfg.dev ? links.filter(l => project(l.key) === cfg.dev!.key) : []
      const desc = i.fields.description ?? ''
      const ready = desc.length >= (cfg.product.ready?.minChars ?? 400) || /feishu\.cn|larksuite\.com|PRD/i.test(desc)
      const inSprint = Array.isArray(i.fields.customfield_10105) && i.fields.customfield_10105.length > 0
      // Design is done (detailed description or a PRD link): engineering should have a task.
      if (cfg.dev && ready && !dev.length) {
        add({ kind: 'p4-no-pr', level: 'L1', detail: `ready, no ${cfg.dev.key} task`, to: cfg.dev.lead }); continue
      }
      if (dev.length && dev.every(d => status(d) === 'Done') && !['UAT', ...shipped].includes(st)) {
        add({ kind: 'p4-pr-done', level: 'L0', detail: `all ${cfg.dev!.key} done, still ${st}` }); continue
      }
      if (inSprint && !(i.fields.fixVersions ?? []).length) { add({ kind: 'p4-no-version', level: 'L0', detail: 'in a sprint, no fixVersion (no date)' }); continue }
    }

    // How long it sat, by status.
    const active = cfg.stale.active[st]
    if ((cfg.parked ?? []).includes(st)) { if (idle > cfg.stale.deadDays) add({ kind: 'stale-dead', level: 'L0', detail: `${st} ${idle}d` }); continue }
    if (active !== undefined) { if (idle > active) add({ kind: 'stale-active', level: 'L0', detail: `${st} ${idle}d` }); continue }
    if (idle > cfg.stale.deadDays) add({ kind: 'stale-dead', level: 'L0', detail: `${st} ${idle}d` })
    else if (idle > cfg.stale.waitingDays) add({ kind: 'stale-waiting', level: 'L0', detail: `${st} ${idle}d` })
  }
  return out
}

/** Who should own a ticket newly assigned to the owner, by its labels / project; null = the owner. */
export function ownerFor(i: { key: string; fields: { labels?: string[] } }, cfg: JiraConfig): OwnerRule | null {
  const labels = new Set((i.fields.labels ?? []).map(l => l.toLowerCase()))
  for (const r of cfg.owners ?? []) {
    if ((r.projects ?? []).includes(project(i.key))) return r
    if ((r.labels ?? []).some(l => labels.has(l.toLowerCase()))) return r
  }
  return null
}

const GROUP: Array<[Kind[], string]> = [
  [['close-source'], 'Closed for you'],
  [['nudge-source', 'stuck-analysis', 'p4-no-pr', 'to-product'], 'Waiting for your OK (Approve)'],
  [['p4-pr-done', 'p4-no-version'], 'Product issues to move'],
  [['stale-active'], 'Stuck'],
  [['stale-waiting'], 'Not started (30+ days)'],
  [['stale-dead'], 'Backlog to clean (90+ days)']
]

/** Today's Jira section: grouped, one line per ticket, at most `cap` per group. */
export function inboxText(found: Finding[], cap = 10): string {
  const parts: string[] = []
  for (const [kinds, title] of GROUP) {
    const rows = found.filter(f => kinds.includes(f.kind))
    if (!rows.length) continue
    const lines = rows.slice(0, cap).map(f => `- ${f.key} · ${f.summary.slice(0, 60)} · ${f.detail}`)
    if (rows.length > cap) lines.push(`- … ${rows.length - cap} more`)
    parts.push(`**${title}** (${rows.length})\n${lines.join('\n')}`)
  }
  return parts.join('\n\n') || 'Nothing needs you in Jira today.'
}

// ── The daily run ─────────────────────────────────────────────────────


type Call = (tool: string, args: Record<string, unknown>) => Promise<string>
const FIELDS = 'summary,status,updated,labels,description,fixVersions,customfield_10105,assignee,issuelinks'
const ACT_AGAIN_MS = 7 * 86_400_000

export interface HandleJiraDeps {
  folder: string
  call: Call
  /** The model, for writing only (questions, comments). No tools. */
  write: (prompt: string) => Promise<string>
  approvals: { add: (c: Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>) => Approval }
  now?: () => number
}

interface RunState { lastRun: number; acted: Record<string, number> }
const statePath = (folder: string) => join(folder, 'handle-jira-state.json')
function readState(folder: string): RunState {
  try { const j = JSON.parse(readFileSync(statePath(folder), 'utf8')); return { lastRun: Number(j.lastRun) || 0, acted: j.acted && typeof j.acted === 'object' ? j.acted : {} } } catch { return { lastRun: 0, acted: {} } }
}
function writeState(folder: string, s: RunState) {
  if (!existsSync(folder)) mkdirSync(folder, { recursive: true })
  writeFileSync(statePath(folder), JSON.stringify(s, null, 2) + '\n')
}

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`
async function search(call: Call, jql: string, max = 300): Promise<Issue[]> {
  const out: Issue[] = []
  for (let start = 0; start < max; start += 100) {
    const r = JSON.parse(await call('jira_search', { jql, fields: FIELDS, max_results: 100, start_at: start }))
    out.push(...(r.issues ?? []))
    if (out.length >= (r.total ?? 0) || !(r.issues ?? []).length) break
  }
  return out
}

/** Statuses that end a ticket in any configured project. */
function finalStatuses(cfg: JiraConfig): string[] {
  const s = new Set<string>(cfg.product.done)
  for (const r of Object.values(cfg.requests)) { s.add(r.final); for (const c of r.closed ?? []) s.add(c) }
  return [...s]
}

export async function runHandleJira(deps: HandleJiraDeps, cfg: JiraConfig): Promise<{ text: string; findings: Finding[]; actions: string[] }> {
  const now = deps.now ?? Date.now
  const at = now()
  const state = readState(deps.folder)
  const projects = [...Object.keys(cfg.requests), cfg.product.key]
  const open = `project in (${projects.join(', ')}) AND status not in (${finalStatuses(cfg).map(quote).join(', ')})`
  const mine = await search(deps.call, `${open} AND assignee = currentUser() ORDER BY updated DESC`)
  const findings = classify(mine, cfg, at)
  const actions: string[] = []
  const fresh = (k: string) => !state.acted[k] || at - state.acted[k] > ACT_AGAIN_MS
  const mark = (k: string) => { state.acted[k] = at }
  let drafts = 0

  for (const f of findings) {
    const k = `${f.key}:${f.kind}`
    if (!fresh(k)) continue
    if (f.kind === 'close-source' && f.to) {
      // L2: the product issue shipped — close the request, say why on it.
      const r = await transitionTo(deps.call, f.key, f.to, `${f.related} ${f.detail.replace(`${f.related} `, '')} — closed by Hive Butler for the owner.`).catch(e => ({ ok: false as const, error: String(e), steps: [] }))
      if (r.ok) actions.push(`${f.key} → ${f.to}`)
      else deps.approvals.add(jiraFixApproval({ key: f.key, to: f.to, why: `${f.detail}` }, `could not close it automatically: ${r.error}`))
      mark(k)
    } else if (f.kind === 'p4-no-pr' && f.to) {
      deps.approvals.add(jiraCommentApproval(f.key, `design ready, no engineering task`, `[~${f.to}] 这张单的设计已就绪（详细描述 / PRD 已完成），还没有对应的研发任务，麻烦安排一下？`))
      mark(k)
    } else if (f.kind === 'stuck-analysis' && drafts < 3) {
      drafts++
      const text = (await deps.write([
        'Use the handle-jira skill (read jira-knowledge first).',
        `Ticket ${f.key} "${f.summary}" has been in requirements analysis (${f.detail}).`,
        'Write one Jira comment for the requester: the questions that make the user story black-and-white (who, what problem, scenario, expected result, acceptance, deadline), or a short initial solution to confirm. Comment text only.'
      ].join('\n')).catch(() => '')).trim()
      if (text) { deps.approvals.add(jiraCommentApproval(f.key, `in analysis ${f.detail}`, text)); mark(k) }
    }
  }

  // Newly assigned to the owner: hand over what belongs to someone else.
  const since = state.lastRun ? Math.max(1, Math.ceil((at - state.lastRun) / 86_400_000)) : 1
  const newly = await search(deps.call, `${open} AND assignee changed to currentUser() AFTER -${since}d`, 100)
  for (const i of newly) {
    const owner = ownerFor(i, cfg)
    const k = `${i.key}:reassign`
    if (!owner || !fresh(k)) continue
    if ((cfg.keepFrom ?? []).length) {
      const raw = JSON.parse(await deps.call('jira_get_issue', { issue_key: i.key, fields: 'assignee', expand: 'changelog' }).catch(() => '{}'))
      const hist: any[] = raw?.changelog?.histories ?? []
      const from = hist.flatMap(h => (h.items ?? []).filter((x: any) => x.field === 'assignee')).map((x: any) => String(x.from ?? '')).pop()
      if (from && (cfg.keepFrom ?? []).some(u => from === u || u.startsWith(`${from}@`))) continue
    }
    deps.approvals.add(jiraAssignApproval(i.key, owner, `[~${owner.user}] 按分工这张单由你负责，转给你处理。`))
    mark(k)
  }

  state.lastRun = at
  writeState(deps.folder, state)
  const head = actions.length ? `**Done for you** (${actions.length})\n${actions.map(a => `- ${a}`).join('\n')}\n\n` : ''
  return { text: head + inboxText(findings), findings, actions }
}
