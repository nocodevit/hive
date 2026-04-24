import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
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

interface StartOpts {
  cwd?: string
  agent?: string
  name?: string
  continueSession?: boolean
  rebaseOnStart?: boolean
  resumeSid?: string  // when present, uses --resume <sid> instead of a fresh session
}

interface ChatSession {
  id: string
  child: ChildProcessWithoutNullStreams | null
  buffer: string
  startedAt: number
  logPath: string
  cwd?: string
  usageTimer?: NodeJS.Timeout
  // Replay state for "Load older" — records the jsonl file we replayed
  // from and the starting line index. Clicking the button walks the
  // cursor back a batch and emits earlier events with _prepend:true.
  replayFile?: string
  replayedFrom?: number
  // session_id captured from the system/init event so we can --resume
  // after round-tripping through the interactive TUI (/remote-control).
  claudeSid?: string
  // Original opts from startChat, preserved so we can re-spawn on resume.
  startOpts?: StartOpts
  // Interactive TUI handle while /remote-control is active. null when idle.
  rcPty?: pty.IPty
  mode: 'print' | 'rc'
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

/**
 * Retention sweep for ~/.hive/chat-logs. Deletes .jsonl files whose mtime
 * is older than 30 days. Runs once per main-process startup — cheap; no
 * timer needed since app lifetime rarely spans >30d, and the next launch
 * will catch whatever this one missed. Never touches ~/.claude/projects
 * (that's Claude Code's own persistence, not ours to prune).
 */
const LOG_RETENTION_DAYS = 30
function sweepOldLogs() {
  try {
    const dir = logDir()
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000
    let removed = 0
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(dir, f)
      try {
        const m = statSync(path).mtimeMs
        if (m < cutoff) {
          unlinkSync(path)
          removed++
        }
      } catch {}
    }
    if (removed > 0) console.log(`[chat] retention: removed ${removed} log(s) older than ${LOG_RETENTION_DAYS}d`)
  } catch (e) {
    console.warn('[chat] retention sweep failed:', e)
  }
}
// Fire once when this module is first imported (main process startup).
sweepOldLogs()

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
const DEFAULT_REPLAY_LIMIT = 500

function replaySessionHistory(sessionId: string, cwd: string | undefined, limit = DEFAULT_REPLAY_LIMIT) {
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
    const startIdx = Math.max(0, lines.length - limit)
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i]
      try {
        const ev = JSON.parse(line)
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
      } catch {}
    }
    // Record where we started so "Load older" can walk earlier.
    const session = sessions.get(sessionId)
    if (session) {
      session.replayFile = latest
      session.replayedFrom = startIdx
    }
    broadcast(`chat:event:${sessionId}`, {
      type: 'system',
      subtype: 'history_replayed',
      session_id: sessionId,
      file: latest,
      count: lines.length - startIdx,
      total: lines.length,
      hasOlder: startIdx > 0
    })
  } catch {}
}

/**
 * Load the next batch of older events from the recorded replay file.
 * Emits a single `chat:prepend:<id>` broadcast containing the raw events
 * array (client flattens + prepends atomically to avoid reverse-scrolling
 * flicker). Silently no-ops if no prior replay happened or cursor is 0.
 */
export function loadOlderHistory(sessionId: string, batch = DEFAULT_REPLAY_LIMIT) {
  const session = sessions.get(sessionId)
  if (!session?.replayFile || session.replayedFrom === undefined) return { loaded: 0, hasOlder: false }
  if (session.replayedFrom === 0) return { loaded: 0, hasOlder: false }
  try {
    const lines = readFileSync(session.replayFile, 'utf8').split('\n').filter(Boolean)
    const newStart = Math.max(0, session.replayedFrom - batch)
    const events: any[] = []
    for (let i = newStart; i < session.replayedFrom; i++) {
      try {
        const ev = JSON.parse(lines[i])
        if (ev.type === 'user' && ev.message?.content) {
          events.push({ type: 'user', message: ev.message, session_id: ev.sessionId, _historical: true })
        } else if (ev.type === 'assistant' && ev.message) {
          events.push({ type: 'assistant', message: ev.message, session_id: ev.sessionId, _historical: true })
        }
      } catch {}
    }
    session.replayedFrom = newStart
    broadcast(`chat:prepend:${sessionId}`, { events, hasOlder: newStart > 0 })
    return { loaded: events.length, hasOlder: newStart > 0 }
  } catch (e) {
    return { loaded: 0, hasOlder: false, error: String(e) }
  }
}

