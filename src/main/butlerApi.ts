// Butler API — pure helpers behind the local HTTP routes that let an
// external controller (hive-butler, a `claude remote-control` session on
// this machine) see agents, read a chat's tail, send into a chat and
// start one. Wiring (HTTP + chat.ts + renderer IPC) lives in index.ts;
// everything here is side-effect free so it can be unit-tested.

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export const BUTLER_ROUTES = ['/agents', '/chat/tail', '/chat/send', '/chat/start', '/feishu/probe', '/feishu/chat-search', '/feishu/try', '/pending', '/routines/run', '/jira/read', '/todos', '/todos/add', '/todos/status', '/todos/note', '/todos/priority', '/cards', '/cards/show', '/cards/edit', '/cards/close', '/cards/reopen', '/calendar'] as const

export function isButlerRoute(url: string): boolean {
  const path = url.split('?')[0]
  return (BUTLER_ROUTES as readonly string[]).includes(path)
}

/**
 * These routes can type into an agent's chat, so a web page must never be
 * able to reach them. A browser cannot set a custom header cross-origin
 * without a CORS preflight (which this server never answers), and always
 * sends Origin on such requests — require the token header and refuse any
 * request that carries an Origin.
 */
export function checkButlerAuth(
  headers: Record<string, string | string[] | undefined>,
  token: string
): { ok: true } | { ok: false; status: number; error: string } {
  if (headers.origin) return { ok: false, status: 403, error: 'origin_not_allowed' }
  const got = headers['x-hive-token']
  if (!token || typeof got !== 'string' || got !== token) return { ok: false, status: 401, error: 'bad_token' }
  return { ok: true }
}

interface AgentRec { id: string; name?: string; projectId?: string; role?: string; department?: string; note?: string }
interface ProjectRec { id: string; name?: string }

export interface AgentRow {
  agentId: string
  agent: string
  projectId: string
  project: string
  role: string
  note: string
  chatLive: boolean
  activity: 'working' | 'waiting' | 'off'
  /** When the agent's chat log was last written (ms), 0 if never. */
  updatedAt: number
}

export function listAgents(
  data: { projects?: unknown; agents?: unknown },
  liveAgentIds: Iterable<string>,
  activityOf: (agentId: string) => string | undefined,
  updatedOf: (agentId: string) => number = () => 0
): AgentRow[] {
  const projects = (Array.isArray(data.projects) ? data.projects : []) as ProjectRec[]
  const agents = (Array.isArray(data.agents) ? data.agents : []) as AgentRec[]
  const live = new Set(liveAgentIds)
  const projectName = new Map(projects.map(p => [p.id, p.name || '']))
  return agents.map(a => {
    const chatLive = live.has(a.id)
    return {
      agentId: a.id,
      agent: a.name || '',
      projectId: a.projectId || '',
      project: projectName.get(a.projectId || '') || '',
      role: a.role || a.department || '',
      note: a.note || '',
      chatLive,
      activity: !chatLive ? 'off' : activityOf(a.id) === 'working' ? 'working' : 'waiting',
      updatedAt: updatedOf(a.id)
    }
  })
}

export type ResolveResult =
  | { ok: true; row: AgentRow }
  | { ok: false; error: 'missing_target' | 'not_found' | 'ambiguous'; candidates: AgentRow[] }

/**
 * Exact matching only (case-sensitive name equality, or the agentId).
 * Anything else returns candidates for the caller to choose from — a
 * message typed into the wrong agent's chat is worse than a question.
 */
export function resolveAgent(
  rows: AgentRow[],
  target: { agentId?: string; project?: string; agent?: string }
): ResolveResult {
  if (target.agentId) {
    const row = rows.find(r => r.agentId === target.agentId)
    return row ? { ok: true, row } : { ok: false, error: 'not_found', candidates: [] }
  }
  if (!target.agent) return { ok: false, error: 'missing_target', candidates: [] }
  const byName = rows.filter(r => r.agent === target.agent)
  const hits = target.project ? byName.filter(r => r.project === target.project) : byName
  if (hits.length === 1) return { ok: true, row: hits[0] }
  if (hits.length === 0) return { ok: false, error: 'not_found', candidates: byName }
  return { ok: false, error: 'ambiguous', candidates: hits }
}

export interface TailItem {
  role: 'user' | 'assistant' | 'tool' | 'result'
  text: string
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)

