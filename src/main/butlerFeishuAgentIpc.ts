// IPC + runtime wiring for Feishu answer-for-me (feishuAgent.ts) and the
// day agenda (calendar.ts). index.ts calls each register function once.

import { execFile } from 'child_process'
import { DISALLOWED_TOOLS } from './butlerClaude'
import { STARGATE_JIRA_WRITE } from './butlerTools'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { Notification, type IpcMain } from 'electron'
import { createFeishuAgent, LOCKED_TOPICS, defaultPrefix, holdingReply, type FeishuAgentSettings } from './feishuAgent'
import { createCalendar, type Exec } from './calendar'
import type { ButlerProfile } from './butlerProfile'
import type { Approvals } from './approvals'
import type { AgentRow, TailItem } from './butlerApi'
import type { FeishuStatus } from './feishuAuth'

interface FeishuLike {
  accessToken: () => Promise<{ ok: boolean; token?: string; error?: string }>
  getStatus: () => FeishuStatus
}

const CLAUDE_TIMEOUT_MS = 180_000

async function feishuHttp(method: 'GET' | 'POST' | 'DELETE', url: string, token: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

/** Agents' status + their last assistant line, for the answer prompt. */
export function agentsContext(rows: AgentRow[], tail: (agentId: string) => TailItem[]): string {
  return rows.map(r => {
    let last = ''
    try { last = tail(r.agentId).filter(i => i.role === 'assistant').map(i => i.text).pop() ?? '' } catch { /* unreadable log */ }
    const head = `- ${r.agent || r.agentId}${r.project ? ` (${r.project})` : ''} · ${r.activity}${r.note ? ` · ${r.note}` : ''}`
    return last ? `${head}\n  latest: ${last.replace(/\s+/g, ' ').slice(0, 300)}` : head
  }).join('\n')
}

export interface FeishuAgentIpcDeps {
  ipcMain: IpcMain
  butlerDir: string
  feishu: FeishuLike
  approvals: Approvals
  claudeBin: () => string
  readProfile: (dir: string) => ButlerProfile
  agents: () => AgentRow[]
  tail: (agentId: string) => TailItem[]
  notify?: (title: string, body: string) => void
  broadcast: (channel: string, payload: unknown) => void
}

/** answer-feishu run: the Butler allow-list (dontAsk), minus anything that writes —
 *  the message being answered comes from someone else. */
export function feishuAnswerArgs(prompt: string): string[] {
  return ['-p', prompt, '--output-format', 'text', '--permission-mode', 'dontAsk', '--disallowedTools', [...DISALLOWED_TOOLS, ...STARGATE_JIRA_WRITE].join(',')]
}

export function registerButlerFeishuAgentIpc(d: FeishuAgentIpcDeps) {
  const runClaude = (prompt: string) => new Promise<string>((resolve, reject) => {
    execFile(d.claudeBin(), feishuAnswerArgs(prompt),
      { cwd: d.butlerDir, timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: process.env },
      (err, stdout) => (err && !stdout ? reject(err) : resolve(String(stdout))))
  })
  const agent = createFeishuAgent({
    dir: d.butlerDir,
    http: feishuHttp,
    token: () => d.feishu.accessToken(),
    selfOpenId: () => { const s = d.feishu.getStatus(); return s.state === 'signed_in' && s.openId ? s.openId : null },
    profile: () => d.readProfile(d.butlerDir),
    profileMd: () => { try { return readFileSync(join(d.butlerDir, 'profile.md'), 'utf8') } catch { return '' } },
    runClaude,
    approvals: d.approvals,
    notify: d.notify ?? ((title, body) => { try { new Notification({ title, body }).show() } catch { /* no notification center */ } }),
    context: () => agentsContext(d.agents(), d.tail),
    onChange: () => d.broadcast('feishuAgent:changed', null)
  })
  agent.start()

  const view = () => {
    const st = d.feishu.getStatus()
    const profile = d.readProfile(d.butlerDir)
    return {
      settings: agent.getSettings(),
      prefix: agent.prefix(),
      defaultPrefix: defaultPrefix(profile),
      holding: holdingReply(profile.name),
      connected: st.state === 'signed_in',
      locked: LOCKED_TOPICS.map(({ id, label, hint, example }) => ({ id, label, hint, example })),
      senders: agent.senders(),
      lastError: agent.lastError(),
      capabilities: { realtime: false }
    }
  }

  d.ipcMain.handle('feishuAgent:get', () => view())
  d.ipcMain.handle('feishuAgent:set', (_e, patch: unknown) => {
    agent.setSettings((patch && typeof patch === 'object' ? patch : {}) as Partial<FeishuAgentSettings>)
    return view()
  })
  d.ipcMain.handle('feishuAgent:log', () => agent.log(20))
  d.ipcMain.handle('feishuAgent:recall', (_e, id: unknown) => typeof id === 'string' ? agent.recall(id) : { ok: false, error: 'bad_id' })
  return agent
}

export interface CalendarIpcDeps {
  ipcMain: IpcMain
  butlerDir: string
  feishu: FeishuLike
  /** Candidate paths of the hive-calendar binary (dev, packaged). */
  helperCandidates: string[]
  exec?: Exec
}

const defaultExec: Exec = (file, args) => new Promise(resolve => {
  execFile(file, args, { timeout: 130_000 }, (err, stdout) => {
    const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0
    resolve({ code, stdout: String(stdout ?? '') })
  })
})

export function registerButlerCalendarIpc(d: CalendarIpcDeps) {
  const calendar = createCalendar({
    dir: d.butlerDir,
    feishuToken: () => d.feishu.accessToken(),
    get: (url, token) => feishuHttp('GET', url, token),
    helperPath: () => d.helperCandidates.find(p => existsSync(p)) ?? null,
    exec: d.exec ?? defaultExec
  })
  d.ipcMain.handle('calendar:get', () => calendar.getSettings())
  d.ipcMain.handle('calendar:set', (_e, patch: unknown) => calendar.setSettings((patch && typeof patch === 'object' ? patch : {}) as any))
  d.ipcMain.handle('calendar:allowMac', async () => {
    const r = await calendar.requestMacAccess()
    if (r.granted) calendar.setSettings({ mac: true })
    return r
  })
  d.ipcMain.handle('calendar:agenda', (_e, date: unknown) => {
    const d0 = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date()
    return calendar.getDayAgenda(d0)
  })
  return calendar
}

