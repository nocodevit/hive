import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync, statSync, lstatSync } from 'fs'
import { createServer } from 'http'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as pty from 'node-pty'

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
const HIVE_PORT = 17710

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

// Status + report webhook server — receives hook calls from Claude Code
const statusServer = createServer((req, res) => {
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
      }

      res.writeHead(200)
      res.end('ok')
    } catch {
      res.writeHead(400)
      res.end('bad request')
    }
  })
})

// Write Claude Code hooks config for an agent
function writeAgentHooks(cwd: string, agentId: string) {
  const claudeDir = join(cwd, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  const settingsPath = join(claudeDir, 'settings.local.json')

  const curlPost = (endpoint: string, jsonBody: string) =>
    `curl -s -X POST http://127.0.0.1:${HIVE_PORT}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`

  const settings = {
    hooks: {
      Stop: [
        {
          matcher: '',
          hooks: [{
            type: 'command',
            command: curlPost('/status', `{"agentId":"${agentId}","status":"waiting","event":"stop"}`)
          }]
        }
      ],
      PreToolUse: [
        {
          matcher: '',
          hooks: [{
            type: 'command',
            command: curlPost('/status', `{"agentId":"${agentId}","status":"working","event":"tool_use"}`)
          }]
        }
      ],
      Notification: [
        {
          matcher: '',
          hooks: [{
            type: 'command',
            command: curlPost('/report', `{"agentId":"${agentId}","type":"notification","message":"Agent needs attention"}`)
          }]
        }
      ]
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

  // Setup agent-specific memory directory
  const memoryDir = join(app.getPath('home'), '.hive', 'memory', agentId)
  mkdirSync(memoryDir, { recursive: true })
  const cwdMemory = join(claudeDir, 'memory')
  // Remove existing memory dir/link if present
  try {
    const stat = require('fs').lstatSync(cwdMemory)
    if (stat.isSymbolicLink()) unlinkSync(cwdMemory)
  } catch {}
  // Symlink agent memory
  if (!existsSync(cwdMemory)) {
    symlinkSync(memoryDir, cwdMemory)
  }

  // Helper scripts for agent to report to Hive
  const reportScript = join(claudeDir, 'hive-report.sh')
  writeFileSync(reportScript, `#!/bin/bash
# Report task progress to Hive
# Usage:
#   .claude/hive-report.sh start "Fixing login bug"
#   .claude/hive-report.sh done "Fixed login bug, added validation"
#   .claude/hive-report.sh todo '{"items":[{"text":"Fix bug","done":false}]}'

ACTION="$1"
MSG="$2"
AGENT="${agentId}"
PORT=${HIVE_PORT}

case "$ACTION" in
  start)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  done)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  todo)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"todo\\",$(echo $MSG | sed 's/^{//')}" > /dev/null 2>&1
    ;;
esac
`, { mode: 0o755 })
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
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.cache', '.hive', '__pycache__', '.DS_Store'])
  const files: { path: string; mtime: number; size: number }[] = []

  function walk(dir: string, depth: number) {
    if (depth > 5 || files.length > limit * 2) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue
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

// Read skill file content
ipcMain.handle('skills:readContent', (_event, { path: skillPath }) => {
  const skillMd = join(skillPath, 'SKILL.md')
  try {
    if (existsSync(skillMd)) return readFileSync(skillMd, 'utf-8')
  } catch {}
  return null
})

// Soul file management
const SOULS_DIR = join(app.getPath('home'), '.hive', 'souls')

ipcMain.handle('agent:writeSoul', (_event, { agentId, content }) => {
  mkdirSync(SOULS_DIR, { recursive: true })
  writeFileSync(join(SOULS_DIR, `${agentId}.md`), content)
  return true
})

ipcMain.handle('agent:deleteSoul', (_event, { agentId }) => {
  const file = join(SOULS_DIR, `${agentId}.md`)
  try { if (existsSync(file)) unlinkSync(file) } catch {}
  return true
})

// Load agent work logs
ipcMain.handle('agent:loadLogs', (_event, { agentId }) => {
  return loadLogs(agentId)
})

// Generate job-pickup prompt from recent logs
ipcMain.handle('agent:jobPickup', (_event, { agentId, agentName, agentRole }) => {
  const logs = loadLogs(agentId)
  if (logs.length === 0) return null

  // Get last 20 entries
  const recent = logs.slice(-20)
  const tasks: string[] = []
  let lastTask = ''
  let lastDone = ''
  let lastStatus = ''

  for (const log of recent) {
    if (log.type === 'task_start') lastTask = log.message
    if (log.type === 'task_done') { lastDone = log.message; lastTask = '' }
    if (log.type === 'status') lastStatus = log.message
  }

  // Build pickup prompt
  let prompt = `You are ${agentName} (${agentRole}). Here is your recent work history:\n\n`

  for (const log of recent.slice(-10)) {
    const time = new Date(log.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    if (log.type === 'task_start') prompt += `[${time}] STARTED: ${log.message}\n`
    else if (log.type === 'task_done') prompt += `[${time}] COMPLETED: ${log.message}\n`
    else if (log.type === 'status' && log.message === 'waiting') prompt += `[${time}] Paused\n`
  }

  if (lastTask) {
    prompt += `\nYou were working on: "${lastTask}" but did NOT finish.\nPlease continue this task from where you left off.`
  } else if (lastDone) {
    prompt += `\nYour last completed task: "${lastDone}"\nCheck if there are follow-up tasks or ask what to do next.`
  } else {
    prompt += `\nReview your history above and ask what to work on next.`
  }

  prompt += `\n\n## Hive Resources
- Your work logs: ~/.hive/logs/${agentId}.json
- Your soul: ~/.hive/souls/${agentId}.md
- Your memory: ~/.hive/memory/${agentId}/
- Report task start: .claude/hive-report.sh start "task title"
- Report task done: .claude/hive-report.sh done "summary"
- Project dashboard todos: read TODO.md or any markdown with checkboxes in your work zone`

  return prompt
})

// Clear agent work logs
ipcMain.handle('agent:clearLogs', (_event, { agentId }) => {
  const logFile = join(LOGS_DIR, `${agentId}.json`)
  try { writeFileSync(logFile, '[]') } catch {}
  return true
})

// Write Claude Code hooks for agent status reporting
ipcMain.handle('agent:setupHooks', (_event, { cwd, agentId }) => {
  try {
    writeAgentHooks(cwd, agentId)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Link enabled skills to agent's working directory
ipcMain.handle('skills:link', (_event, { cwd, skillPaths }: { cwd: string; skillPaths: string[] }) => {
  try {
    const targetDir = join(cwd, '.claude', 'skills')
    mkdirSync(targetDir, { recursive: true })

    // Clean existing symlinks in target
    if (existsSync(targetDir)) {
      const existing = readdirSync(targetDir, { withFileTypes: true })
      for (const entry of existing) {
        const fullPath = join(targetDir, entry.name)
        if (entry.isSymbolicLink()) {
          unlinkSync(fullPath)
        }
      }
    }

    // Create new symlinks
    for (const skillPath of skillPaths) {
      const skillName = skillPath.split('/').pop()!
      const linkPath = join(targetDir, skillName)
      if (!existsSync(linkPath)) {
        symlinkSync(skillPath, linkPath)
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('skills:link error:', err)
    return { ok: false, error: String(err) }
  }
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
