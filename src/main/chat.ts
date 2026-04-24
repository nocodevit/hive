import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, BrowserWindow, app } from 'electron'

/**
 * Spawn a `claude --print --input-format stream-json --output-format stream-json`
 * subprocess per chat session. stdin accepts JSON user messages, stdout
 * emits JSON events that we forward to the renderer as-is.
 *
 * This is the "Hive Chat" data path — Pretty-mode decoration is suspended
 * and not used here. See docs/structured-events.md for the expected event
 * shapes once they're confirmed empirically.
 */

interface ChatSession {
  id: string
  child: ChildProcessWithoutNullStreams
  buffer: string
  startedAt: number
  logPath: string
  cwd?: string
  usageTimer?: NodeJS.Timeout
}

const sessions = new Map<string, ChatSession>()

/**
 * Every chat session tees its raw JSON event stream to disk under
 * ~/.hive/chat-logs/<session-id>-<timestamp>.jsonl. This gives us a real
 * corpus of captured events for iterating on renderers without asking
 * the user to manually run `claude --print` every time.
 */
function logDir(): string {
  const base = process.env.HIVE_DATA_DIR || join(app.getPath('home'), '.hive')
  const dir = join(base, 'chat-logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function broadcast(event: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload)
  }
}

function parseJsonLines(buf: string, sessionId: string): { events: any[]; rest: string } {
  const events: any[] = []
  let rest = buf
  while (true) {
    const nl = rest.indexOf('\n')
    if (nl < 0) break
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch (e) {
      // Swallow parse errors but keep session alive. Real parse bugs will
      // surface in logs; we don't want a malformed frame to kill chat.
      console.warn(`[chat ${sessionId}] JSON parse fail:`, line.slice(0, 200))
    }
  }
  return { events, rest }
}

export function startChat(id: string, opts: {
  cwd?: string
  agent?: string
  name?: string
  continueSession?: boolean   // mirror of the Term `-c` flag
  rebaseOnStart?: boolean     // mirror Term behavior: rebase onto origin/<base> before Claude
} = {}) {
  if (sessions.has(id)) return
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--include-hook-events',          // surface permission_request + lifecycle events
    '--permission-prompt-tool', 'stdio', // let Claude ask us over stdio instead of assuming TTY
    '--verbose'
  ]
  if (opts.agent) args.push('--agent', opts.agent)
  if (opts.name) args.push('-n', opts.name)
  if (opts.continueSession) args.push('-c')

  // Mirror Term's rebase-on-start: fetch + rebase onto first of
  // develop/main/master that the remote has. Only if explicitly enabled
  // and a cwd is given. Runs synchronously before spawning claude; its
  // output goes to the renderer via the stderr channel so the user sees
  // what happened.
  if (opts.rebaseOnStart && opts.cwd) {
    try {
      const cmd = `git fetch origin 2>&1 && BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && [ -n "$BASE" ] && echo "⏳ Rebasing onto origin/$BASE" && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"`
      const out = execSync(cmd, { cwd: opts.cwd, encoding: 'utf8', shell: '/bin/bash' })
      broadcast(`chat:stderr:${id}`, out)
    } catch (e: any) {
      broadcast(`chat:stderr:${id}`, `Rebase failed: ${e.stdout ?? ''}${e.stderr ?? ''}\n`)
    }
  }

  const child = spawn('claude', args, {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const logPath = join(logDir(), `${id}-${Date.now()}.jsonl`)
  const session: ChatSession = { id, child, buffer: '', startedAt: Date.now(), logPath, cwd: opts.cwd }
  sessions.set(id, session)

  // Usage via ccusage (reads ~/.claude/sessions/ directly, zero API calls).
  // Fires at startup + every 5 min so the status bar tracks burn in near-real-time.
  const refresh = () => {
    queryUsageViaCcusage().then(usage => {
      if (usage) broadcast(`chat:usage:${session.id}`, usage)
    }).catch(() => {})
  }
  refresh()
  session.usageTimer = setInterval(refresh, 5 * 60 * 1000)

  child.stdout.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf8')
    const { events, rest } = parseJsonLines(session.buffer, id)
    session.buffer = rest
    for (const ev of events) {
      broadcast(`chat:event:${id}`, ev)
      // Tee raw event to disk for offline replay / renderer development.
      try { appendFileSync(session.logPath, JSON.stringify(ev) + '\n') } catch {}
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    broadcast(`chat:stderr:${id}`, chunk.toString('utf8'))
  })
  child.on('exit', (code) => {
    broadcast(`chat:exit:${id}`, code)
    sessions.delete(id)
  })
  child.on('error', (err) => {
    broadcast(`chat:error:${id}`, String(err))
    sessions.delete(id)
  })
}

