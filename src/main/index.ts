import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, statSync, lstatSync } from 'fs'
import { createServer } from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as pty from 'node-pty'
import { execSync } from 'child_process'
import { createTask, readTask, updateTask, listTasks } from './tasks'
import { runGate } from './gate'
import { getManagerSoulAddendum, getWorkerSoulAddendum, getQaSoulAddendum, getCriticSoulAddendum } from './souls'
import { findTaskGroupForAgentInData, findAgentCwd, formatHiveMessage } from './helpers'

// Data persistence
const DATA_DIR = join(app.getPath('home'), '.hive')
const DATA_FILE = join(DATA_DIR, 'data.json')

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
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

const terminals: Map<string, pty.IPty> = new Map()
const HIVE_PORT = parseInt(process.env.HIVE_PORT || '17710', 10)

// Work logs persistence
const LOGS_DIR = join(app.getPath('home'), '.hive', 'logs')

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
function sendToAgent(agentId: string, type: string, payload: object): boolean {
  const term = terminals.get(agentId)
  if (!term) return false
  term.write(formatHiveMessage(type, payload))
  return true
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
  if (req.method === 'GET' && req.url === '/task-status') {
    // GET /task-status?projectId=xxx
    const url = new URL(req.url, `http://127.0.0.1:${HIVE_PORT}`)
    const projectId = url.searchParams.get('projectId') || ''
    const homeDir = app.getPath('home')
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
        const homeDir = app.getPath('home')
        const task = createTask(homeDir, data.projectId, {
          title: data.title, status: 'pending', owner: null,
          batch: data.batch || 1, depends: data.depends || [],
          scope: data.scope || '.', acceptance: data.acceptance || '',
          verify: data.verify || [], attempt: 0, blocked_reason: null
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: task.id }))
        return
      } else if (req.url === '/task-assign') {
        const homeDir = app.getPath('home')
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        const task = updateTask(homeDir, projectId, data.taskId, { status: 'assigned', owner: data.agentId })
        if (task) {
          sendToAgent(data.agentId, 'TASK', task)
          appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_start', message: task.title })
        }
      } else if (req.url === '/task-done') {
        const homeDir = app.getPath('home')
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        const task = readTask(homeDir, projectId, data.taskId)

        // Run gate if worker has a worktree
        const cwd = findAgentWorktree(data.agentId)
        if (task && cwd && task.verify && task.verify.length > 0) {
          runGate(cwd, { scope: task.scope, verify: task.verify }).then((gateResult) => {
            if (gateResult.pass) {
              updateTask(homeDir, projectId, data.taskId, { status: 'done' })
              appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_done', message: data.summary || 'Task completed' })
              if (win && !win.isDestroyed()) win.webContents.send('agent:report', { ...data, type: 'task_done' })
              sendToAgent(data.agentId, 'MSG', { gate: 'pass', task: data.taskId })
              if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'done', summary: data.summary })
            } else {
              const attempt = (task.attempt || 0) + 1
              const maxRetries = ctx?.taskGroup?.maxGateRetries || 3
              if (attempt >= maxRetries) {
                updateTask(homeDir, projectId, data.taskId, { status: 'blocked', attempt, blocked_reason: gateResult.failures.map(f => `${f.step}: ${f.detail}`).join('; ') })
                sendToAgent(data.agentId, 'MSG', { gate: 'blocked', task: data.taskId, failures: gateResult.failures })
                if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'blocked', reason: 'gate failed after max retries' })
                notifyHuman('Gate Blocked', `${data.taskId}: ${gateResult.failures[0]?.detail || 'gate failed'}`)
              } else {
                updateTask(homeDir, projectId, data.taskId, { status: 'in_progress', attempt })
                sendToAgent(data.agentId, 'MSG', { gate: 'failed', task: data.taskId, attempt, maxRetries, failures: gateResult.failures })
              }
            }
          })
        } else {
          // No verify commands or no worktree — skip gate, mark done
          updateTask(homeDir, projectId, data.taskId, { status: 'done' })
          appendLog(data.agentId, { time: new Date().toISOString(), type: 'task_done', message: data.summary || 'Task completed' })
          if (win && !win.isDestroyed()) win.webContents.send('agent:report', { ...data, type: 'task_done' })
          if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'done', summary: data.summary })
        }
      } else if (req.url === '/task-blocked') {
        const homeDir = app.getPath('home')
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        updateTask(homeDir, projectId, data.taskId, {
          status: 'blocked', blocked_reason: data.reason, attempt: data.attempt || 0
        })
        appendLog(data.agentId, { time: new Date().toISOString(), type: 'notification', message: `BLOCKED: ${data.reason}` })
        if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, 'MSG', { task: data.taskId, status: 'blocked', reason: data.reason })
        notifyHuman('Task Blocked', `${data.taskId}: ${data.reason}`)
      } else if (req.url === '/task-status') {
        const homeDir = app.getPath('home')
        const ctx = findTaskGroupForAgent(data.agentId)
        const projectId = data.projectId || ctx?.projectId || ''
        const tasks = listTasks(homeDir, projectId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(tasks))
        return
      } else if (req.url === '/ready') {
        // Worker is about to /clear — delay notifying manager to allow clear to complete
        const ctx = findTaskGroupForAgent(data.agentId)
        if (ctx?.taskGroup) {
          setTimeout(() => {
            sendToAgent(ctx.taskGroup.managerId, 'MSG', { worker: data.agentId, status: 'ready' })
          }, 2000) // 2s delay: worker /clear takes ~1s, plus buffer
        }
      } else if (req.url === '/report-human') {
        notifyHuman('Manager', data.message || '')
        appendLog(data.agentId, { time: new Date().toISOString(), type: 'report', message: data.message })
      } else if (req.url === '/batch-propose') {
        if (win && !win.isDestroyed()) win.webContents.send('batch:proposal', data)
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

  yaml += `\n\n## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`

  // Inject role-specific soul addendum for task group agents
  if (config.taskGroupRole === 'manager') {
    yaml += getManagerSoulAddendum({ todoSource: config.todoSource || 'docs/todo.md' })
  } else if (config.taskGroupRole === 'worker') {
    yaml += getWorkerSoulAddendum({ maxRetries: config.maxGateRetries || 3 })
  } else if (config.taskGroupRole === 'qa') {
    yaml += getQaSoulAddendum()
  } else if (config.taskGroupRole === 'critic') {
    yaml += getCriticSoulAddendum()
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

  // hive-report.sh helper script
  const reportScript = join(cwd, '.claude', 'hive-report.sh')
  writeFileSync(reportScript, `#!/bin/bash
ACTION="$1"; MSG="$2"; AGENT="${config.agentId}"; PORT=${HIVE_PORT}
case "$ACTION" in
  start) curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}" > /dev/null 2>&1 ;;
  done) curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}" > /dev/null 2>&1 ;;
esac
`, { mode: 0o755 })

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
    mainWindow.show()
    if (is.dev) mainWindow.webContents.openDevTools({ mode: 'bottom' })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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
ipcMain.handle('data:load', () => loadData())
ipcMain.handle('data:save', (_event, data) => {
  saveData(data)
  return true
})

// Check if folder has .git
ipcMain.handle('fs:hasGit', (_event, { path }) => {
  return existsSync(join(path, '.git'))
})

// Git worktree management
ipcMain.handle('git:worktreeAdd', (_event, { repoPath, agentId, agentName }) => {
  try {
    const { execSync } = require('child_process')
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const branchName = `hive/${safeName}-${agentId.slice(-6)}`
    const worktreePath = join(repoPath, '..', `${repoPath.split('/').pop()}-${safeName}`)

    // Create branch from current HEAD if it doesn't exist
    try {
      execSync(`git -C "${repoPath}" branch "${branchName}"`, { encoding: 'utf-8', stdio: 'pipe' })
    } catch {} // Branch may already exist

    // Add worktree
    execSync(`git -C "${repoPath}" worktree add "${worktreePath}" "${branchName}"`, { encoding: 'utf-8', stdio: 'pipe' })

    return { ok: true, path: worktreePath, branch: branchName }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('git:worktreeRemove', (_event, { repoPath, worktreePath }) => {
  try {
    const { execSync } = require('child_process')
    execSync(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`, { encoding: 'utf-8', stdio: 'pipe' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('git:worktreeList', (_event, { repoPath }) => {
  try {
    const { execSync } = require('child_process')
    const output = execSync(`git -C "${repoPath}" worktree list --porcelain`, { encoding: 'utf-8' })
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
    const branchName = `integration/batch-${batchNum}`
    execSync(`git -C "${repoPath}" checkout -b ${branchName} main`, { encoding: 'utf-8' })
    const mergeResults: { branch: string; ok: boolean; error?: string }[] = []
    for (const branch of workerBranches) {
      try {
        execSync(`git -C "${repoPath}" merge --no-ff ${branch} -m "merge ${branch} into ${branchName}"`, { encoding: 'utf-8' })
        mergeResults.push({ branch, ok: true })
      } catch (err: any) {
        mergeResults.push({ branch, ok: false, error: (err.message || '').slice(0, 200) })
        // Abort failed merge
        try { execSync(`git -C "${repoPath}" merge --abort`, { encoding: 'utf-8' }) } catch {}
        break
      }
    }
    const allOk = mergeResults.every(r => r.ok)
    if (allOk) {
      execSync(`git -C "${repoPath}" push origin ${branchName}`, { encoding: 'utf-8' })
    }
    return { ok: allOk, branch: branchName, results: mergeResults }
  } catch (err: any) {
    return { ok: false, error: (err.message || '').slice(0, 300) }
  }
})

// Git clone
ipcMain.handle('git:clone', async (_event, { url, destPath, token, provider }: { url: string; destPath: string; token?: string; provider?: string }) => {
  try {
    const { execSync } = require('child_process')
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
    execSync(`git clone "${cloneUrl}" "${destPath}"`, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 })
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
  const SKIP = new Set(['node_modules', '.git', '.next', '.cache', '.hive', '.claude', '__pycache__', '.DS_Store', '.Trash', '.Spotlight-V100', 'dist', 'build', 'out'])
  const files: { path: string; mtime: number; size: number }[] = []

  function walk(dir: string, depth: number) {
    if (depth > 5 || files.length > limit * 2) return
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
  return skills
})

app.whenReady().then(() => {
  app.setName('Hive')
  electronApp.setAppUserModelId('com.hive.app')
  statusServer.listen(HIVE_PORT, '127.0.0.1', () => {
    console.log(`[Hive] Status server on http://127.0.0.1:${HIVE_PORT}`)
  })
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
  if (process.platform !== 'darwin') app.quit()
})
