// Jira writes Butler makes for the owner — only ever after the owner approved a
// card (or, in handle-jira, the one clear-cut case). Hive calls the owner's own
// Jira MCP server (e.g. stargate) itself, with the owner's own credentials from
// ~/.claude.json: the model never holds a write tool for this.

import { createMcpClient, type HttpServer } from './mcpHttp'
import { httpServers, readToolCache } from './butlerTools'
import type { Approval } from './approvals'

export const JIRA_FIX_KIND = 'jira.fix'
const KEY = /^(?:FAE|P4|LFCS|OUTLET)-\d+$/

export interface JiraFix { key: string; to: string; why: string; via?: string[] }
type Call = (tool: string, args: Record<string, unknown>) => Promise<string>

/** The owner's Jira server that can write (discovered tools), with its own URL and headers. */
export function jiraWriteServer(butlerFolder: string, claudeJsonPath: string): { name: string; server: HttpServer } | null {
  const servers = httpServers(claudeJsonPath)
  for (const [name, tools] of Object.entries(readToolCache(butlerFolder).servers)) {
    if (tools.includes('jira_transition_issue') && servers[name]) return { name, server: servers[name] }
  }
  return null
}

const parse = (text: string): any => { try { return JSON.parse(text) } catch { return null } }

/** Move an issue to `to`, through `via` statuses first when Jira cannot skip steps.
 *  The comment goes with the last step. Returns the steps taken. */
export async function transitionTo(call: Call, key: string, to: string, comment: string, via: string[] = []): Promise<{ ok: true; steps: string[] } | { ok: false; error: string; steps: string[] }> {
  if (!KEY.test(key)) return { ok: false, error: 'bad_key', steps: [] }
  const steps: string[] = []
  for (const target of [...via, to]) {
    const list = parse(await call('jira_get_transitions', { issue_key: key }))
    const ts: any[] = list?.transitions ?? []
    const t = ts.find(x => x?.to?.name === target) ?? ts.find(x => x?.name === target)
    if (!t) {
      // Already past this step (or at it): only the final target must be reachable.
      if (target !== to) continue
      return { ok: false, error: `no transition to "${to}" from the current status`, steps }
    }
    await call('jira_transition_issue', { issue_key: key, transition_id: String(t.id), comment: target === to ? comment : '' })
    steps.push(target)
  }
  return { ok: true, steps }
}

export function jiraFixApproval(fix: JiraFix, context: string): Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'> {
  return {
    kind: JIRA_FIX_KIND,
    title: `${fix.key} → ${fix.to}`,
    subtitle: `Jira status · ${fix.why}${context ? ` · ${context}` : ''}`.slice(0, 160),
    draft: `${fix.why} (Hive Butler, approved by the owner)`,
    payload: { key: fix.key, to: fix.to, why: fix.why, via: fix.via ?? [] },
    action: 'Apply'
  }
}

/** Register the executor: the card's text becomes the transition comment. */
export function registerJiraActions(approvals: { register: (kind: string, exec: (item: Approval) => Promise<{ ok: boolean; error?: string }>) => void }, client: () => Call | null) {
  approvals.register(JIRA_FIX_KIND, async item => {
    const p = item.payload as { key?: unknown; to?: unknown; via?: unknown }
    if (typeof p.key !== 'string' || typeof p.to !== 'string') return { ok: false, error: 'bad_payload' }
    const call = client()
    if (!call) return { ok: false, error: 'no Jira server with write tools (check Butler tools)' }
    const via = Array.isArray(p.via) ? p.via.filter((x): x is string => typeof x === 'string') : []
    try {
      const r = await transitionTo(call, p.key, p.to, item.draft.trim(), via)
      return r.ok ? { ok: true } : { ok: false, error: r.error }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

/** A Call over MCP for the owner's Jira server, or null. */
export function jiraCaller(butlerFolder: string, claudeJsonPath: string): Call | null {
  const w = jiraWriteServer(butlerFolder, claudeJsonPath)
  if (!w) return null
  const c = createMcpClient(w.server)
  return (tool, args) => c.callTool(tool, args)
}
