// Jira over its REST API (v2), for owners without a Jira MCP server, or as
// the fallback when it is down. Speaks the same tool names and arguments as
// the MCP (jira_search, jira_get_issue …) and returns Jira's own JSON, so
// handle-jira and the approval executors run unchanged on either.
//
// Connection settings live in <butler>/jira-connection.json; the token is
// encrypted with the OS keychain (safeStorage) in <butler>/jira-token.bin.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { jiraCaller } from './butlerJira'

export type Call = (tool: string, args: Record<string, unknown>) => Promise<string>
export type JiraMode = 'auto' | 'mcp' | 'rest'

export interface JiraConnection {
  /** auto = Stargate / MCP when it has Jira, else direct REST. */
  mode: JiraMode
  /** Jira's base URL, e.g. https://jira.example.com (Server/DC) or https://x.atlassian.net (Cloud). */
  url: string
  /** Cloud only: the account email (Basic auth with an API token). Empty = Server/DC personal access token. */
  email: string
}

export interface TokenCrypto { encrypt(s: string): Buffer; decrypt(b: Buffer): string }

const CONN_FILE = 'jira-connection.json'
const TOKEN_FILE = 'jira-token.bin'

/** https://host[:port][/context], no trailing slash; null when it is not a web address. */
export function normalizeJiraUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const path = u.pathname.replace(/\/(browse|secure|projects)\/.*$/, '').replace(/\/+$/, '')
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return null
  }
}

export function normalizeConnection(raw: unknown): JiraConnection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mode: JiraMode = r.mode === 'mcp' || r.mode === 'rest' ? r.mode : 'auto'
  const email = typeof r.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(r.email.trim()) ? r.email.trim() : ''
  return { mode, url: normalizeJiraUrl(r.url) ?? '', email }
}

export function readConnection(folder: string): JiraConnection {
  try { return normalizeConnection(JSON.parse(readFileSync(join(folder, CONN_FILE), 'utf8'))) } catch { return normalizeConnection({}) }
}

export function createJiraConnectionStore(folder: string, crypto: TokenCrypto) {
  const tokenPath = join(folder, TOKEN_FILE)
  return {
    read: () => readConnection(folder),
    hasToken: () => existsSync(tokenPath),
    token(): string | null {
      try { return crypto.decrypt(readFileSync(tokenPath)) } catch { return null }
    },
    /** Saves the settings; a non-empty token replaces the stored one, null removes it. */
    save(raw: unknown, token?: string | null): JiraConnection {
      const c = normalizeConnection(raw)
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, CONN_FILE), JSON.stringify(c, null, 2) + '\n')
      if (typeof token === 'string' && token.trim()) writeFileSync(tokenPath, crypto.encrypt(token.trim()), { mode: 0o600 })
      if (token === null) { try { unlinkSync(tokenPath) } catch { /* none */ } }
      return c
    }
  }
}
export type JiraConnectionStore = ReturnType<typeof createJiraConnectionStore>

export function authHeader(email: string, token: string): string {
  return email ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` : `Bearer ${token}`
}

const KEY = /^[A-Z][A-Z0-9]+-\d+$/
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** Direct REST client behind the MCP tool names Butler's code uses. */
export function createJiraRestCaller(conn: Pick<JiraConnection, 'url' | 'email'>, token: string, fetchImpl: typeof fetch = fetch): Call {
  const base = `${conn.url}/rest/api/2`
  const req = async (method: string, path: string, body?: unknown): Promise<string> => {
    const r = await fetchImpl(base + path, {
      method,
      headers: { Authorization: authHeader(conn.email, token), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`Jira ${r.status}: ${text.slice(0, 200)}`)
    return text || '{}'
  }
  const issue = (args: Record<string, unknown>) => {
    const key = str(args.issue_key)
    if (!KEY.test(key)) throw new Error(`bad issue key "${key}"`)
    return encodeURIComponent(key)
  }
  return async (tool, args) => {
    switch (tool) {
      case 'jira_get_user_profile': return req('GET', '/myself')
      case 'jira_search': {
        const q = new URLSearchParams({ jql: str(args.jql), maxResults: str(args.max_results || 50), startAt: str(args.start_at || 0) })
        if (args.fields) q.set('fields', str(args.fields))
        return req('GET', `/search?${q}`)
      }
      case 'jira_get_issue': {
        const q = new URLSearchParams()
        if (args.fields) q.set('fields', str(args.fields))
        if (args.expand) q.set('expand', str(args.expand))
        return req('GET', `/issue/${issue(args)}${q.size ? `?${q}` : ''}`)
      }
      case 'jira_get_transitions': return req('GET', `/issue/${issue(args)}/transitions`)
      case 'jira_transition_issue': {
        const comment = str(args.comment).trim()
        await req('POST', `/issue/${issue(args)}/transitions`, {
          transition: { id: str(args.transition_id) },
          ...(comment ? { update: { comment: [{ add: { body: comment } }] } } : {})
        })
        return '{"ok":true}'
      }
      case 'jira_add_comment': return req('POST', `/issue/${issue(args)}/comment`, { body: str(args.comment) })
      case 'jira_update_issue': {
        if (args.assignee === undefined) throw new Error('jira_update_issue: only assignee is supported over REST')
        const user = str(args.assignee)
        // Cloud names people by accountId, Server/DC by username.
        await req('PUT', `/issue/${issue(args)}/assignee`, conn.email ? { accountId: user } : { name: user })
        return '{"ok":true}'
      }
      default: throw new Error(`${tool} is not available over Jira REST`)
    }
  }
}

/** The Jira Butler uses: Stargate/MCP or direct REST, as the owner chose (auto = MCP first). */
export function butlerJiraCall(folder: string, claudeJsonPath: string, store: Pick<JiraConnectionStore, 'read' | 'token'>, fetchImpl?: typeof fetch): { call: Call; via: 'mcp' | 'rest' } | null {
  const conn = store.read()
  const mcp = conn.mode === 'rest' ? null : jiraCaller(folder, claudeJsonPath)
  if (mcp) return { call: mcp, via: 'mcp' }
  if (conn.mode === 'mcp' || !conn.url) return null
  const token = store.token()
  return token ? { call: createJiraRestCaller(conn, token, fetchImpl), via: 'rest' } : null
}
