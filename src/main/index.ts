import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, statSync, lstatSync } from 'fs'
import { createServer } from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as pty from 'node-pty'
import { execSync, execFileSync, spawn } from 'child_process'
import { isHeadlessMode } from './headless'

// GUI apps launched from Finder/Dock inherit launchd's minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so spawn('claude') ENOENTs even though
// the binary exists in nvm/Homebrew. Terminal panels work because they go
// through `pty.spawn('zsh', ['-l'])`, but Chat panels call spawn directly
// and would silently fail (chat:error has no renderer listener). Hydrate
// process.env.PATH from the user's rc files once at boot.
//
// Implementation notes:
//   - `-i` (interactive) requires a controlling TTY; in launchd context
//     it exits non-zero, throws, and we'd silently fall back to launchd
//     PATH. So we use `-c` and source rc files explicitly.
//   - rc-file output (oh-my-zsh banners, nvm completion that prints help
//     when sourced wrong, etc.) is redirected to /dev/null so PATH stdout
//     stays clean.
//   - We accept the result only if it looks like a PATH (starts with `/`
//     and contains `:`) to defend against any remaining stdout pollution.
;(function hydratePathFromShell() {
  // GUI launch (Finder/Dock) inherits a minimal PATH; nvm/homebrew/~/.local/bin
  // live behind the user's shell rc. Try interactive-login first so an rc with
  // an `[[ -o interactive ]] || return` guard still runs nvm (otherwise claude,
  // which lives in an nvm node bin, stays invisible and the install gate fires
  // a false "not found"). See pathHydrationStrategies for the ordered fallbacks.
  const shell = process.env.SHELL || '/bin/zsh'
  for (const { file, args } of pathHydrationStrategies(shell)) {
    try {
      const out = execFileSync(file, args, { encoding: 'utf-8', timeout: 7000 })
      const path = pickPathLine(out)
      if (path) {
        process.env.PATH = path
        return
      }
    } catch {
      // Try the next strategy. If all fail, leave PATH alone; user can
      // launchctl setenv or symlink as a fallback. Not worth a boot dialog.
    }
  }
})()

import { createTask, readTask, updateTask, listTasks } from './tasks'
import { runGate } from './gate'
import { getManagerSoulAddendum, getWorkerSoulAddendum, getQaSoulAddendum, getCriticSoulAddendum } from './souls'
import { findTaskGroupForAgentInData, findAgentCwd, formatHiveMessage } from './helpers'
import { isSubagentActiveForCwd } from './subagent-activity'
import { generateReportScript } from './utils'
import { registerChatIpc } from './chat'
import { registerStorageIpc } from './storage'
import { parsePsRows, hasClaudeDescendant } from './ptyProcessTree'
import {
  CLAUDE_INSTALL_COMMAND,
  claudeStatus,
  pickPathLine,
  pathHydrationStrategies,
  claudeProbeStrategies,
  type ClaudeStatus
} from './claude-env'

// Data persistence — HIVE_DATA_DIR env allows E2E tests to use isolated directory
const DATA_DIR = process.env.HIVE_DATA_DIR || join(app.getPath('home'), '.hive')
const DATA_FILE = join(DATA_DIR, 'data.json')

// Crash log — append-only JSONL at ~/.hive/crash-log.jsonl. Captures:
//   - main process uncaught exceptions / unhandled promise rejections
//   - renderer process gone (crash, hang, oom-killed)
//   - child process gone (utility/gpu/network helper crashes)
//   - explicit IPC report from renderer ErrorBoundary
// Without this, Hive crashes have no observable trace — stderr is /dev/null
// in a packaged .app, and macOS only writes DiagnosticReports for native
// crashes (not JS throws). Every entry has ts + kind + a stack/details
// blob; tail the file after a crash to see what blew up.
function writeCrashLog(kind: string, info: Record<string, unknown>) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    appendFileSync(join(DATA_DIR, 'crash-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), kind, ...info }) + '\n')
  } catch {
    // Last-ditch fallback — crash logging itself failed. Nothing left to do.
  }
}

process.on('uncaughtException', (err) => {
  writeCrashLog('main-uncaught-exception', {
    message: err?.message,
    stack: err?.stack,
    name: err?.name
  })
})
process.on('unhandledRejection', (reason) => {
  // `reason` is `unknown` per Node's signature. Cast to `any` to read
  // .message/.stack for the common Error-like case; String(reason) is
  // the fallback when reason is a plain value (e.g. throw 'oops').
  writeCrashLog('main-unhandled-rejection', {
    message: (reason as any)?.message || String(reason),
    stack: (reason as any)?.stack
  })
})

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadData(): Record<string, unknown> {
  ensureDataDir()
  if (!existsSync(DATA_FILE)) return { projects: [], agents: [] }
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
}

