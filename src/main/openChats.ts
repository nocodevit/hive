// Which agents' chats were open when Hive last stopped — so the next
// launch can offer to resume exactly those, and nothing else.
//
// A record is added when a chat's claude process starts and removed when
// the chat really ends (the user closes it, it is stopped, or its process
// exits by itself). Quitting Hive — or Hive crashing — removes nothing,
// which is the point: whatever is still listed at startup was running
// when the app went away.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface OpenChat { agentId: string; cwd: string; since: number }

const FILE = 'open-chats.json'

export function readOpenChats(dataDir: string): OpenChat[] {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, FILE), 'utf-8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(r => r && typeof r.agentId === 'string' && r.agentId)
      .map(r => ({ agentId: r.agentId, cwd: typeof r.cwd === 'string' ? r.cwd : '', since: Number(r.since) || 0 }))
  } catch {
    return []
  }
}

export function writeOpenChats(dataDir: string, list: OpenChat[]): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, FILE), JSON.stringify(list, null, 2) + '\n')
}

export function addOpenChat(dataDir: string, rec: OpenChat): void {
  writeOpenChats(dataDir, [...readOpenChats(dataDir).filter(r => r.agentId !== rec.agentId), rec])
}

export function removeOpenChat(dataDir: string, agentId: string): void {
  const list = readOpenChats(dataDir)
  if (list.some(r => r.agentId === agentId)) writeOpenChats(dataDir, list.filter(r => r.agentId !== agentId))
}

/** The last thing the user typed into a chat, from its Hive log lines. */
export function lastUserText(lines: string[], maxChars = 240): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"_direction":"stdin"')) continue
    let ev: any
    try { ev = JSON.parse(line) } catch { continue }
    if (ev?._direction !== 'stdin' || ev.type !== 'user') continue
    const blocks = Array.isArray(ev.message?.content) ? ev.message.content : []
    const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join(' ').replace(/\s+/g, ' ').trim()
    if (text) return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
  }
  return ''
}

export interface UnclosedRow {
  agentId: string
  agent: string
  project: string
  lastTask: string
  lastActiveMs: number
  contextSize: string
  peakInputTokens: number
  hasSession: boolean
}

export interface UnclosedDetail { lastTask: string; lastActiveMs: number; contextSize: string; peakInputTokens: number; hasSession: boolean }

/**
 * Rows for the "resume from last time?" prompt: every recorded chat whose
 * agent still exists and is not already running again, grouped by project.
 */
export function buildUnclosedRows(
  data: { projects?: unknown; agents?: unknown },
  open: OpenChat[],
  liveAgentIds: Iterable<string>,
  detailOf: (rec: OpenChat) => UnclosedDetail
): UnclosedRow[] {
  const agents = (Array.isArray(data.agents) ? data.agents : []) as Array<{ id: string; name?: string; projectId?: string }>
  const projects = (Array.isArray(data.projects) ? data.projects : []) as Array<{ id: string; name?: string }>
  const live = new Set(liveAgentIds)
  const byId = new Map(agents.map(a => [a.id, a]))
  const projectName = new Map(projects.map(p => [p.id, p.name || '']))
  const rows: UnclosedRow[] = []
  for (const rec of open) {
    const agent = byId.get(rec.agentId)
    if (!agent || live.has(rec.agentId)) continue
    rows.push({
      agentId: rec.agentId,
      agent: agent.name || '',
      project: projectName.get(agent.projectId || '') || '',
      ...detailOf(rec)
    })
  }
  return rows.sort((a, b) => a.project.localeCompare(b.project) || a.agent.localeCompare(b.agent))
}
