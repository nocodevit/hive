// Which MCP tools Butler's claude runs may use for Jira and company knowledge.
//
// Detected from the owner's Claude config: the user-level ~/.claude.json
// (top-level and the Butler folder's project entry) and <butler>/.mcp.json.
// Answers and checks get read-only tools only: a Feishu message or a Jira
// comment is untrusted input. Writes (comment, transition, create, assign)
// are never handed to the model; Hive makes them after the owner approves.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** The owner's own additions to the Butler allow-list (<butler>/allow-list.json → {"allow": [...]}). */
export function ownerAllow(butlerFolder: string): string[] {
  const j = readJson(join(butlerFolder, 'allow-list.json'))
  const list: unknown[] = Array.isArray(j?.allow) ? j.allow : []
  return Array.from(new Set(list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 200).map(x => x.trim())))
}

export interface ToolSet {
  /** The MCP server Jira comes from. */
  server: string
  /** --allowedTools entries for a read-only run. */
  read: string[]
}

const keys = (o: unknown): string[] => (o && typeof o === 'object' ? Object.keys(o) : [])
const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

/** MCP server names visible to a claude run in the Butler folder. */
export function mcpServerNames(butlerFolder: string, claudeJsonPath: string): string[] {
  const user = readJson(claudeJsonPath)
  const local = readJson(join(butlerFolder, '.mcp.json'))
  return Array.from(new Set([
    ...keys(user?.mcpServers),
    ...keys(user?.projects?.[butlerFolder]?.mcpServers),
    ...keys(local?.mcpServers)
  ]))
}

/** Jira tools for Butler, or null when no Jira server is set up. A server whose
 *  discovered tools include jira_search gets exactly its read tools; a plain
 *  "jira" / "atlassian" server not discovered yet is allowed whole (as before). */
export function jiraTools(butlerFolder: string, claudeJsonPath: string): ToolSet | null {
  for (const [server, tools] of Object.entries(readToolCache(butlerFolder).servers)) {
    if (tools.includes('jira_search')) return { server, read: tools.filter(isReadTool).map(t => `mcp__${server}__${t}`) }
  }
  const names = mcpServerNames(butlerFolder, claudeJsonPath)
  for (const k of ['jira', 'atlassian']) if (names.includes(k)) return { server: k, read: [`mcp__${k}`] }
  return null
}

/** ~/.claude.json, or $CLAUDE_CONFIG_DIR/.claude.json. */
export function claudeJsonPath(home: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')
}

// ── Fit the allow-list to what this owner's servers offer ────────────────

/** Name words, whole words only. The first one in a tool name decides: get_link_types
 *  reads (get), add_comment writes (add). A name with neither is treated as a write. */
const READ_WORDS = new Set(('get search list read query find resolve describe locate check count summarize stats health matrix how guide ' +
  'preview who whoami scope top metric metrics status first lookup download analyze analysis impact relation context report overview ' +
  'topics lag alarms vulns changes changelogs summary nodes pods instances ask card bill cdr fetch cost').split(' '))
const WRITE_WORDS = new Set(('create update delete remove add append write insert upload transition approve unapprove close reopen link ' +
  'edit submit cancel trigger rebuild replay migrate ingest send set assign move share trash copy attribute gen delta full wait plan ' +
  'snapshot diff export').split(' '))

export function isReadTool(name: string): boolean {
  const words = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[_-]/).filter(Boolean)
  for (const w of words) {
    if (WRITE_WORDS.has(w)) return false
    if (READ_WORDS.has(w)) return true
  }
  return false
}

/** Jira writes handle-jira may use (after the owner approves, or the one automatic case). */
export const JIRA_WRITE_TOOLS = ['jira_add_comment', 'jira_transition_issue', 'jira_create_issue', 'jira_update_issue', 'jira_create_issue_link', 'jira_add_watcher']

/** Allow-list entries for one MCP server from the tools it really offers. */
export function allowFromTools(server: string, tools: string[]): string[] {
  const reads = tools.filter(isReadTool)
  const writes = tools.filter(t => JIRA_WRITE_TOOLS.includes(t))
  return [...reads, ...writes].map(t => `mcp__${server}__${t}`)
}

// ── Discovered tools (per owner) ─────────────────────────────────────────

export interface ToolCache { at: number; servers: Record<string, string[]> }
const cachePath = (folder: string) => join(folder, 'tools-cache.json')

export function readToolCache(folder: string): ToolCache {
  const j = readJson(cachePath(folder))
  const servers: Record<string, string[]> = {}
  if (j && typeof j.servers === 'object' && j.servers) for (const [k, v] of Object.entries(j.servers)) if (Array.isArray(v)) servers[k] = v.filter((x): x is string => typeof x === 'string')
  return { at: typeof j?.at === 'number' ? j.at : 0, servers }
}

/** Allow-list entries from every discovered server. */
export function discoveredAllow(folder: string): string[] {
  return Object.entries(readToolCache(folder).servers).flatMap(([server, tools]) => allowFromTools(server, tools))
}

/** Every discovered tool that writes (switched off where nothing may change). */
export function discoveredWrites(folder: string): string[] {
  return Object.entries(readToolCache(folder).servers).flatMap(([server, tools]) => tools.filter(t => !isReadTool(t)).map(t => `mcp__${server}__${t}`))
}

/** The HTTP MCP servers in the owner's ~/.claude.json, with their own headers. */
export function httpServers(claudeJsonPath: string): Record<string, { url: string; headers: Record<string, string> }> {
  const out: Record<string, { url: string; headers: Record<string, string> }> = {}
  const j = readJson(claudeJsonPath)
  for (const [k, v] of Object.entries((j?.mcpServers ?? {}) as Record<string, any>)) {
    if (v && typeof v.url === 'string' && v.type !== 'sse' && v.type !== 'stdio') {
      out[k] = { url: v.url, headers: v.headers && typeof v.headers === 'object' ? v.headers : {} }
    }
  }
  return out
}

/** Ask each HTTP server which tools this owner has; a server that does not answer keeps its last list. */
export async function discoverTools(folder: string, claudeJsonPath: string, list: (s: { url: string; headers: Record<string, string> }) => Promise<string[]>, now = Date.now()): Promise<ToolCache> {
  const prev = readToolCache(folder)
  const servers: Record<string, string[]> = {}
  for (const [name, s] of Object.entries(httpServers(claudeJsonPath))) {
    try { servers[name] = await list(s) } catch { if (prev.servers[name]) servers[name] = prev.servers[name] }
  }
  const cache = { at: now, servers }
  // Never creates the Butler folder: Butler off means nothing is written.
  if (existsSync(folder)) writeFileSync(cachePath(folder), JSON.stringify(cache, null, 2) + '\n')
  return cache
}