function saveData(data: Record<string, unknown>) {
  ensureDataDir()
  // Backup before overwrite
  const bakFile = DATA_FILE + '.bak'
  try { if (existsSync(DATA_FILE)) writeFileSync(bakFile, readFileSync(DATA_FILE)) } catch {}
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

const terminals: Map<string, pty.IPty> = new Map()
const HIVE_PORT = parseInt(process.env.HIVE_PORT || '17710', 10)

// 5-hour limit whip: track agents that hit usage limit (persisted)
const LIMIT_STATE_FILE = join(DATA_DIR, 'limit-state.json')
function loadLimitState(): Record<string, { resetTime: string; taskId?: string; whipScheduled?: boolean }> {
  try { if (existsSync(LIMIT_STATE_FILE)) return JSON.parse(readFileSync(LIMIT_STATE_FILE, 'utf-8')) } catch {}
  return {}
}
function saveLimitState(state: Record<string, any>) {
  try { writeFileSync(LIMIT_STATE_FILE, JSON.stringify(state)) } catch {}
}
const limitResets: Map<string, { resetTime: Date; taskId?: string; whipScheduled?: boolean }> = new Map()
// Hydrate from disk
try {
  const saved = loadLimitState()
  for (const [k, v] of Object.entries(saved)) {
    limitResets.set(k, { ...v, resetTime: new Date(v.resetTime) })
  }
} catch {}

// Work logs persistence
const LOGS_DIR = join(DATA_DIR, 'logs')

function appendLog(agentId: string, entry: { time: string; type: string; message: string }) {
  mkdirSync(LOGS_DIR, { recursive: true })
  const logFile = join(LOGS_DIR, `${agentId}.json`)
  let logs: any[] = []
  try {
    if (existsSync(logFile)) logs = JSON.parse(readFileSync(logFile, 'utf-8'))
  } catch {}
  logs.push(entry)
  // Keep last N entries (read from data.json appPrefs, default 100)
  let maxLogs = 100
  try {
    const d = loadData()
    if ((d.appPrefs as any)?.maxLogs) maxLogs = (d.appPrefs as any).maxLogs
  } catch {}
  if (logs.length > maxLogs) logs = logs.slice(-maxLogs)
  writeFileSync(logFile, JSON.stringify(logs, null, 2))
}

function loadLogs(agentId: string): any[] {
  const logFile = join(LOGS_DIR, `${agentId}.json`)
  try {
    if (existsSync(logFile)) return JSON.parse(readFileSync(logFile, 'utf-8'))
  } catch {}
  return []
}

// Track last status per agent to avoid duplicate logs
const lastAgentStatus: Map<string, string> = new Map()

// PTY injection: send [HIVE:TYPE] messages to agents
// Split content and Enter to bypass bracketed-paste mode in Claude Code CLI
// File-based message queue: write to agent's inbox (persistent, reliable)
function writeToInbox(agentId: string, type: string, payload: object): boolean {
  try {
    // Find project for this agent to determine inbox path
    const d = loadData()
    const ctx = findTaskGroupForAgentInData(agentId, (d.taskGroups || []) as any[])
    const projectId = ctx?.projectId || '_global'
    const inboxDir = join(DATA_DIR, 'comms', projectId, 'inbox')
    mkdirSync(inboxDir, { recursive: true })
    const inboxFile = join(inboxDir, `${agentId}.jsonl`)
    const entry = JSON.stringify({ time: new Date().toISOString(), type, ...payload, _read: false }) + '\n'
    appendFileSync(inboxFile, entry)
    return true
  } catch { return false }
}

// Send message to agent: write to inbox (persistent) + PTY nudge (best-effort notification)
function sendToAgent(agentId: string, type: string, payload: object): boolean {
  const written = writeToInbox(agentId, type, payload)
  // PTY nudge: short prompt telling agent to check inbox (not the actual message)
  const term = terminals.get(agentId)
  if (term) {
    term.write('[HIVE:INBOX] Check your inbox: .claude/hive-report.sh check-inbox')
    setTimeout(() => { const t = terminals.get(agentId); if (t) t.write('\r') }, 150)
  }
  return written
}

// Auto-assign next pending task to a worker after task completion
function autoAssignNext(workerId: string, projectId: string) {
  const allTasks = listTasks(DATA_DIR, projectId)
  // Find a pending task assigned to this worker (queued earlier)
  let next = allTasks.find(t => t.owner === workerId && t.status === 'pending')
  // Or find any unassigned pending task
  if (!next) next = allTasks.find(t => !t.owner && t.status === 'pending')
  if (next) {
    const updated = updateTask(DATA_DIR, projectId, next.id, { status: 'assigned', owner: workerId, assignedAt: new Date().toISOString() })
    if (updated) {
      const sent = sendToAgent(workerId, 'TASK', updated)
      dispatchLog('auto-assign', `${updated.id} → ${workerId} (PTY: ${sent})`, workerId)
      broadcastTasks(projectId)
    }
  }
}

// Check if all worker tasks in a batch are done → auto-trigger QA → then Critic
// Batch lifecycle state machine — persisted to disk
const BATCH_STATE_FILE = join(DATA_DIR, 'batch-state.json')

function loadBatchState(): Record<string, { phase: string; notifiedAt: string; retries: number }> {
  try { if (existsSync(BATCH_STATE_FILE)) return JSON.parse(readFileSync(BATCH_STATE_FILE, 'utf-8')) } catch {}
  return {}
}

function saveBatchState(state: Record<string, any>) {
  try { writeFileSync(BATCH_STATE_FILE, JSON.stringify(state, null, 2)) } catch {}
}

// Check if all worker tasks in batch are done → notify Manager (Manager decides next step)
function checkBatchComplete(projectId: string) {
  const d = loadData()
  const tgs = (d.taskGroups || []) as any[]
  const tg = tgs.find(t => t.projectId === projectId)
  if (!tg) return

  const allTasks = listTasks(DATA_DIR, projectId)
  if (allTasks.length === 0) return

  // Find the current active batch (most recent activity)
  const byBatch = new Map<number, typeof allTasks>()
  allTasks.forEach(t => { const b = t.batch || 1; if (!byBatch.has(b)) byBatch.set(b, []); byBatch.get(b)!.push(t) })
  let currentBatch = 1
  let latestTime = 0
  for (const [bNum, bTasks] of byBatch) {
    const t = Math.max(...bTasks.map(t => t.assignedAt ? new Date(t.assignedAt).getTime() : 0))
    if (t > latestTime) { latestTime = t; currentBatch = bNum }
  }

  const batchTasks = byBatch.get(currentBatch) || []
  const pending = batchTasks.filter(t => t.status === 'pending' || t.status === 'assigned' || t.status === 'in_progress')
  if (pending.length > 0) return // still working

  const done = batchTasks.filter(t => t.status === 'done').length
  const blocked = batchTasks.filter(t => t.status === 'blocked').length
  const abandoned = batchTasks.filter(t => t.status === 'abandoned').length
  if (done === 0) return // nothing done

  // Collect worker branches for Manager's reference
  const workerBranches = [...new Set(batchTasks.filter(t => t.owner).map(t => {
    const ag = ((d.agents || []) as any[]).find(a => a.id === t.owner)
    return ag?.worktreeBranch || ''
  }).filter(Boolean))]

  // State machine: track batch lifecycle
  const stateKey = `${projectId}:batch:${currentBatch}`
  const batchStates = loadBatchState()
  const existing = batchStates[stateKey]
  if (existing && existing.phase === 'notified_manager') {
    // Already notified. Check if Manager hasn't acted in 5 min → re-notify
    const elapsed = (Date.now() - new Date(existing.notifiedAt).getTime()) / 60000
    if (elapsed > 5 && existing.retries < 3) {
      sendToAgent(tg.managerId, 'MSG', {
        batch: currentBatch, status: 'batch_complete_reminder',
        message: `Reminder: Batch ${currentBatch} complete (${done}/${batchTasks.length}). Create QA task.`
      })
      batchStates[stateKey] = { phase: 'notified_manager', notifiedAt: new Date().toISOString(), retries: existing.retries + 1 }
      saveBatchState(batchStates)
      dispatchLog('batch-complete', `📋 Batch ${currentBatch}: reminder ${existing.retries + 1}/3 → Manager`, tg.managerId)
    } else if (elapsed > 5 && existing.retries >= 3) {
      // Manager not responding after 3 reminders → notify human
      notifyHuman('Manager Unresponsive', `Batch ${currentBatch} done ${Math.round(elapsed)}m ago. Manager hasn't created QA task. Please intervene.`)
      batchStates[stateKey] = { ...existing, phase: 'escalated' }
      saveBatchState(batchStates)
    }
    return
  }
  if (existing && (existing.phase === 'escalated' || existing.phase === 'qa_created')) return

  // First notification
  const sent = sendToAgent(tg.managerId, 'MSG', {
    batch: currentBatch,
    status: 'batch_complete',
    done, blocked, abandoned,
    total: batchTasks.length,
    workerBranches,
    integrationBranch: tg.targetBranch || 'staging',
    message: `Batch ${currentBatch} complete: ${done} done, ${blocked} blocked, ${abandoned} abandoned. Worker branches: ${workerBranches.join(', ')}. Create QA task when ready.`
  })
  batchStates[stateKey] = { phase: 'notified_manager', notifiedAt: new Date().toISOString(), retries: 0 }
  saveBatchState(batchStates)
  dispatchLog('batch-complete', `📋 Batch ${currentBatch}: ${done}/${batchTasks.length} done → notified Manager`, tg.managerId)
  if (!sent) {
    notifyHuman('Batch Complete', `Batch ${currentBatch} done (${done}/${batchTasks.length}). Manager offline — create QA task manually.`)
  }
}

// Broadcast task list to UI after any task mutation
function broadcastTasks(projectId: string) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    const tasks = listTasks(DATA_DIR, projectId)
    win.webContents.send('task:update', { projectId, tasks })
  }
}

// Dispatcher log: broadcast to UI + persist to disk
const DISPATCH_LOG_FILE = join(DATA_DIR, 'dispatcher-log.json')

function loadDispatchLog(): any[] {
  try {
    if (existsSync(DISPATCH_LOG_FILE)) return JSON.parse(readFileSync(DISPATCH_LOG_FILE, 'utf-8'))
  } catch {}
  return []
}

function saveDispatchLog(entries: any[]) {
  try { writeFileSync(DISPATCH_LOG_FILE, JSON.stringify(entries.slice(-500))) } catch {}
}

function dispatchLog(action: string, detail: string, agentId?: string) {
  const entry = { time: new Date().toISOString(), action, detail, agentId: agentId || null }
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('dispatcher:log', entry)
  }
  // Persist
  const logs = loadDispatchLog()
  logs.push(entry)
  saveDispatchLog(logs)
}

// Notify human: macOS + Telegram + UI
function notifyHuman(title: string, message: string) {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.send('manager:report', { title, message })
  try {
    const escaped = message.replace(/"/g, '\\"').replace(/'/g, "'")
    execSync(`osascript -e 'display notification "${escaped}" with title "Hive: ${title}" sound name "Glass"'`)
  } catch {}
  try {
    const payload = JSON.stringify({ last_assistant_message: message, cwd: process.cwd() })
    execSync(`echo '${payload.replace(/'/g, "'\\''")}' | /Users/meiyang/.claude/hooks/notify-telegram.sh`, { timeout: 5000 })
  } catch {}
}

// Lookup helpers — delegate to extracted pure functions for testability
function findTaskGroupForAgent(agentId: string): { taskGroup: any; projectId: string } | null {
  const d = loadData()
  return findTaskGroupForAgentInData(agentId, (d.taskGroups || []) as any[])
}

function findAgentWorktree(agentId: string): string | null {
  const d = loadData()
  return findAgentCwd(agentId, (d.agents || []) as any[], (d.projects || []) as any[])
}

