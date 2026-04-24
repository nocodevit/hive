import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ipcMain, BrowserWindow, app } from 'electron'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerm } from '@xterm/headless'

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

/**
 * Replay the most-recent session history from Claude Code's own persistence
 * at ~/.claude/projects/<cwd-slug>/<session-id>.jsonl. Each line is an event
 * in the same shape we stream to the renderer, so we just forward them as
 * `historical: true` chat events. Enables the Chat timeline to show prior
 * messages when `continueSession` is set — without this, `claude -c`
 * loads the model context but never re-emits past messages to stdout.
 */
function replaySessionHistory(sessionId: string, cwd: string | undefined) {
  try {
    const slug = (cwd || '').replace(/\//g, '-')
    const dir = join(homedir(), '.claude', 'projects', slug)
    if (!existsSync(dir)) return
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (!files.length) return
    const latest = join(dir, files[0].f)
    const lines = readFileSync(latest, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        // Reshape Claude Code's local persistence into the stream-json
        // event shape the renderer already handles.
        if (ev.type === 'user' && ev.message?.content) {
          broadcast(`chat:event:${sessionId}`, {
            type: 'user',
            message: ev.message,
            session_id: ev.sessionId,
            _historical: true
          })
        } else if (ev.type === 'assistant' && ev.message) {
          broadcast(`chat:event:${sessionId}`, {
            type: 'assistant',
            message: ev.message,
            session_id: ev.sessionId,
            _historical: true
          })
        }
        // file-history-snapshot, summary, etc. are skipped — not user-visible.
      } catch {}
    }
    broadcast(`chat:event:${sessionId}`, {
      type: 'system',
      subtype: 'history_replayed',
      session_id: sessionId,
      file: latest,
      count: lines.length
    })
  } catch {}
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
    '--include-hook-events',
    '--permission-prompt-tool', 'stdio', // claude emits control_request on stdout; we must reply with control_response on stdin (handled below)
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

  // When resuming, replay the most-recent local session file so the UI
  // shows the conversation history, not just the live stream from here.
  if (opts.continueSession) {
    setTimeout(() => replaySessionHistory(id, opts.cwd), 100)
  }

  // Usage snapshot. Two parallel data sources:
  //  1. ccusage (local, reads ~/.claude/sessions/) — gives costUSD / burn /
  //     projected for the current 5h block. Zero API cost.
  //  2. Headless interactive claude + /usage TUI scrape — gives the real
  //     subscription %% (what `/usage` shows). ~1 API turn per call.
  //
  // Triggered ONLY on each assistant message_stop (see child.stdout.on
  // below, debounced 30s). No idle timer — avoids burning /usage turns
  // while the user stares at the UI without talking to Claude.
  const refresh = async () => {
    const [cc, pct] = await Promise.all([
      queryUsageViaCcusage(),
      queryUsagePctViaPty(opts.cwd)
    ])
    if (cc || pct) broadcast(`chat:usage:${session.id}`, { ...(cc || {}), ...(pct || {}) })
  }
  // One snapshot at startup so the status bar isn't blank until the
  // first message lands.
  refresh()

  let lastMessageStopRefresh = 0
  child.stdout.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf8')
    const { events, rest } = parseJsonLines(session.buffer, id)
    session.buffer = rest
    let sawMessageStop = false
    for (const ev of events) {
      broadcast(`chat:event:${id}`, ev)
      try { appendFileSync(session.logPath, JSON.stringify(ev) + '\n') } catch {}
      if (ev?.type === 'stream_event' && ev.event?.type === 'message_stop') sawMessageStop = true
    }
    // message_stop is our only refresh trigger now. One user turn may
    // produce many rate_limit_events (multiple tool calls) but only one
    // message_stop at the end, so this is the right rate. Debounce
    // 30s to cover consecutive quick exchanges.
    if (sawMessageStop && Date.now() - lastMessageStopRefresh > 30000) {
      lastMessageStopRefresh = Date.now()
      setTimeout(() => refresh(), 1500) // give claude's internal rate_limits a moment to settle
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

/**
 * Respond to a pending control_request (permission prompt). Claude's
 * schema expects one of (confirmed via live ZodError):
 *
 *   allow:  { updatedInput: <original or modified tool input record> }
 *   deny:   { behavior: "deny", message: "<human reason>" }
 *
 * Writes a control_response JSON frame to the subprocess's stdin so it
 * unblocks. Caller must pass the original tool input so we can echo it
 * in updatedInput for the allow path.
 */
export function respondPermission(
  id: string,
  requestId: string,
  decision: 'allow' | 'deny',
  input?: Record<string, unknown>,
  denyMessage?: string
) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  const inner = decision === 'allow'
    ? { updatedInput: input || {} }
    : { behavior: 'deny', message: denyMessage || 'Denied by user' }
  const frame = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: inner
    }
  }
  try {
    session.child.stdin.write(JSON.stringify(frame) + '\n')
    try { appendFileSync(session.logPath, JSON.stringify({ _direction: 'stdin', ...frame }) + '\n') } catch {}
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
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

/**
 * Spawn a headless interactive `claude` under a PTY, pipe every byte
 * into `@xterm/headless` so the terminal state machine handles ANSI
 * cursor moves / erase / scroll correctly, then read the TUI's grid as
 * clean text and extract "Current session … NN% used" and
 * "Current week … NN% used" lines.
 *
 * This is the only way to surface the real subscription-tier %% that
 * /usage shows — stream-json doesn't carry them, and --print /usage is
 * short-circuited to a synthetic canned reply. Uses xterm-headless so
 * TUI redraws don't break the regex.
 */
async function queryUsagePctViaPty(cwd?: string): Promise<{ fiveHour?: number; sevenDay?: number } | null> {
  return new Promise(resolve => {
    let done = false
    let child: pty.IPty | null = null
    const finish = (v: { fiveHour?: number; sevenDay?: number } | null) => {
      if (done) return
      done = true
      try { child?.kill() } catch {}
      resolve(v)
    }

    try {
      // Force a fresh session id so this PTY scrape can never accidentally
      // attach to an agent's live session (especially Tracy's).
      const freshSessionId = require('crypto').randomUUID()
      child = pty.spawn('claude', ['--session-id', freshSessionId], {
        name: 'xterm-256color',
        cols: 160, rows: 50,
        cwd: cwd || process.env.HOME || '/',
        env: process.env as any
      })
    } catch {
      return finish(null)
    }

    const term = new HeadlessTerm({ cols: 160, rows: 50, scrollback: 1000, allowProposedApi: true })
    let sent = false
    let promptSeenAt = 0
    let scrapeTimer: NodeJS.Timeout | null = null

    const dumpGrid = (): string => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (line) lines.push(line.translateToString(true))
      }
      return lines.join('\n')
    }

    const tryScrape = () => {
      const text = dumpGrid()
      const session = text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/)
      const week = text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/)
      if (session || week) {
        finish({
          fiveHour: session ? parseInt(session[1], 10) : undefined,
          sevenDay: week ? parseInt(week[1], 10) : undefined
        })
      }
    }

    child.onData((d: string) => {
      term.write(d, () => {
        // Stage 1: wait for prompt glyph → send /usage.
        if (!sent) {
          const firstTen = dumpGrid().split('\n').slice(0, 20).join('\n')
          if (firstTen.includes('❯') || /^\s*>\s/m.test(firstTen)) {
            sent = true
            promptSeenAt = Date.now()
            setTimeout(() => { try { child?.write('/usage\r') } catch {} }, 500)
          }
          return
        }
        // Stage 2: after /usage, let the TUI settle a moment then scrape.
        if (Date.now() - promptSeenAt < 700) return
        if (scrapeTimer) clearTimeout(scrapeTimer)
        scrapeTimer = setTimeout(tryScrape, 300)
      })
    })
    child.onExit(() => finish(null))

    setTimeout(() => finish(null), 25000)
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
  ipcMain.handle('chat:respondPermission', (_e, { id, requestId, decision, input, denyMessage }) =>
    respondPermission(id, requestId, decision, input, denyMessage)
  )
  ipcMain.handle('chat:stop', (_e, { id }) => { stopChat(id); return { ok: true } })
}