export function sendUserMessage(id: string, text: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  // stream-json expects {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  const frame = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }]
    }
  }
  try {
    const line = JSON.stringify(frame) + '\n'
    session.child.stdin.write(line)
    // Log outbound too so replay has complete context.
    try { appendFileSync(session.logPath, JSON.stringify({ _direction: 'stdin', ...frame }) + '\n') } catch {}
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function stopChat(id: string) {
  const session = sessions.get(id)
  if (!session) return
  try { session.child.kill() } catch {}
  if (session.usageTimer) clearInterval(session.usageTimer)
  sessions.delete(id)
}

/**
 * Query usage via `ccusage blocks --json`. Reads ~/.claude/sessions/* and
 * aggregates into 5-hour billing windows, so no extra API traffic.
 * Returns the active block's cost, burn rate, and projection.
 */
async function queryUsageViaCcusage(): Promise<{
  costUSD?: number
  burnPerHour?: number
  projectedUSD?: number
  remainingMinutes?: number
  totalTokens?: number
} | null> {
  return new Promise(resolve => {
    try {
      const child = spawn('ccusage', ['blocks', '--json'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
      child.on('error', () => resolve(null))
      child.on('exit', () => {
        try {
          const data = JSON.parse(out)
          const active = (data.blocks || []).find((b: any) => b.isActive)
          if (!active) return resolve(null)
          resolve({
            costUSD: active.costUSD,
            burnPerHour: active.burnRate?.costPerHour,
            projectedUSD: active.projection?.totalCost,
            remainingMinutes: active.projection?.remainingMinutes,
            totalTokens: active.totalTokens
          })
        } catch {
          resolve(null)
        }
      })
      setTimeout(() => { try { child.kill() } catch {}; resolve(null) }, 10000)
    } catch {
      resolve(null)
    }
  })
}

/** Legacy /usage path — slash command short-circuits in --print mode. Kept for reference. */
async function queryUsage(cwd?: string): Promise<{ fiveHour?: number; sevenDay?: number } | null> {
  return new Promise(resolve => {
    let done = false
    const finish = (value: { fiveHour?: number; sevenDay?: number } | null) => {
      if (done) return
      done = true
      resolve(value)
    }
    try {
      const child = spawn('claude', [
        '--print', '/usage',
        '--output-format', 'stream-json',
        '--verbose'
      ], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })

      let out = ''
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
      child.on('error', () => finish(null))
      child.on('exit', () => {
        const lines = out.split('\n').filter(Boolean)
        let text = ''
        for (const line of lines) {
          try {
            const ev = JSON.parse(line)
            if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
              for (const block of ev.message.content) {
                if (block.type === 'text') text += block.text + '\n'
              }
            } else if (ev.type === 'result' && typeof ev.result === 'string') {
              text += ev.result + '\n'
            }
          } catch {}
        }
        const fiveMatch = text.match(/5[\s-]?h(?:our)?[^%]*?(\d+(?:\.\d+)?)\s*%/i)
        const sevenMatch = text.match(/7[\s-]?d(?:ay)?[^%]*?(\d+(?:\.\d+)?)\s*%/i)
        const weeklyMatch = text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i)
        finish({
          fiveHour: fiveMatch ? Math.round(parseFloat(fiveMatch[1])) : undefined,
          sevenDay: sevenMatch ? Math.round(parseFloat(sevenMatch[1]))
                  : weeklyMatch ? Math.round(parseFloat(weeklyMatch[1]))
                  : undefined
        })
      })

      // Safety timeout: /usage should come back within ~15s on a good network.
      setTimeout(() => {
        try { child.kill() } catch {}
        finish(null)
      }, 30000)
    } catch {
      finish(null)
    }
  })
}

function refreshUsage(session: ChatSession) {
  queryUsage(session.cwd).then(usage => {
    if (usage) broadcast(`chat:usage:${session.id}`, usage)
  }).catch(() => {})
}

export function registerChatIpc() {
  ipcMain.handle('chat:start', (_e, { id, cwd, agent, name, continueSession, rebaseOnStart }) => {
    startChat(id, { cwd, agent, name, continueSession, rebaseOnStart })
    return { ok: true }
  })
  ipcMain.handle('chat:send', (_e, { id, text }) => sendUserMessage(id, text))
  ipcMain.handle('chat:stop', (_e, { id }) => { stopChat(id); return { ok: true } })
}