// Status + report webhook server — receives hook calls from Claude Code
const statusServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/task-status')) {
    // GET /task-status?projectId=xxx
    const url = new URL(req.url, `http://127.0.0.1:${HIVE_PORT}`)
    const projectId = url.searchParams.get('projectId') || ''
    const homeDir = DATA_DIR
    const tasks = listTasks(homeDir, projectId)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(tasks))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(404)
    res.end()
    return
  }

  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    try {
      const data = JSON.parse(body)
      const win = BrowserWindow.getAllWindows()[0]
      const now = new Date().toISOString()

      if (req.url === '/status') {
        const prev = lastAgentStatus.get(data.agentId)
        if (prev !== data.status) {
          lastAgentStatus.set(data.agentId, data.status)
          appendLog(data.agentId, { time: now, type: 'status', message: data.status })
        }
        if (win && !win.isDestroyed()) win.webContents.send('agent:status', data)
      } else if (req.url === '/report') {
        if (data.type === 'task_start') {
          appendLog(data.agentId, { time: now, type: 'task_start', message: data.title || 'Task started' })
        } else if (data.type === 'task_done') {
          appendLog(data.agentId, { time: now, type: 'task_done', message: data.summary || 'Task completed' })
        } else if (data.type === 'notification') {
          appendLog(data.agentId, { time: now, type: 'notification', message: data.message || '' })
          // TODO: Future notification integrations
          // - macOS notification (osascript)
          // - Slack webhook
          // - Telegram bot
          // - WhatsApp Business API
        } else {
          appendLog(data.agentId, { time: now, type: 'report', message: JSON.stringify(data.items || data) })
        }
        if (win && !win.isDestroyed()) win.webContents.send('agent:report', data)
      } else if (req.url === '/task-create') {
        const homeDir = DATA_DIR
        const ctx = data.agentId ? findTaskGroupForAgent(data.agentId) : null
        const projectId = ctx?.projectId || data.projectId || ''
        // Auto-inject PR instruction if task group has targetBranch
        let note = data.note || null
        if (ctx?.taskGroup) {
          const tgData = loadData()
          const tg = ((tgData.taskGroups || []) as any[]).find(t => t.id === ctx.taskGroup.id)
          const targetBranch = tg?.targetBranch
          if (targetBranch) {
            const prInstruction = `\n\n[AUTO] 完成后: git push && gh pr create --base ${targetBranch}`
            note = note ? note + prInstruction : prInstruction.trim()
          }
        }
        const task = createTask(homeDir, projectId, {
          title: data.title, status: 'pending', owner: null,
          batch: data.batch || 1, depends: data.depends || [],
          scope: data.scope || '.', acceptance: data.acceptance || '',
          verify: data.verify || [], attempt: 0, blocked_reason: null, abandoned_reason: null, note,
          estimatedMinutes: data.estimatedMinutes || null, assignedAt: null
        })
        dispatchLog('task-create', `${task.id}: "${data.title}" in ${projectId}`, data.agentId)
        broadcastTasks(projectId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: task.id }))
        return
      } else if (req.url === '/task-assign') {
        const homeDir = DATA_DIR
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        // One task at a time per worker — queue if busy
        const allTasks = listTasks(homeDir, projectId)
        const workerBusy = allTasks.find(t => t.owner === data.agentId && (t.status === 'assigned' || t.status === 'in_progress'))
        if (workerBusy) {
          dispatchLog('task-assign', `⛔ REJECTED ${data.taskId} — busy with ${workerBusy.id}`, data.agentId)
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `Worker busy with ${workerBusy.id}`, code: 'WORKER_BUSY', busyTask: workerBusy.id }))
          return
        } else {
          const task = updateTask(homeDir, projectId, data.taskId, { status: 'assigned', owner: data.agentId, assignedAt: new Date().toISOString() })
          if (task) {
            const sent = sendToAgent(data.agentId, 'TASK', task)
            dispatchLog('task-assign', `${task.id} → ${data.agentId} (PTY: ${sent})`, data.agentId)
            appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_start', message: `${task.title} (PTY: ${sent})` })
            broadcastTasks(projectId)
          } else {
            dispatchLog('task-assign', `❌ FAILED: taskId="${data.taskId}" not found in ${projectId}`)
          }
        }
      } else if (req.url === '/task-done') {
        const homeDir = DATA_DIR
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        const task = readTask(homeDir, projectId, data.taskId)
        dispatchLog('task-done', `${data.taskId}: "${data.summary || ''}"`, data.agentId)

        const cwd = findAgentWorktree(data.agentId)
        if (task && cwd && task.scope && task.scope !== '.') {
          dispatchLog('gate', `Scope check on ${data.taskId}`, data.agentId)
          runGate(cwd, { scope: task.scope, verify: task.verify || [] }).then((gateResult) => {
            // Task is always marked done — gate warnings are informational only
            updateTask(homeDir, projectId, data.taskId, { status: 'done' })
            appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_done', message: data.summary || 'Task completed' })
            if (win && !win.isDestroyed()) win.webContents.send('agent:report', { ...data, type: 'task_done' })
            if (gateResult.warnings.length > 0) {
              // Scope warning: inform Worker for awareness, don't block
              const detail = gateResult.warnings.map(w => w.detail).join('; ')
              dispatchLog('gate', `⚠️ ${data.taskId} scope warning (not blocking): ${detail.slice(0, 200)}`, data.agentId)
              sendToAgent(data.agentId, 'MSG', { gate: 'warning', task: data.taskId, warnings: gateResult.warnings })
            } else {
              dispatchLog('gate', `✅ ${data.taskId} scope clean`, data.agentId)
            }
            sendToAgent(data.agentId, 'MSG', { gate: 'pass', task: data.taskId })
            if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'done', summary: data.summary })
            broadcastTasks(projectId)
            autoAssignNext(data.agentId, projectId)
            checkBatchComplete(projectId)
          })
        } else {
          updateTask(homeDir, projectId, data.taskId, { status: 'done' })
          dispatchLog('task-done', `${data.taskId} → done (no gate)`, data.agentId)
          appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_done', message: data.summary || 'Task completed' })
          if (win && !win.isDestroyed()) win.webContents.send('agent:report', { ...data, type: 'task_done' })
          if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'done', summary: data.summary })
          broadcastTasks(projectId)
          autoAssignNext(data.agentId, projectId)
          checkBatchComplete(projectId)
        }
      } else if (req.url === '/task-blocked') {
        const homeDir = DATA_DIR
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        updateTask(homeDir, projectId, data.taskId, {
          status: 'blocked', blocked_reason: data.reason, attempt: data.attempt || 0
        })
        dispatchLog('task-blocked', `❌ ${data.taskId}: ${data.reason}`, data.agentId)
        appendLog(data.agentId, { time: new Date().toISOString(), type: 'notification', message: `BLOCKED: ${data.reason}` })
        if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'blocked', reason: data.reason })
        notifyHuman('Task Blocked', `${data.taskId}: ${data.reason}`)
        broadcastTasks(projectId)
      } else if (req.url === '/task-abandon') {
        const homeDir = DATA_DIR
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        // Permission: only the task group manager may abandon
        if (!ctx || ctx.taskGroup.managerId !== data.agentId) {
          dispatchLog('task-abandon', `⛔ REJECTED ${data.taskId} — only manager can abandon`, data.agentId)
          res.writeHead(403)
          res.end('forbidden: only manager can abandon')
          return
        }
        // Reason is required
        if (!data.reason || !String(data.reason).trim()) {
          dispatchLog('task-abandon', `⛔ REJECTED ${data.taskId} — reason required`, data.agentId)
          res.writeHead(400)
          res.end('reason required')
          return
        }
        const existing = readTask(homeDir, projectId, data.taskId)
        if (!existing) {
          res.writeHead(404)
          res.end('task not found')
          return
        }
        if (existing.status === 'done') {
          dispatchLog('task-abandon', `⛔ REJECTED ${data.taskId} — already done`, data.agentId)
          res.writeHead(409)
          res.end('cannot abandon completed task')
          return
        }
        updateTask(homeDir, projectId, data.taskId, { status: 'abandoned', abandoned_reason: data.reason })
        dispatchLog('task-abandon', `🚫 ${data.taskId}: ${data.reason}`, data.agentId)
        appendLog(data.agentId, { time: new Date().toISOString(), type: 'notification', message: `ABANDONED: ${data.taskId} — ${data.reason}` })
        // Notify the worker if task was assigned
        if (existing.owner) {
          sendToAgent(existing.owner, 'MSG', { task: data.taskId, status: 'abandoned', reason: data.reason })
        }
        notifyHuman('Task Abandoned', `${data.taskId}: ${data.reason}`)
        broadcastTasks(projectId)
      } else if (req.url === '/task-status') {
        const homeDir = DATA_DIR
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        const tasks = listTasks(homeDir, projectId)
        // Debug: write to file so test can read it
        try {
          const debugLog = join(DATA_DIR, 'task-status-debug.log')
          const line = `${new Date().toISOString()} agentId=${data.agentId} ctx=${ctx ? ctx.projectId : 'null'} projectId=${projectId} tasks=${tasks.length}\n`
          writeFileSync(debugLog, (existsSync(debugLog) ? readFileSync(debugLog, 'utf-8') : '') + line)
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(tasks))
        return
      } else if (req.url === '/ready') {
        dispatchLog('ready', `available for next task`, data.agentId)
        const ctx = findTaskGroupForAgent(data.agentId)
        if (ctx?.taskGroup) {
          setTimeout(() => {
            sendToAgent(ctx.taskGroup.managerId, 'MSG', { worker: data.agentId, status: 'ready' })
          }, 2000)
        }
      } else if (req.url === '/report-human') {
        notifyHuman('Manager', data.message || '')
        appendLog(data.agentId, { time: new Date().toISOString(), type: 'report', message: data.message })
      } else if (req.url === '/batch-propose') {
        dispatchLog('batch-propose', `Batch ${data.batch || '?'}: ${(data.tasks || []).length} tasks`, data.agentId)
        const d = loadData()
        const tgs = (d.taskGroups || []) as any[]
        const ctx = data.agentId ? findTaskGroupForAgentInData(data.agentId, tgs) : null
        if (ctx) {
          ctx.taskGroup.status = 'batch_proposed'
          saveData(d)
        }
        if (win && !win.isDestroyed()) win.webContents.send('batch:proposal', data)
      } else if (req.url === '/check-inbox') {
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = ctx?.projectId || '_global'
        const inboxFile = join(DATA_DIR, 'comms', projectId, 'inbox', `${data.agentId}.jsonl`)
        if (!existsSync(inboxFile)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, messages: [] }))
          return
        }
        const lines = readFileSync(inboxFile, 'utf-8').split('\n').filter(Boolean)
        const messages: any[] = []
        const updated: string[] = []
        for (const line of lines) {
          try {
            const msg = JSON.parse(line)
            if (!msg._read) { messages.push(msg); msg._read = true }
            updated.push(JSON.stringify(msg))
          } catch { updated.push(line) }
        }
        writeFileSync(inboxFile, updated.join('\n') + '\n')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, messages }))
        return
      }

      res.writeHead(200)
      res.end('ok')
    } catch {
      res.writeHead(400)
      res.end('bad request')
    }
  })
})