/**
 * Reduce a chat log (one stream-json event per line, plus Hive's own
 * `{_direction:'stdin'}` records for what the user typed) to the last `n`
 * readable items. Streaming deltas, system events and tool results are
 * skipped; `assistant` events already carry the completed text.
 */
export function parseChatTail(lines: string[], n: number, maxChars = 4000): TailItem[] {
  const items: TailItem[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    let ev: any
    try { ev = JSON.parse(line) } catch { continue }
    if (!ev || typeof ev !== 'object') continue
    const blocks = Array.isArray(ev.message?.content) ? ev.message.content : []
    if (ev._direction === 'stdin' && ev.type === 'user') {
      const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('\n')
      if (text) items.push({ role: 'user', text: clip(text, maxChars) })
    } else if (ev.type === 'assistant' && !ev.parent_tool_use_id) {
      for (const b of blocks) {
        if (b?.type === 'text' && b.text) items.push({ role: 'assistant', text: clip(String(b.text), maxChars) })
        else if (b?.type === 'tool_use') {
          const input = b.input || {}
          const hint = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? input.url ?? ''
          items.push({ role: 'tool', text: clip(`${b.name}${hint ? ' · ' + String(hint).replace(/\s+/g, ' ') : ''}`, 200) })
        }
      }
    } else if (ev.type === 'result') {
      const ok = ev.subtype === 'success' && !ev.is_error
      const cost = typeof ev.total_cost_usd === 'number' ? ` · $${ev.total_cost_usd.toFixed(2)}` : ''
      const dur = typeof ev.duration_ms === 'number' ? ` · ${Math.round(ev.duration_ms / 1000)}s` : ''
      items.push({ role: 'result', text: `${ok ? 'turn complete' : `stopped: ${ev.subtype || 'error'}`}${cost}${dur}` })
    }
  }
  return items.slice(-Math.max(1, n))
}

/** Newest `chat-<agentId>-<startedAt>.jsonl` for this exact agent id. */
export function latestChatLogPath(logDir: string, agentId: string): string | null {
  if (!existsSync(logDir)) return null
  const prefix = `chat-${agentId}-`
  let best: { ts: number; name: string } | null = null
  for (const name of readdirSync(logDir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue
    const ts = Number(name.slice(prefix.length, -'.jsonl'.length))
    if (!Number.isFinite(ts)) continue
    if (!best || ts > best.ts) best = { ts, name }
  }
  return best ? join(logDir, best.name) : null
}

export type StartMode = 'resume' | 'new'

export function parseStartMode(v: unknown): StartMode | null {
  if (v === undefined || v === null || v === 'resume') return 'resume'
  return v === 'new' ? 'new' : null
}

export interface PendingAgent { agentId: string; agent: string; project: string; state: 'waiting' | 'question' | 'permission'; since: number; text: string }
export interface PendingReport {
  ok: true
  agents: PendingAgent[]
  approvals: { count: number; titles: string[] }
  routinesFailed: { id: string; name: string; at: number; error: string }[]
}

/**
 * What waits for the owner (./hive pending): agents waiting on them or asking
 * permission, pending approvals, routines that failed today. Waits of agents
 * that are no longer listed are dropped (exact agentId only).
 */
export function buildPending(input: {
  waits: { agentId: string; state: PendingAgent['state']; since: number; text: string }[]
  rows: AgentRow[]
  approvals: { title: string }[]
  lastRuns: Record<string, { at: number; ok: boolean; error?: string } | undefined>
  routineName: (id: string) => string
  dayStart: number
}): PendingReport {
  const byId = new Map(input.rows.map(r => [r.agentId, r]))
  const agents: PendingAgent[] = []
  for (const w of input.waits) {
    const r = byId.get(w.agentId)
    if (r) agents.push({ agentId: w.agentId, agent: r.agent, project: r.project, state: w.state, since: w.since, text: w.text })
  }
  const routinesFailed = Object.entries(input.lastRuns)
    .filter(([, rec]) => rec && !rec.ok && rec.at >= input.dayStart)
    .map(([id, rec]) => ({ id, name: input.routineName(id), at: rec!.at, error: rec!.error || 'failed' }))
  return {
    ok: true,
    agents,
    approvals: { count: input.approvals.length, titles: input.approvals.map(a => a.title) },
    routinesFailed
  }
}
