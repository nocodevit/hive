// Which MCP tools Butler's claude runs may use for Jira and company knowledge.
//
// Detected from the owner's Claude config: the user-level ~/.claude.json
// (top-level and the Butler folder's project entry) and <butler>/.mcp.json.
// Answers and checks get read-only tools only: a Feishu message or a Jira
// comment is untrusted input. Writes (comment, transition, create, assign)
// are never handed to the model; Hive makes them after the owner approves.

import { readFileSync } from 'fs'
import { join } from 'path'

/** Read-only tools of the stargate gateway (Jira, knowledge graph, RAG, Feishu docs). */
export const STARGATE_READ = [
  'jira_search', 'jira_get_issue', 'jira_get_comments', 'jira_get_transitions', 'jira_get_project_versions',
  'jira_get_agile_boards', 'jira_get_sprints_from_board', 'jira_get_sprint_issues', 'jira_get_user_profile',
  'jira_get_link_types', 'jira_search_fields',
  'kg_rag_search', 'kg_query_context', 'kg_concept_search',
  'feishu_search_wiki', 'feishu_read_document'
].map(t => `mcp__stargate__${t}`)

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

/** Jira tools for Butler, or null when no Jira server is set up. stargate is
 *  narrowed to its read-only tools; a plain "jira" / "atlassian" server's tool
 *  names are unknown, so the whole server is allowed (as before). */
export function jiraTools(butlerFolder: string, claudeJsonPath: string): ToolSet | null {
  const names = mcpServerNames(butlerFolder, claudeJsonPath)
  if (names.includes('stargate')) return { server: 'stargate', read: STARGATE_READ }
  for (const k of ['jira', 'atlassian']) if (names.includes(k)) return { server: k, read: [`mcp__${k}`] }
  return null
}

/** ~/.claude.json, or $CLAUDE_CONFIG_DIR/.claude.json. */
export function claudeJsonPath(home: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')
}