// Write Claude Code native agent definition file
function writeAgentDefinition(cwd: string, config: {
  agentId: string; name: string; role: string; department: string;
  soul: string; skills: string[]; model: string; effort: string;
  taskGroupRole?: string; todoSource?: string; maxGateRetries?: number;
  taskGroupProjectId?: string;
  taskGroupWorkers?: { id: string; name: string }[];
  taskGroupQaId?: string; taskGroupQaName?: string;
  taskGroupCriticId?: string; taskGroupCriticName?: string;
  dailyReportEnabled?: boolean; targetBranch?: string;
}) {
  const agentsDir = join(cwd, '.claude', 'agents')
  mkdirSync(agentsDir, { recursive: true })

  const agentName = `hive-${config.agentId}`
  const curlCmd = (endpoint: string, jsonBody: string) =>
    `curl -s -X POST http://127.0.0.1:${HIVE_PORT}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`

  const yamlHookBlock = (event: string, cmd: string) =>
    `  ${event}:\n    - matcher: ""\n      hooks:\n        - type: command\n          command: >-\n            ${cmd}\n`

  // Build YAML frontmatter
  let yaml = `---\n`
  yaml += `name: ${agentName}\n`
  yaml += `description: "${config.name} - ${config.role} specialist"\n`
  yaml += `model: ${config.model || 'inherit'}\n`
  yaml += `effort: ${config.effort || 'high'}\n`
  if (config.skills.length > 0) {
    yaml += `skills:\n${config.skills.map(s => `  - ${s}`).join('\n')}\n`
  }
  yaml += `hooks:\n`
  yaml += yamlHookBlock('PreToolUse', curlCmd('/status', `{"agentId":"${config.agentId}","status":"working"}`))
  yaml += yamlHookBlock('Stop', curlCmd('/status', `{"agentId":"${config.agentId}","status":"waiting"}`))
  yaml += `---\n\n`

  // Markdown body = soul content
  yaml += config.soul

  if (!config.soul.includes('Task Reporting')) {
    yaml += `\n\n## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
  }

  // Inject role-specific soul addendum for task group agents.
  //
  // Wrapped in <!-- hive:taskgroup:begin v=1 --> ... :end --> markers
  // per docs/soul-conventions.md §3-4. The marker block delimits the
  // Hive-managed task-group orchestration so:
  //   - tooling can locate / refresh / replace it without touching
  //     user-authored soul above
  //   - the convention itself is self-evident in the .md (an agent
  //     reading its own definition can see what's machine-managed)
  //
  // Markers only emitted when there's an addendum to wrap; agents
  // without a taskGroupRole stay marker-free.
  const rsh = '.claude/hive-report.sh'
  let addendum = ''
  if (config.taskGroupRole === 'manager') {
    addendum = getManagerSoulAddendum({
      todoSource: config.todoSource || 'docs/todo.md',
      projectId: config.taskGroupProjectId,
      workers: config.taskGroupWorkers,
      qaId: config.taskGroupQaId, qaName: config.taskGroupQaName,
      criticId: config.taskGroupCriticId, criticName: config.taskGroupCriticName,
      reportScriptPath: rsh,
      dailyReportEnabled: config.dailyReportEnabled,
      targetBranch: config.targetBranch,
    })
  } else if (config.taskGroupRole === 'worker') {
    addendum = getWorkerSoulAddendum({ maxRetries: config.maxGateRetries || 3, reportScriptPath: rsh })
  } else if (config.taskGroupRole === 'qa') {
    addendum = getQaSoulAddendum({ reportScriptPath: rsh })
  } else if (config.taskGroupRole === 'critic') {
    addendum = getCriticSoulAddendum({ reportScriptPath: rsh })
  }
  if (addendum) {
    yaml += '\n\n<!-- hive:taskgroup:begin v=1 -->\n'
    yaml += addendum.replace(/^\n+|\n+$/g, '') + '\n'
    yaml += '<!-- hive:taskgroup:end -->\n'
  }

  writeFileSync(join(agentsDir, `${agentName}.md`), yaml)

  // Write soul file to ~/.hive/souls/ for --append-system-prompt-file fallback
  const soulsDir = join(app.getPath('home'), '.hive', 'souls')
  if (!existsSync(soulsDir)) mkdirSync(soulsDir, { recursive: true })
  writeFileSync(join(soulsDir, `${config.agentId}.md`), config.soul)

  // Setup agent-specific memory directory
  const memoryDir = join(app.getPath('home'), '.hive', 'memory', config.agentId)
  mkdirSync(memoryDir, { recursive: true })
  const cwdMemory = join(cwd, '.claude', 'memory')
  try {
    const s = lstatSync(cwdMemory)
    if (s.isSymbolicLink()) unlinkSync(cwdMemory)
  } catch {}
  if (!existsSync(cwdMemory)) {
    symlinkSync(memoryDir, cwdMemory)
  }

  // hive-report.sh helper script (generated from utils.ts with all orchestration commands)
  const reportScript = join(cwd, '.claude', 'hive-report.sh')
  writeFileSync(reportScript, generateReportScript(config.agentId, HIVE_PORT, DATA_DIR, config.targetBranch), { mode: 0o755 })

  return agentName
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: 'Hive',
    width: 1400,
    height: 900,
    show: false,
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    // HEADLESS=1: e2e runs leave the BrowserWindow hidden so they don't
    // steal focus from the user's running Hive.app. Playwright still
    // drives the renderer via app.firstWindow().
    if (!isHeadlessMode(process.env)) mainWindow.show()
    if (is.dev) mainWindow.webContents.openDevTools({ mode: 'bottom' })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Intercept in-page navigation (plain <a href> clicks) and open in
  // the system browser instead of replacing the Electron window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// PTY management
ipcMain.handle('pty:create', (_event, { id, cwd }) => {
  try {
    const userShell = process.env.SHELL || '/bin/zsh'
    const term = pty.spawn(userShell, ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.env.HOME || '/tmp',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>
    })

    terminals.set(id, term)

    term.onData((data) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:data:${id}`, data)
      }
      // Detect 5-hour usage limit hit
      if (data.includes("You've hit your limit")) {
        const resetMatch = data.match(/resets\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)
        if (resetMatch) {
          const now = new Date()
          const timeStr = resetMatch[1] // e.g. "1pm" or "1:00pm"
          const match12 = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
          if (match12) {
            let hours = parseInt(match12[1])
            const mins = match12[2] ? parseInt(match12[2]) : 0
            const ampm = match12[3].toLowerCase()
            if (ampm === 'pm' && hours !== 12) hours += 12
            if (ampm === 'am' && hours === 12) hours = 0
            const resetTime = new Date(now)
            resetTime.setHours(hours, mins, 0, 0)
            // If reset time is in the past, it's tomorrow
            if (resetTime.getTime() <= now.getTime()) resetTime.setDate(resetTime.getDate() + 1)
            // Find current task for this agent
            const d = loadData()
            const ctx = findTaskGroupForAgentInData(id, (d.taskGroups || []) as any[])
            let currentTaskId: string | undefined
            if (ctx) {
              const tasks = listTasks(DATA_DIR, ctx.projectId)
              const activeTask = tasks.find(t => t.owner === id && (t.status === 'assigned' || t.status === 'in_progress'))
              currentTaskId = activeTask?.id
            }
            limitResets.set(id, { resetTime, taskId: currentTaskId, whipScheduled: false })
            saveLimitState(Object.fromEntries([...limitResets].map(([k, v]) => [k, { ...v, resetTime: v.resetTime.toISOString() }])))
            const resetStr = resetTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            dispatchLog('limit', `🔴 ${id} hit 5h limit — resets at ${resetStr}`, id)
            notifyHuman('Agent Limit', `Agent hit 5h limit. Resets at ${resetStr}. Will auto-whip.`)
          }
        }
      }
    })

    term.onExit(({ exitCode }) => {
      terminals.delete(id)
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:exit:${id}`, exitCode)
      }
    })

    return { pid: term.pid }
  } catch (err) {
    console.error('PTY create error:', err)
    return { pid: -1, error: String(err) }
  }
})

ipcMain.handle('pty:write', (_event, { id, data }) => {
  const term = terminals.get(id)
  if (term) term.write(data)
})

ipcMain.handle('pty:resize', (_event, { id, cols, rows }) => {
  const term = terminals.get(id)
  if (term) term.resize(cols, rows)
})

ipcMain.handle('pty:kill', (_event, { id }) => {
  const term = terminals.get(id)
  if (term) {
    term.kill()
    terminals.delete(id)
  }
})

// "Is there a live claude agent session inside this terminal's shell?"
// The Term pane uses this to decide whether to launch claude on open: if a
// session already exists (shell still has a claude child) it reuses it; if not
// (first open, or claude was exited) it starts one. Scoped to the shell's pid
// descendants so it never sees another terminal's claude or the Desktop app.
// UNTESTABLE: thin shell over live `ps` + a node-pty handle (like the other
// pty:* handlers, none of which are unit-tested). All real logic — ps parsing
// and the descendant tree walk — lives in ptyProcessTree.ts and is unit-tested
// (src/main/__tests__/ptyProcessTree.test.ts). Manual reproducer in
// docs/manual-test-plan.md ("Term claude reuse vs recreate").
ipcMain.handle('pty:hasAgentSession', (_event, { id }) => {
  const term = terminals.get(id)
  if (!term) return { alive: false }
  try {
    const stdout = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], {
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024
    })
    return { alive: hasClaudeDescendant(parsePsRows(stdout), term.pid) }
  } catch (err) {
    // ps failed (vanishingly rare). Report unknown via error so the renderer
    // can choose NOT to spawn — avoids a duplicate claude on a transient hiccup.
    return { alive: false, error: String(err) }
  }
})

// PTY injection IPC
ipcMain.handle('agent:send', (_event, { agentId, type, payload }) => {
  return sendToAgent(agentId, type, payload)
})

// Speech recognition (macOS native SFSpeechRecognizer)
let speechProcess: any = null

ipcMain.handle('speech:start', () => {
  if (speechProcess) return { ok: false, error: 'already running' }
  const { spawn } = require('child_process')
  // Dev: scripts/hive-speech relative to project root. Packaged: extraResources/scripts/hive-speech
  const devPath = join(__dirname, '..', '..', 'scripts', 'hive-speech')
  const prodPath = join(process.resourcesPath, 'scripts', 'hive-speech')
  const resolvedPath = existsSync(devPath) ? devPath : prodPath
  if (!existsSync(resolvedPath)) return { ok: false, error: 'hive-speech binary not found' }
  speechProcess = spawn(resolvedPath, [], { stdio: ['ignore', 'pipe', 'pipe'] })
  speechProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('speech:transcript', line)
      }
    }
  })
  speechProcess.on('exit', () => { speechProcess = null })
  return { ok: true }
})

ipcMain.handle('speech:stop', () => {
  if (speechProcess) {
    speechProcess.kill('SIGTERM')
    speechProcess = null
  }
  return { ok: true }
})

// Dialog: select folder
ipcMain.handle('dialog:selectFolder', async (_event, { title }) => {
  const result = await dialog.showOpenDialog({
    title: title || 'Select Folder',
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// Data persistence

ipcMain.handle('inbox:list', (_event, { projectId }) => {
  const inboxDir = join(DATA_DIR, 'comms', projectId, 'inbox')
  if (!existsSync(inboxDir)) return []
  const result: { agentId: string; messages: any[] }[] = []
  for (const f of readdirSync(inboxDir).filter(f => f.endsWith('.jsonl'))) {
    const agentId = f.replace('.jsonl', '')
    const lines = readFileSync(join(inboxDir, f), 'utf-8').split('\n').filter(Boolean)
    const messages = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    result.push({ agentId, messages })
  }
  return result
})

ipcMain.handle('data:load', () => loadData())

// Privacy / streaming-mode: expose OS username (so renderer can redact
// it in display without hardcoding any real name) + a persistent boolean
// in data.settings.streamingMode.
ipcMain.handle('system:username', () => {
  try { return require('os').userInfo().username } catch { return '' }
})
ipcMain.handle('settings:get', (_event, { key }: { key: string }) => {
  const data = loadData() as any
  return data.settings?.[key]
})
ipcMain.handle('settings:set', (_event, { key, value }: { key: string; value: unknown }) => {
  const data = loadData() as any
  data.settings = { ...(data.settings || {}), [key]: value }
  saveData(data)
  return true
})

/** Append a rule to ~/.claude/settings.json permissions.allow so future
 *  identical permission prompts auto-approve. Rules come from Claude's
 *  own permission_suggestions, shape `{toolName, ruleContent}`. We
 *  write the claude-native `ToolName(content)` format. */
/**
 * Apply a permission_suggestions[i] entry to ~/.claude/settings.json so
 * the same prompt doesn't fire again. Supports all 3 shapes claude
 * emits as of 2026-04 (claude code 2.1.123+):
 *
 *   - { rules: [{toolName, ruleContent}], ... }   → permissions.allow
 *   - { type: 'addDirectories', directories[] }   → permissions.additionalDirectories
 *   - { type: 'setMode', mode: 'acceptEdits' }    → permissions.defaultMode
 *
 * Bug fix 2026-04-30: prior implementation only handled `rules`. The
 * new claude schema dropped that for system paths in favor of
 * setMode/addDirectories, so "Allow & remember" silently no-op'd —
 * user kept getting prompted forever for the same file.
 */
ipcMain.handle('settings:addClaudeAllowRule', (_event, payload: {
  rules?: { toolName: string; ruleContent: string }[]
  suggestion?: any
}) => {
  try {
    const home = require('os').userInfo().homedir || process.env.HOME || ''
    const path = require('path').join(home, '.claude', 'settings.json')
    const fs = require('fs')
    let settings: any = {}
    if (fs.existsSync(path)) {
      settings = JSON.parse(fs.readFileSync(path, 'utf8'))
    }
    if (!settings.permissions) settings.permissions = {}

    let added = 0
    const s = payload.suggestion || (payload.rules ? { rules: payload.rules } : null)
    if (!s) return { ok: false, error: 'no suggestion' }

    // Shape 1: explicit rules list (old schema, still emitted for some tools)
    if (Array.isArray(s.rules) && s.rules.length > 0) {
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = []
      for (const r of s.rules) {
        const pattern = `${r.toolName}(${r.ruleContent})`
        if (!settings.permissions.allow.includes(pattern)) {
          settings.permissions.allow.push(pattern)
          added++
        }
      }
    }

    // Shape 2: addDirectories — trust paths so future tool calls inside
    // them skip the permission gate.
    if (s.type === 'addDirectories' && Array.isArray(s.directories)) {
      if (!Array.isArray(settings.permissions.additionalDirectories)) settings.permissions.additionalDirectories = []
      for (const d of s.directories) {
        if (typeof d === 'string' && !settings.permissions.additionalDirectories.includes(d)) {
          settings.permissions.additionalDirectories.push(d)
          added++
        }
      }
    }

    // Shape 3: setMode — flip default permission mode. "session"
    // destination is per-session, but if user clicked "Allow &
    // switch to acceptEdits" they want it to persist.
    if (s.type === 'setMode' && typeof s.mode === 'string') {
      if (settings.permissions.defaultMode !== s.mode) {
        settings.permissions.defaultMode = s.mode
        added++
      }
    }

    fs.writeFileSync(path, JSON.stringify(settings, null, 2))
    return { ok: true, added }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
})
ipcMain.handle('dispatcher:loadLog', () => loadDispatchLog())
ipcMain.handle('dispatcher:clearLog', (_event, { keepAfter }: { keepAfter?: string }) => {
  if (keepAfter) {
    const cutoff = new Date(keepAfter).getTime()
    const logs = loadDispatchLog().filter(e => new Date(e.time).getTime() > cutoff)
    saveDispatchLog(logs)
    return logs
  }
  saveDispatchLog([])
  return []
})
ipcMain.handle('tasks:list', (_event, { projectId }) => listTasks(DATA_DIR, projectId))
ipcMain.handle('data:save', (_event, data) => {
  saveData(data)
  return true
})

// Check if folder has .git
ipcMain.handle('fs:hasGit', (_event, { path }) => {
  return existsSync(join(path, '.git'))
})

// Git worktree management
ipcMain.handle('git:commitHistory', (_event, { cwd, days }: { cwd: string; days: number }) => {
  try {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days) || 1)))
    const output = execFileSync('git', ['log', `--since=${safeDays} days ago`, '--format=%ai', '--all'], { cwd, encoding: 'utf-8', timeout: 10000 })
    const byDay: Record<string, number> = {}
    for (const line of output.trim().split('\n').filter(Boolean)) {
      const date = line.slice(0, 10) // YYYY-MM-DD
      byDay[date] = (byDay[date] || 0) + 1
    }
    return byDay
  } catch { return {} }
})

ipcMain.handle('git:createTargetBranch', (_event, { repoPath, branch }: { repoPath: string; branch: string }) => {
  // Check local
  try {
    execFileSync('git', ['rev-parse', '--verify', branch], { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' })
    return { ok: true, existed: true }
  } catch {}
  // Check remote
  try {
    execFileSync('git', ['rev-parse', '--verify', `origin/${branch}`], { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' })
    return { ok: true, existed: true }
  } catch {}
  // Create from main
  try {
    execFileSync('git', ['branch', branch, 'main'], { cwd: repoPath, encoding: 'utf-8' })
    execFileSync('git', ['push', 'origin', branch], { cwd: repoPath, encoding: 'utf-8' })
    return { ok: true, existed: false }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('git:currentBranch', (_event, { cwd }) => {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' }).trim()
  } catch { return '' }
})

ipcMain.handle('git:worktreeAdd', (_event, { repoPath, agentId, agentName }: { repoPath: string; agentId: string; agentName: string }) => {
  try {
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const branchName = `hive/${safeName}-${agentId.slice(-6)}`
    const worktreePath = join(repoPath, '..', `${repoPath.split('/').pop()}-${safeName}`)

    // Create branch from current HEAD if it doesn't exist
    try {
      execFileSync('git', ['-C', repoPath, 'branch', branchName], { encoding: 'utf-8', stdio: 'pipe' })
    } catch {} // Branch may already exist

    // Add worktree
    execFileSync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branchName], { encoding: 'utf-8', stdio: 'pipe' })

    return { ok: true, path: worktreePath, branch: branchName }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('git:worktreeRemove', (_event, { repoPath, worktreePath }: { repoPath: string; worktreePath: string }) => {
  try {
    execFileSync('git', ['-C', repoPath, 'worktree', 'remove', worktreePath, '--force'], { encoding: 'utf-8', stdio: 'pipe' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('git:worktreeList', (_event, { repoPath }: { repoPath: string }) => {
  try {
    const output = execFileSync('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], { encoding: 'utf-8' })
    const worktrees = output.split('\n\n').filter(Boolean).map((block) => {
      const lines = block.split('\n')
      const path = lines.find((l) => l.startsWith('worktree '))?.slice(9) || ''
      const branch = lines.find((l) => l.startsWith('branch '))?.slice(7) || ''
      return { path, branch }
    })
    return worktrees
  } catch {
    return []
  }
})

// Create integration branch by merging worker branches
ipcMain.handle('git:createIntegration', (_event, { repoPath, batchNum, workerBranches }: { repoPath: string; batchNum: number; workerBranches: string[] }) => {
  try {
    const safeBatchNum = Math.max(0, Math.floor(Number(batchNum) || 0))
    const branchName = `integration/batch-${safeBatchNum}`
    execFileSync('git', ['-C', repoPath, 'checkout', '-b', branchName, 'main'], { encoding: 'utf-8' })
    const mergeResults: { branch: string; ok: boolean; error?: string }[] = []
    for (const branch of workerBranches) {
      try {
        execFileSync('git', ['-C', repoPath, 'merge', '--no-ff', branch, '-m', `merge ${branch} into ${branchName}`], { encoding: 'utf-8' })
        mergeResults.push({ branch, ok: true })
      } catch (err: any) {
        mergeResults.push({ branch, ok: false, error: (err.message || '').slice(0, 200) })
        // Abort failed merge
        try { execFileSync('git', ['-C', repoPath, 'merge', '--abort'], { encoding: 'utf-8' }) } catch {}
        break
      }
    }
    const allOk = mergeResults.every(r => r.ok)
    if (allOk) {
      execFileSync('git', ['-C', repoPath, 'push', 'origin', branchName], { encoding: 'utf-8' })
    }
    return { ok: allOk, branch: branchName, results: mergeResults }
  } catch (err: any) {
    return { ok: false, error: (err.message || '').slice(0, 300) }
  }
})

// Git clone
ipcMain.handle('git:clone', async (_event, { url, destPath, token, provider }: { url: string; destPath: string; token?: string; provider?: string }) => {
  try {
    let cloneUrl = url
    // Inject token for authenticated clone
    if (token && url.startsWith('https://')) {
      const urlObj = new URL(url)
      if (provider === 'gitlab') {
        cloneUrl = `https://oauth2:${token}@${urlObj.host}${urlObj.pathname}`
      } else {
        cloneUrl = `https://${token}@${urlObj.host}${urlObj.pathname}`
      }
    }
    execFileSync('git', ['clone', cloneUrl, destPath], { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 })
    const folderName = destPath.split('/').pop() || ''
    return { ok: true, path: destPath, name: folderName }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Scan project zones for todos and status