export function startChat(id: string, opts: StartOpts = {}) {
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
  // `-c` = continue most recent session; `--resume <sid>` = resume a
  // specific session id (used by resumeFromRemoteControl after the
  // interactive TUI round-trip). `--resume` wins if both are set.
  if (opts.resumeSid) args.push('--resume', opts.resumeSid)
  else if (opts.continueSession) args.push('-c')

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
  const session: ChatSession = {
    id, child, buffer: '', startedAt: Date.now(), logPath, cwd: opts.cwd,
    mode: 'print', startOpts: opts, claudeSid: opts.resumeSid
  }
  sessions.set(id, session)

  // When resuming (either -c or --resume <sid>), replay the most-recent
  // local session file so the UI shows the conversation history, not just
  // the live stream from here.
  if (opts.continueSession || opts.resumeSid) {
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
      // Stash the claude session_id from system/init so remote-control
      // can --resume exactly this session after the TUI round-trip.
      if (ev?.type === 'system' && ev?.subtype === 'init' && ev?.session_id && !session.claudeSid) {
        session.claudeSid = ev.session_id
      }
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
  if (!session.child || session.mode !== 'print') return { ok: false, error: 'not_in_print_mode' }
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
  if (!session.child || session.mode !== 'print') return { ok: false, error: 'not_in_print_mode' }
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
  try { session.child?.kill() } catch {}
  try { session.rcPty?.kill() } catch {}
  if (session.usageTimer) clearInterval(session.usageTimer)
  sessions.delete(id)
}

/**
 * Round-trip through the interactive TUI to run a session-scoped slash
 * command (currently only /remote-control; the plumbing generalizes).
 *
 *   --print session ──[kill]──►  (nothing)
 *                                     │
 *                          node-pty ──┴──► claude --resume <sid>
 *                                              │
 *                                              ├─ stdout → chat:rc_output:<id>
 *                                              │     (so the UI can surface
 *                                              │      pairing URLs, QR, etc.)
 *                                              └─ we write `/remote-control\r`
 *                                                 after a short settle.
 *
 * The PTY stays alive until resumeFromRemoteControl is called, at which
 * point we kill it and spawn a fresh --print --resume <sid> that picks
 * up any turns the user drove from their phone while PTY was open.
 */
export function startRemoteControl(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (session.mode === 'rc') return { ok: false, error: 'already_in_rc' }
  if (!session.claudeSid) return { ok: false, error: 'no_sid_yet' }
  const sid = session.claudeSid
  try { session.child?.kill() } catch {}
  session.child = null
  session.mode = 'rc'
  const rcPty = pty.spawn('claude', ['--resume', sid], {
    name: 'xterm-color',
    cols: 120, rows: 30,
    cwd: session.cwd || process.env.HOME || '/',
    env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }
  })
  session.rcPty = rcPty
  rcPty.onData((data: string) => {
    broadcast(`chat:rc_output:${id}`, data)
    try { appendFileSync(session.logPath, JSON.stringify({ _direction: 'rc_stdout', data }) + '\n') } catch {}
  })
  // Wait for prompt to be ready, then fire /remote-control.
  setTimeout(() => { try { rcPty.write('/remote-control\r') } catch {} }, 1000)
  rcPty.onExit((_e) => {
    broadcast(`chat:rc_exit:${id}`, {})
  })
  broadcast(`chat:event:${id}`, {
    type: 'system',
    subtype: 'rc_started',
    session_id: id,
    claude_sid: sid
  })
  return { ok: true, sid }
}

/**
 * Leave remote-control mode: kill the PTY, re-spawn --print with the
 * same session-id. The renderer's Load Older / replay machinery
 * automatically picks up any new turns that were driven from the phone
 * during the PTY phase (they live in the same JSONL file).
 */
export function resumeFromRemoteControl(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (session.mode !== 'rc') return { ok: false, error: 'not_in_rc' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'missing_state' }
  try { session.rcPty?.kill() } catch {}
  const opts = session.startOpts
  const sid = session.claudeSid
  // Drop the session entry so startChat's "if (sessions.has(id)) return"
  // doesn't short-circuit. startChat recreates with --resume.
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
  return { ok: true, sid }
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
  ipcMain.handle('chat:loadOlder', (_e, { id, batch }) => loadOlderHistory(id, batch))
  ipcMain.handle('chat:startRemoteControl', (_e, { id }) => startRemoteControl(id))
  ipcMain.handle('chat:resumeFromRemoteControl', (_e, { id }) => resumeFromRemoteControl(id))
}