ipcMain.handle('project:scan', (_event, { zones }: { zones: { path: string; type: string }[] }) => {
  const todos: { zone: string; type: string; category: string; text: string; done: boolean }[] = []
  let projectStage = 'early-stage'

  for (const zone of zones) {
    if (!existsSync(zone.path)) continue

    // Check git activity for project stage
    if (zone.type === 'rnd') {
      try {
        const { execSync } = require('child_process')
        const log = execSync(`git -C "${zone.path}" log --oneline -20 --since="30 days ago" 2>/dev/null`, { encoding: 'utf-8' })
        const commitCount = log.trim().split('\n').filter(Boolean).length
        if (commitCount > 10) projectStage = 'active'
        else if (commitCount > 0) projectStage = 'incubating'

        // Check if has deployment/CI
        const hasCI = existsSync(join(zone.path, '.github/workflows')) ||
          existsSync(join(zone.path, '.gitlab-ci.yml')) ||
          existsSync(join(zone.path, 'vercel.json')) ||
          existsSync(join(zone.path, 'netlify.toml'))
        if (hasCI && commitCount > 10) projectStage = 'active-online'
      } catch {}
    }

    // Scan markdown files for todos
    try {
      const scanDir = (dir: string, depth: number) => {
        if (depth > 3) return
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'out') continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory() && depth < 3) {
            scanDir(fullPath, depth + 1)
          } else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
            try {
              const content = readFileSync(fullPath, 'utf-8')
              const lines = content.split('\n')
              for (const line of lines) {
                const todoMatch = line.match(/^[\s]*[-*]\s*\[([ xX])\]\s+(.+)/)
                if (todoMatch) {
                  const done = todoMatch[1].toLowerCase() === 'x'
                  const text = todoMatch[2].trim()
                  // Categorize
                  let category = 'other'
                  const lower = text.toLowerCase()
                  if (lower.includes('market') || lower.includes('seo') || lower.includes('social') || lower.includes('content') || lower.includes('campaign')) {
                    category = 'marketing'
                  } else if (lower.includes('monetiz') || lower.includes('pricing') || lower.includes('revenue') || lower.includes('payment') || lower.includes('subscri')) {
                    category = 'monetizing'
                  } else if (lower.includes('bug') || lower.includes('fix') || lower.includes('test') || lower.includes('refactor') || lower.includes('feature') || lower.includes('implement')) {
                    category = 'rd'
                  } else if (lower.includes('doc') || lower.includes('readme') || lower.includes('deploy') || lower.includes('ci') || lower.includes('setup')) {
                    category = 'ops'
                  }
                  todos.push({
                    zone: zone.path.split('/').pop() || '',
                    type: zone.type,
                    category,
                    text,
                    done
                  })
                }
              }
            } catch {}
          }
        }
      }
      scanDir(zone.path, 0)
    } catch {}
  }

  return { projectStage, todos }
})

// Scan files in directory, flattened, sorted by mtime
ipcMain.handle('fs:scanFiles', (_event, { dirPath, limit = 100 }) => {
  const SKIP = new Set(['node_modules', '.next', '.cache', '.hive', '__pycache__', '.DS_Store', '.Trash', '.Spotlight-V100'])
  const files: { path: string; mtime: number; size: number }[] = []
  const MAX_DEPTH = 10
  const MAX_VISIT = 50_000
  const MAX_TIME_MS = 3_000
  const startMs = Date.now()

  function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH) return
    if (files.length > MAX_VISIT) return
    if (Date.now() - startMs > MAX_TIME_MS) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue
        const full = join(dir, entry.name)
        try {
          const st = lstatSync(full)
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) {
            walk(full, depth + 1)
          } else if (st.isFile()) {
            const rel = full.slice(dirPath.length + 1)
            files.push({ path: rel, mtime: st.mtimeMs, size: st.size })
          }
        } catch {}
      }
    } catch {}
  }

  if (existsSync(dirPath)) walk(dirPath, 0)
  files.sort((a, b) => b.mtime - a.mtime)
  return files.slice(0, limit)
})

// Open file in Finder
ipcMain.handle('fs:revealInFinder', (_event, { filePath }) => {
  shell.showItemInFolder(filePath)
})

// Write file
ipcMain.handle('fs:writeFile', (_event, { filePath, content }) => {
  try { writeFileSync(filePath, content); return true } catch { return false }
})

// Template management
const TEMPLATES_DIR = join(app.getPath('home'), '.hive', 'templates')

ipcMain.handle('templates:list', () => {
  mkdirSync(TEMPLATES_DIR, { recursive: true })
  try {
    return readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf-8')) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
})

ipcMain.handle('templates:save', (_event, { template }) => {
  mkdirSync(TEMPLATES_DIR, { recursive: true })
  writeFileSync(join(TEMPLATES_DIR, `${template.id}.json`), JSON.stringify(template, null, 2))
  return true
})

ipcMain.handle('templates:delete', (_event, { id }) => {
  const f = join(TEMPLATES_DIR, `${id}.json`)
  try { if (existsSync(f)) unlinkSync(f) } catch {}
  return true
})

// Read any file content
ipcMain.handle('fs:readFile', (_event, { filePath }) => {
  try { return readFileSync(filePath, 'utf-8') } catch { return null }
})

// Read project CLAUDE.md (check multiple locations)
ipcMain.handle('project:readClaudeMd', (_event, { projectPath }) => {
  const paths = [
    join(projectPath, 'CLAUDE.md'),
    join(projectPath, '.claude', 'CLAUDE.md'),
  ]
  for (const p of paths) {
    try { if (existsSync(p)) return readFileSync(p, 'utf-8') } catch {}
  }
  return null
})

// Read skill file content
ipcMain.handle('skills:readContent', (_event, { path: skillPath }) => {
  const skillMd = join(skillPath, 'SKILL.md')
  try {
    if (existsSync(skillMd)) return readFileSync(skillMd, 'utf-8')
  } catch {}
  return null
})

// Agent definition management (Claude Code native --agent)
ipcMain.handle('agent:writeDefinition', (_event, { cwd, config }) => {
  try {
    const agentName = writeAgentDefinition(cwd, config)
    return { ok: true, agentName }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('agent:deleteDefinition', (_event, { cwd, agentId }) => {
  const agentFile = join(cwd, '.claude', 'agents', `hive-${agentId}.md`)
  try { if (existsSync(agentFile)) unlinkSync(agentFile) } catch {}
  return true
})

// Load agent work logs
ipcMain.handle('agent:loadLogs', (_event, { agentId }) => {
  return loadLogs(agentId)
})

// Clear agent work logs
ipcMain.handle('agent:clearLogs', (_event, { agentId }) => {
  const logFile = join(LOGS_DIR, `${agentId}.json`)
  try { writeFileSync(logFile, '[]') } catch {}
  return true
})

// Subagent (Task tool) liveness — overrides the hook-driven badge so
// a parent agent that's currently delegating to a sub-agent shows
// 'working' (green) instead of 'waiting' (yellow). Hook semantics
// can't see this on their own because the parent claude process
// genuinely IS in Stop state while the sub-agent runs.
ipcMain.handle('agent:checkSubagentActivity', (_event, { agentId }) => {
  const cwd = findAgentWorktree(agentId)
  return { active: isSubagentActiveForCwd(cwd) }
})

// Skills scanning — recursively find all SKILL.md files
ipcMain.handle('skills:scan', () => {
  const skillsDir = join(app.getPath('home'), '.claude', 'skills')
  if (!existsSync(skillsDir)) return []
  const skills: { name: string; pack: string; path: string; description: string }[] = []

  function parseSkillMd(filePath: string): { name: string; description: string } | null {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const descMatch = content.match(/description:\s*\|?\s*\n?\s*(.+)/m)
      if (!nameMatch) return null
      return {
        name: nameMatch[1].trim(),
        description: (descMatch?.[1] || '').trim().slice(0, 120)
      }
    } catch { return null }
  }

  try {
    const topEntries = readdirSync(skillsDir, { withFileTypes: true })
    for (const top of topEntries) {
      if (!top.isDirectory()) continue
      const topPath = join(skillsDir, top.name)
      const topSkill = join(topPath, 'SKILL.md')

      // Check for sub-skills (like gstack/review/SKILL.md)
      let foundSub = false
      try {
        const subEntries = readdirSync(topPath, { withFileTypes: true })
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue
          const subSkill = join(topPath, sub.name, 'SKILL.md')
          if (existsSync(subSkill)) {
            const parsed = parseSkillMd(subSkill)
            if (parsed) {
              skills.push({
                name: parsed.name,
                pack: top.name,
                path: join(topPath, sub.name),
                description: parsed.description
              })
              foundSub = true
            }
          }
        }
      } catch {}

      // If no sub-skills, check top-level SKILL.md
      if (!foundSub && existsSync(topSkill)) {
        const parsed = parseSkillMd(topSkill)
        if (parsed) {
          skills.push({
            name: parsed.name,
            pack: top.name,
            path: topPath,
            description: parsed.description
          })
        }
      }
    }
  } catch {}
  // Deduplicate by skill name — keep the first one found (sub-skill > standalone)
  const seen = new Set<string>()
  const unique = skills.filter(s => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
  return unique
})

app.whenReady().then(() => {
  app.setName('Hive')
  electronApp.setAppUserModelId('com.hive.app')

  // Catch every way a renderer or helper can die — these fire even when
  // there is no JS exception (SIGKILL, OOM, GPU process abort, etc.).
  // `render-process-gone` replaces the deprecated `crashed` event.
  app.on('render-process-gone', (_event, webContents, details) => {
    writeCrashLog('renderer-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL?.()
    })
  })
  app.on('child-process-gone', (_event, details) => {
    writeCrashLog('child-process-gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName
    })
  })

  // IPC entry so a renderer ErrorBoundary (or any caught throw) can
  // forward a stack trace into the same crash-log.jsonl. Without this,
  // a React render-throw caught by the boundary would leave no trace.
  ipcMain.handle('crash:report', (_e, payload: { kind: string; info: Record<string, unknown> }) => {
    writeCrashLog(payload?.kind || 'renderer-reported', payload?.info || {})
    return { ok: true }
  })

  // OAuth sign-in. Spawns `claude auth login` and streams stdout/stderr
  // to the renderer as `auth:output` events so the user can see the
  // device-code URL (and click it if claude's auto-open doesn't fire).
  // Resolves with the final exit code; renderer treats 0 as success.
  ipcMain.handle('auth:login', () => {
    return new Promise<{ ok: boolean; code: number; error?: string }>((resolve) => {
      const child = spawn('claude', ['auth', 'login'], {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const broadcastAuth = (kind: 'stdout' | 'stderr', s: string) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('auth:output', { kind, text: s })
        }
        const m = s.match(/https:\/\/[^\s)>'"]+/)
        if (m) shell.openExternal(m[0]).catch(() => {})
      }
      child.stdout.on('data', (c: Buffer) => broadcastAuth('stdout', c.toString('utf-8')))
      child.stderr.on('data', (c: Buffer) => broadcastAuth('stderr', c.toString('utf-8')))
      child.on('error', (err) => resolve({ ok: false, code: -1, error: err.message }))
      child.on('exit', (code) => resolve({ ok: code === 0, code: code ?? -1 }))
    })
  })

  // Is the claude CLI runnable by Hive? This is the only environment fact Hive
  // gates on. PATH is hydrated at boot (hydratePathFromShell), so the bare spawn
  // is usually the truth — but as defense-in-depth we also probe via an
  // interactive login shell, so a stale/failed hydration can never produce a
  // FALSE "not found" that wrongly blocks the app behind the install gate.
  // Headless (e2e) short-circuits to installed so the gate never blocks tests.
  function claudeCanRun(): boolean {
    const shell = process.env.SHELL || '/bin/zsh'
    for (const { file, args } of claudeProbeStrategies(shell)) {
      try {
        execFileSync(file, args, { timeout: 7000, stdio: 'ignore' })
        return true
      } catch {
        // Try the next probe strategy.
      }
    }
    return false
  }

  ipcMain.handle('claude:status', (): ClaudeStatus => {
    if (isHeadlessMode(process.env)) return claudeStatus(true)
    return claudeStatus(claudeCanRun())
  })

  // "Install for me" — run the official native installer (no node/npm), stream
  // its output to the renderer, then re-check. The installer drops claude at
  // ~/.local/bin/claude, so we make sure that dir is on the live PATH before
  // the re-check (mirrors what the user's shell rc would do on next launch).
  // UNTESTABLE: actually runs the official installer (network + writes to
  // ~/.local/bin). Can't run in unit/e2e without downloading. Component-side
  // behavior is covered by claude-gate.test.tsx; the subprocess is in
  // docs/manual-test-plan.md.
  ipcMain.handle('claude:install', (): Promise<{ ok: boolean }> => {
    return new Promise((resolve) => {
      const child = spawn('bash', ['-lc', CLAUDE_INSTALL_COMMAND], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const broadcast = (kind: 'stdout' | 'stderr', text: string) => {
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send('claude:install:output', { kind, text })
        }
      }
      child.stdout.on('data', (c: Buffer) => broadcast('stdout', c.toString('utf-8')))
      child.stderr.on('data', (c: Buffer) => broadcast('stderr', c.toString('utf-8')))
      child.on('error', (err) => {
        broadcast('stderr', err.message)
        resolve({ ok: false })
      })
      child.on('exit', () => {
        const localBin = join(app.getPath('home'), '.local', 'bin')
        const parts = (process.env.PATH ?? '').split(':')
        if (!parts.includes(localBin)) process.env.PATH = [localBin, ...parts].join(':')
        resolve({ ok: claudeCanRun() })
      })
    })
  })

  registerChatIpc()
  registerStorageIpc()

  // File-link click in HiveChat → open the file with the default app.
  // Used by Read/Edit/Write tool headers etc. (Reveal-in-Finder for
  // the same paths is already wired via the older `fs:revealInFinder`
  // handler — kept untouched for compatibility.) shell.openPath
  // returns "" on success, error string on failure.
  ipcMain.handle('fs:openPath', async (_e, { path }: { path: string }) => {
    if (!path) return { ok: false, error: 'no path' }
    const err = await shell.openPath(path)
    return err ? { ok: false, error: err } : { ok: true }
  })
  // Write port lock file — single source of truth for hive-report.sh
  const portLockFile = join(DATA_DIR, 'port.lock')
  const existingLock = existsSync(portLockFile) ? readFileSync(portLockFile, 'utf-8').trim().split('\n') : []
  if (existingLock.length >= 2) {
    const oldPid = parseInt(existingLock[1])
    try { process.kill(oldPid, 0); console.log(`[Hive] Warning: PID ${oldPid} still alive, overriding lock`) } catch {}
  }
  writeFileSync(portLockFile, `${HIVE_PORT}\n${process.pid}`)

  statusServer.listen(HIVE_PORT, '127.0.0.1', () => {
    console.log(`[Hive] Status server on http://127.0.0.1:${HIVE_PORT}`)
  })

  // Stuck task detection — poll every 60s, max 3 notifications per task
  // Stuck notification counter — persisted
  const STUCK_COUNT_FILE = join(DATA_DIR, 'stuck-count.json')
  function loadStuckCounts(): Record<string, number> {
    try { if (existsSync(STUCK_COUNT_FILE)) return JSON.parse(readFileSync(STUCK_COUNT_FILE, 'utf-8')) } catch {}
    return {}
  }
  function saveStuckCounts(counts: Record<string, number>) {
    try { writeFileSync(STUCK_COUNT_FILE, JSON.stringify(counts)) } catch {}
  }
  let stuckCounts = loadStuckCounts()
  const stuckNotifyCount = new Map<string, number>(Object.entries(stuckCounts))
  setInterval(() => {
    const d = loadData()
    const tgs = (d.taskGroups || []) as any[]
    for (const tg of tgs) {
      const tasks = listTasks(DATA_DIR, tg.projectId)
      const now = Date.now()
      // Resolve project + agent names for readable notifications
      const project = (d.projects || []).find((p: any) => p.id === tg.projectId) as any
      const projectName = project?.name || tg.projectId
      for (const task of tasks) {
        if ((task.status !== 'assigned' && task.status !== 'in_progress') || !task.assignedAt) continue
        // Skip agents waiting for 5h limit reset — they're not stuck, just paused
        if (task.owner && limitResets.has(task.owner)) continue
        // Reset counter when task status changes (done/blocked/abandoned clear the key)
        if (task.status === 'done' || task.status === 'blocked' || task.status === 'abandoned') {
          stuckNotifyCount.delete(task.id)
          continue
        }
        const elapsed = (now - new Date(task.assignedAt).getTime()) / 60000
        const limit = task.estimatedMinutes || 10
        if (elapsed > limit) {
          const count = stuckNotifyCount.get(task.id) || 0
          const workerAgent = (d.agents || []).find((a: any) => a.id === task.owner) as any
          const workerName = workerAgent?.name || task.owner || 'unknown'
          // Always log to dispatcher (silent polling)
          dispatchLog('stuck', `⏰ [${projectName}] ${task.id} "${task.title}" — ${Math.round(elapsed)}m elapsed (est. ${limit}m, notify ${count + 1}/3)`, task.owner || undefined)
          if (count < 3) {
            // First 3 times: notify human + ping worker
            sendToAgent(task.owner!, 'MSG', { ping: task.id, message: `Task ${task.id} exceeded estimated time (${limit}m). Status?` })
            notifyHuman('Task Stuck', `[${projectName}] ${workerName} · ${task.id} "${task.title}" — ${Math.round(elapsed)}m (est. ${limit}m)`)
            stuckNotifyCount.set(task.id, count + 1)
            saveStuckCounts(Object.fromEntries(stuckNotifyCount))
          }
          // No longer bump assignedAt — let stuck tasks remain visible
        }
      }
    }
  }, 60000)

  // 5-hour whip: auto-restart agents after limit reset
  setInterval(() => {
    const now = Date.now()
    for (const [agentId, info] of limitResets) {
      if (info.whipScheduled) continue
      if (now < info.resetTime.getTime()) continue
      // Reset time has passed — whip the agent
      info.whipScheduled = true
      const term = terminals.get(agentId)
      if (!term) {
        dispatchLog('whip', `⚠️ Cannot whip ${agentId} — no terminal`, agentId)
        limitResets.delete(agentId)
        continue
      }
      dispatchLog('whip', `🔄 Whipping ${agentId} — limit reset, resuming session`, agentId)
      notifyHuman('Agent Whip', `Auto-restarting agent after 5h limit reset`)
      // Send Enter to dismiss any prompt, then resume claude session
      term.write('\r')
      setTimeout(() => {
        const t = terminals.get(agentId)
        if (t) t.write('claude -c\r')
      }, 2000)
      // Clean up after whip
      setTimeout(() => limitResets.delete(agentId), 10000)
    }
  }, 30000) // check every 30s for faster response after reset

  // Daily report trigger — schedule precisely at 00:01
  function scheduleDailyReport() {
    const now = new Date()
    const next = new Date(now)
    next.setHours(0, 1, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    const ms = next.getTime() - now.getTime()
    setTimeout(() => {
      const dateStr = new Date().toISOString().slice(0, 10)
      const d = loadData()
      const tgs = (d.taskGroups || []) as any[]
      for (const tg of tgs) {
        if (!tg.dailyReportEnabled) continue
        const sent = sendToAgent(tg.managerId, 'HUMAN', { action: 'daily-report', date: dateStr })
        dispatchLog('daily-report', `📋 Triggered daily report for ${dateStr}`, tg.managerId)
        if (!sent) dispatchLog('daily-report', `⚠️ Manager terminal offline — daily report not sent`, tg.managerId)
      }
      scheduleDailyReport() // schedule next day
    }, ms)
  }
  scheduleDailyReport()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Kill all terminals
  for (const [, term] of terminals) {
    term.kill()
  }
  terminals.clear()
  // Remove port lock
  const portLockFile = join(DATA_DIR, 'port.lock')
  try { unlinkSync(portLockFile) } catch {}
  if (process.platform !== 'darwin') app.quit()
})
