import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
  resumeSid?: string     // --resume <sid>; preserves context.
  forkSession?: boolean  // pair with resumeSid: --fork-session creates a NEW session-id
                         //   inheriting old context. Used by 'Start with summary'.
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
  // Auto-continue after rate-limit reset. fireAt = unix-ms when the timer
  // will inject "Limit reset — please continue." as a normal user input.
  // 60s buffer past the resetsAt claude reports. Cancellable from UI.
  autoContinueTimer?: NodeJS.Timeout
  // Set when we kill the --print as part of an internal kill→respawn
  // dance (compact, smart-resume, scrape /context). The exit handler
  // checks this flag to suppress chat:exit broadcast and `sessions.delete`,
  // both of which would (a) flip the renderer into "session closed" panel
  // and (b) cause concurrent `chat.resumeSmart` calls to fail with
  // `no_session` until the respawn lands.
  internalRecycle?: boolean
  autoContinueAt?: number
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

/**
 * Auto-continue persistence — keyed by chat session id (chat-<agentId>).
 * Lives next to ~/.hive/chat-logs. App restart reloads pending timers.
 */
const AUTO_CONTINUE_FILE = (): string =>
  join(process.env.HIVE_DATA_DIR || join(app.getPath('home'), '.hive'), 'chat-auto-continue.json')
const AUTO_CONTINUE_BUFFER_MS = 60_000
const AUTO_CONTINUE_MSG = 'Limit reset — please continue.'

function loadAutoContinue(): Record<string, { fireAt: number }> {
  try { if (existsSync(AUTO_CONTINUE_FILE())) return JSON.parse(readFileSync(AUTO_CONTINUE_FILE(), 'utf-8')) } catch {}
  return {}
}
function saveAutoContinue(state: Record<string, { fireAt: number }>) {
  try { writeFileSync(AUTO_CONTINUE_FILE(), JSON.stringify(state)) } catch {}
}
function persistAutoContinue(id: string, fireAt: number | null) {
  const s = loadAutoContinue()
  if (fireAt == null) delete s[id]
  else s[id] = { fireAt }
  saveAutoContinue(s)
}

function scheduleAutoContinue(id: string, fireAt: number) {
  const session = sessions.get(id)
  if (!session) return
  if (session.autoContinueTimer) clearTimeout(session.autoContinueTimer)
  session.autoContinueAt = fireAt
  persistAutoContinue(id, fireAt)
  broadcast(`chat:autoContinue:${id}`, { at: fireAt })
  const delay = Math.max(0, fireAt - Date.now())
  session.autoContinueTimer = setTimeout(() => {
    const s = sessions.get(id)
    if (!s) return
    s.autoContinueTimer = undefined
    s.autoContinueAt = undefined
    persistAutoContinue(id, null)
    broadcast(`chat:autoContinue:${id}`, null)
    // Inject as normal user input. Same path the user's textarea uses;
    // claude treats it as the next conversational turn.
    sendUserMessage(id, AUTO_CONTINUE_MSG)
  }, delay)
}

export function cancelAutoContinue(id: string) {
  const session = sessions.get(id)
  if (session?.autoContinueTimer) clearTimeout(session.autoContinueTimer)
  if (session) {
    session.autoContinueTimer = undefined
    session.autoContinueAt = undefined
  }
  persistAutoContinue(id, null)
  broadcast(`chat:autoContinue:${id}`, null)
  return { ok: true }
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

/**
 * Process-wide /usage cache shared across all chat sessions. Subscription
 * %% is account-scoped, not session-scoped — N agents all see the same
 * numbers — so it's wasteful to spawn N independent PTY scrapes. The
 * cache holds the last result for `USAGE_TTL_MS`; concurrent callers
 * during a cold scrape await the in-flight promise rather than racing
 * extra PTYs of their own.
 */
const USAGE_TTL_MS = 30_000
interface CachedUsage {
  cc: any | null
  pct: { fiveHour?: number; sevenDay?: number; fiveHourReset?: string; sevenDayReset?: string } | null
  ts: number
}
let usageCache: CachedUsage | null = null
let usageInFlight: Promise<CachedUsage> | null = null

async function getSharedUsage(scrapeCwd?: string): Promise<CachedUsage> {
  if (usageCache && Date.now() - usageCache.ts < USAGE_TTL_MS) {
    return usageCache
  }
  if (usageInFlight) return usageInFlight
  usageInFlight = (async () => {
    const [cc, pct] = await Promise.all([
      queryUsageViaCcusage(),
      // Subscription %% IS account-level (same answer regardless of cwd),
      // BUT the interactive `claude` PTY we spawn here gates input on a
      // workspace-trust dialog the first time it sees an unfamiliar dir.
      // $HOME is unfamiliar → trust dialog blocks → /usage never sent →
      // scrape times out and caches a null. Use the caller's cwd (an
      // already-trusted agent project dir) so the dialog never fires.
      queryUsagePctViaPty(scrapeCwd || process.env.HOME || '/')
    ])
    const result: CachedUsage = { cc, pct, ts: Date.now() }
    // Don't cache a null pct — short-circuit so the next agent that
    // refreshes (likely with a different cwd) gets a fresh chance.
    if (pct) usageCache = result
    usageInFlight = null
    return result
  })()
  return usageInFlight
}

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

/**
 * Smart-startup wrapper: when `continueSession: true` AND a heavy
 * prior session exists (input_tokens / contextWindow > 50%), runs a
 * /compact PTY round-trip BEFORE spawning --print --resume <sid>.
 * Otherwise just calls startChat normally. Goal: every Hive open of
 * a long-lived agent gets auto-thinned context, no more 17-min hangs
 * from cache-miss + huge context on resume.
 */
export async function smartStartChat(id: string, opts: StartOpts = {}) {
  if (sessions.has(id)) return { ok: false, error: 'already_started' }
  if (opts.continueSession && opts.cwd && !opts.resumeSid) {
    try {
      const slug = opts.cwd.replace(/\//g, '-')
      const dir = join(homedir(), '.claude', 'projects', slug)
      if (existsSync(dir)) {
        const files = readdirSync(dir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
        if (files.length) {
          const sid = files[0].f.replace(/\.jsonl$/, '')
          const pct = readContextPctFromJsonl(opts.cwd, sid)
          if (pct !== null && pct > 0.5) {
            broadcast(`chat:stderr:${id}`, `⏳ Smart-startup: prior session ${(pct * 100).toFixed(0)}% context — running /compact first…\n`)
            const r = await runCompactViaPrint(opts.cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`))
            if (r.ok) {
              broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1000).toFixed(1)}s\n`)
            } else {
              broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1000).toFixed(1)}s) — context UNCHANGED, resuming anyway\n`)
            }
            // Resume the same sid AFTER compact (non-fork — JSONL was
            // updated in-place by /compact). Renderer's replay will
            // pick up the new compacted state.
            startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
            return { ok: true, compacted: r.ok, sid, pct }
          }
        }
      }
    } catch {
      // any fallback into plain start
    }
  }
  startChat(id, opts)
  return { ok: true, compacted: false }
}

/**
 * Run /compact via the `--print --resume <sid> /compact` channel
 * (claude treats positional slash command as an instruction, runs it
 * locally with full session context, writes a `compact_boundary` event
 * to the JSONL, then exits). No PTY, no xterm headless, no regex
 * guessing. The stream-json `result` event with `subtype: 'success'`
 * is the canonical completion signal.
 *
 * Why this beats the prior PTY-and-grep approach:
 *   - PTY path required loading TUI for ~10s on big sessions, then
 *     /compact ran for another 10-30s. 25s budget routinely timed
 *     out for 12k-line sessions like alex-data → user got "compact
 *     complete" toast but JSONL had no compact_boundary, so context
 *     stayed huge.
 *   - --print path streams events as JSON; we wait for `result.subtype`
 *     to land. No guessing needed.
 *
 * Caveats:
 *   - sid must be a real UUID (claude rejects free-form titles in
 *     `--print --resume`). Hive always stores UUIDs, so OK.
 *   - stdin must be closed (`< /dev/null` semantically) — we don't
 *     write to child.stdin. Otherwise claude waits 3s for piped data.
 *   - /compact bills the API call (~$0.30/session for the summarize
 *     turn). Same cost as the PTY path; that's just what /compact is.
 *
 * Caller is responsible for spawning the next --print after this
 * resolves. Persists every attempt to ~/.hive/compact-log.jsonl for
 * post-hoc debugging — no more "did my compact actually run?".
 */
async function runCompactViaPrint(
  cwd: string,
  sid: string,
  agent: string | undefined,
  timeoutMs = 600_000,
  onProgress?: (msg: string) => void
): Promise<{ ok: boolean; error?: string; durationMs: number; resultEvent?: any }> {
  const startedAt = Date.now()
  return new Promise(resolve => {
    let settled = false
    let buffer = ''
    let resultEvent: any = null
    let lastByteAt = startedAt
    // 30s heartbeat: if no result yet, broadcast `still running…Xs` so
    // the user sees the chat isn't hung. Resets when settled.
    const progressTimer = setInterval(() => {
      if (settled) return
      const elapsed = Date.now() - startedAt
      const sinceLastByte = Date.now() - lastByteAt
      onProgress?.(`/compact still running · ${Math.round(elapsed / 1000)}s elapsed${sinceLastByte > 30_000 ? ` · last claude output ${Math.round(sinceLastByte / 1000)}s ago` : ''}`)
    }, 30_000)

    const finish = (ok: boolean, error?: string) => {
      if (settled) return
      settled = true
      clearInterval(progressTimer)
      try { child.kill() } catch {}
      const durationMs = Date.now() - startedAt
      // Persist every attempt — success or fail — so the user can
      // verify "did compact actually run". Append-only JSONL.
      try {
        const logPath = join(homedir(), '.hive', 'compact-log.jsonl')
        try { mkdirSync(join(homedir(), '.hive'), { recursive: true }) } catch {}
        appendFileSync(logPath, JSON.stringify({
          ts: new Date().toISOString(),
          sid, cwd, ok, error, durationMs,
          resultSubtype: resultEvent?.subtype,
          resultUsd: resultEvent?.total_cost_usd,
          resultDurationMs: resultEvent?.duration_ms
        }) + '\n')
      } catch {}
      resolve({ ok, error, durationMs, resultEvent })
    }

    // CRITICAL: pass `--agent` so claude loads the same custom system
    // prompt (skills, soul, role) that the live --print uses. Without
    // it, claude treats the session as default-agent → different
    // system prompt → different cache key → conversation reload uses
    // a *different* context view → /compact's summary is computed
    // against the wrong system prompt and the resulting compact_boundary
    // can leave the JSONL in a weirdly inconsistent state. We saw this
    // empirically on alex-data: compact succeeded but ctx % stayed
    // pre-compact-high because claude's view of "what's in context"
    // didn't match Hive's.
    const args = ['--print', '--resume', sid, '/compact', '--output-format', 'stream-json', '--verbose']
    if (agent) args.unshift('--agent', agent)
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })

    // Close stdin immediately so claude doesn't wait 3s for piped input.
    try { child.stdin.end() } catch {}

    child.stdout.on('data', (chunk: Buffer) => {
      lastByteAt = Date.now()
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result') {
            resultEvent = ev
            const ok = ev.subtype === 'success' && !ev.is_error
            finish(ok, ok ? undefined : (ev.subtype || 'error'))
            return
          }
        } catch {}
      }
    })
    child.on('error', (err) => finish(false, `spawn_error: ${err.message}`))
    child.on('exit', (code) => {
      // result event already settled us. If we get exit without one,
      // treat as failure with the exit code.
      if (resultEvent) return
      finish(false, `exit_${code}`)
    })

    // Hard ceiling: 600s (10min). Even ~2k-line sessions on Opus 4.7
    // can take 90-180s for /compact's summarization LLM call when the
    // conversation has dense cache_read context (~1M tokens cumulative).
    // 120s was empirically too tight — 4 user attempts on 1.8k-line
    // alex-data session all timed out at 120s with no `result` event.
    setTimeout(() => finish(false, `timeout_after_${Math.round(timeoutMs / 1000)}s`), timeoutMs)
  })
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
  if (opts.resumeSid) {
    args.push('--resume', opts.resumeSid)
    if (opts.forkSession) args.push('--fork-session')
  } else if (opts.continueSession) {
    args.push('-c')
  }

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

  // Hydrate any pending auto-continue timer from disk. If app died after
  // we scheduled but before it fired, pick the timer back up. Stale
  // entries (fireAt already past + a generous grace) get fired
  // immediately or dropped.
  try {
    const pending = loadAutoContinue()[id]
    if (pending?.fireAt) {
      if (pending.fireAt > Date.now() - 5 * 60_000) {
        scheduleAutoContinue(id, pending.fireAt)
      } else {
        persistAutoContinue(id, null)
      }
    }
  } catch {}

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
    const { cc, pct } = await getSharedUsage(opts.cwd)
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
      // Auto-continue scheduling. claude's rate_limit_event with
      // status='rejected' means subsequent API calls are blocked until
      // resetsAt; but the --print process stays alive (verified
      // empirically — see CHANGELOG v1.7.69 / alex(data) 2026-04-25
      // log line 41674). Schedule a one-shot timer to fire 60s after
      // resetsAt that injects a "please continue" turn. Only schedule
      // once per rejection epoch — many tool calls in a single turn
      // each emit their own rate_limit_event.
      if (ev?.type === 'rate_limit_event' && ev.rate_limit_info?.status === 'rejected') {
        const resetsAt = ev.rate_limit_info.resetsAt
        if (typeof resetsAt === 'number' && !session.autoContinueTimer) {
          scheduleAutoContinue(id, resetsAt * 1000 + AUTO_CONTINUE_BUFFER_MS)
        }
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
    // When killed by signal (SIGTERM from stopChat), code is null.
    // Renderer's onExit sets state to that code; if null lands on
    // useState<number|null>(null), `exited !== null` stays false and
    // the close-session panel never renders. Coerce null → 0.
    const sess = sessions.get(id)
    if (sess?.internalRecycle) {
      // Caller (compactSession / resumeSmart / scrapeContextLive) is
      // killing the --print intentionally and will spawn a fresh one
      // under the same id within seconds. Don't notify the renderer;
      // don't drop the session entry — keeping it means `chat.resume*`
      // calls during the gap don't fail with `no_session`.
      return
    }
    broadcast(`chat:exit:${id}`, code ?? 0)
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
  // Both branches of the response union REQUIRE a `behavior` field
  // (this caught us out in v1.7.21 — Skill tool surfaced the real
  // ZodError that allow was being parsed as missing-behavior, not
  // just deny). Schema:
  //   allow: { behavior: "allow", updatedInput: <record> }
  //   deny:  { behavior: "deny",  message: <string> }
  const inner = decision === 'allow'
    ? { behavior: 'allow', updatedInput: input || {} }
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

/**
 * Cancel the current generation. Sends a `control_request` with
 * `subtype: "interrupt"` on stdin. Claude immediately stops the
 * current turn (mid-thinking, mid-tool-call, mid-text). Session
 * stays alive — user can send another message right after.
 *
 * Discovered by grepping the claude binary for `sendControlRequest`
 * patterns. Stop has no ACK event in stream-json land; we just
 * fire and trust.
 */
export function interruptSession(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (!session.child || session.mode !== 'print') return { ok: false, error: 'not_in_print_mode' }
  const frame = {
    type: 'control_request',
    request_id: `hive-int-${Date.now()}`,
    request: { subtype: 'interrupt' }
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
  if (session.autoContinueTimer) clearTimeout(session.autoContinueTimer)
  // NB: don't wipe the persisted entry — user may close+reopen the chat
  // and want the timer to resume. Hydration on next startChat handles it.
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
 * Read the LAST result event from claude's session JSONL and return
 * the input_tokens / contextWindow ratio. Used by smart-resume to
 * decide whether to /compact before resuming. Returns null if no
 * usable data (no JSONL, no result events, parse error).
 */
function readContextPctFromJsonl(cwd: string | undefined, sid: string): number | null {
  if (!cwd || !sid) return null
  try {
    const slug = cwd.replace(/\//g, '-')
    const file = join(homedir(), '.claude', 'projects', slug, `${sid}.jsonl`)
    if (!existsSync(file)) return null
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    // Walk backward looking for type=result with usage + modelUsage.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i])
        if (ev.type !== 'result') continue
        const inp = ev?.usage?.input_tokens
        const cacheRead = ev?.usage?.cache_read_input_tokens || 0
        const total = (typeof inp === 'number' ? inp : 0) + cacheRead
        const mu = ev?.modelUsage
        if (mu && typeof mu === 'object') {
          for (const k of Object.keys(mu)) {
            const cw = mu[k]?.contextWindow
            if (typeof cw === 'number' && cw > 0) {
              return total / cw
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null
}

/**
 * Smart resume: if the previous turn ate > 50% of the context window,
 * run /compact first to summarize old context, THEN re-spawn --print
 * --resume <sid>. Otherwise just re-spawn --print --resume <sid>
 * directly. Goal: avoid context-overflow hangs / cache misses on huge
 * sessions while keeping the cheap path for normal-sized ones.
 */
export async function resumeSmart(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'missing_state' }
  const sid = session.claudeSid
  const opts = session.startOpts
  const pct = readContextPctFromJsonl(session.cwd, sid)
  const needsCompact = pct !== null && pct > 0.5
  broadcast(`chat:stderr:${id}`,
    pct !== null
      ? `Resume: prior context ${(pct * 100).toFixed(0)}% used${needsCompact ? ' — running /compact first' : ''}\n`
      : 'Resume: no context data found, going direct\n'
  )
  if (needsCompact) {
    // Defer to compactSession which already does the round-trip then
    // respawns --print --resume <sid>. Done.
    return compactSession(id)
  }
  // Plain resume — flag recycle so chat:exit isn't broadcast during the
  // brief kill→spawn gap (renderer would otherwise flip to closed-panel).
  session.internalRecycle = true
  try { session.child?.kill() } catch {}
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
  return { ok: true, sid, compacted: false }
}

/**
 * Start with summary: compact the current session (so context shrinks
 * to a summary) → fork into a NEW session-id that inherits the
 * compacted context. Different from resumeSmart in two ways:
 *   - always compacts (unconditional)
 *   - the post-compact respawn uses --fork-session, so future writes
 *     go to a fresh JSONL while the model still remembers the summary.
 */
export async function startWithSummary(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'missing_state' }
  const sid = session.claudeSid
  const opts = session.startOpts
  const cwd = session.cwd || process.env.HOME || '/'
  broadcast(`chat:stderr:${id}`, '⏳ Compacting old context, then forking to new session-id…\n')
  session.internalRecycle = true
  try { session.child?.kill() } catch {}
  session.child = null
  const r = await runCompactViaPrint(cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`))
  // Always respawn — even on compact failure the user asked to fork,
  // and a fork without compact still creates the new sid (just with
  // unsummarized history).
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, forkSession: true, continueSession: false, rebaseOnStart: false })
  if (r.ok) {
    broadcast(`chat:stderr:${id}`, `✅ Compacted + forked to new session-id (${(r.durationMs / 1000).toFixed(1)}s)\n`)
  } else {
    broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1000).toFixed(1)}s) — forked WITHOUT summary\n`)
  }
  return { ok: r.ok, error: r.error }
}

/**
 * Run /compact via PTY round-trip and auto-resume --print.
 * Same plumbing as /remote-control but fully automatic (no UI panel
 * needed): kill --print → spawn PTY --resume <sid> → write /compact
 * → wait until prompt returns or 25s timeout → kill PTY → respawn
 * --print --resume <sid>. The user just sees a brief 'Compacting…'
 * system entry and the session continues with summarized context.
 */
export async function compactSession(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'session-id not yet captured — send a message first' }
  if (session.mode !== 'print') return { ok: false, error: 'not_in_print_mode' }
  const sid = session.claudeSid
  const opts = session.startOpts
  const cwd = session.cwd || process.env.HOME || '/'

  broadcast(`chat:event:${id}`, { type: 'system', subtype: 'info', session_id: id })
  broadcast(`chat:stderr:${id}`, '⏳ Compacting context — pausing chat\n')

  // Mark as recycle BEFORE kill so child.on('exit') skips broadcast +
  // sessions.delete. Without this, renderer flips to "session closed"
  // panel and any concurrent resumeSmart() races into `no_session`.
  session.internalRecycle = true
  try { session.child?.kill() } catch {}
  session.child = null

  // Run /compact via the throwaway --print --resume <sid> /compact
  // path. claude streams a `result` event when done — far more reliable
  // than the prior PTY-and-grep approach, which routinely timed out at
  // 25s on 12k-line sessions and silently failed.
  const r = await runCompactViaPrint(cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`))

  // Always respawn the chat regardless of compact outcome — user is
  // mid-conversation, they want their session back.
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
  if (r.ok) {
    broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1000).toFixed(1)}s · session resumed\n`)
  } else {
    broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1000).toFixed(1)}s) — context UNCHANGED, session resumed\n`)
  }
  return { ok: r.ok, error: r.error }
}

/**
 * Leave remote-control mode: politely hand the session back to local via
 * `/desktop`, then kill the PTY and re-spawn --print with the same
 * session-id. The renderer's Load Older / replay machinery automatically
 * picks up any new turns that were driven from the phone during the PTY
 * phase (they live in the same JSONL file).
 *
 * Why /desktop matters: /remote-control registers this session with
 * Claude's persistent remote-control server, claiming control on behalf
 * of the mobile/web client. Killing the local PTY without first running
 * /desktop leaves the server thinking the session is still mobile-claimed,
 * which can make --resume fail or deliver stale / partial state. /desktop
 * is the inverse: server releases the claim, mobile is disconnected, the
 * session goes back to "owned by local CLI". We give it ~1.5s to settle
 * before killing the PTY (no completion ACK in stream-json land).
 */
export async function resumeFromRemoteControl(id: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (session.mode !== 'rc') return { ok: false, error: 'not_in_rc' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'missing_state' }
  // Polite handover before tearing down.
  try {
    session.rcPty?.write('/desktop\r')
    await new Promise(r => setTimeout(r, 1500))
  } catch {}
  try { session.rcPty?.kill() } catch {}
  const opts = session.startOpts
  const sid = session.claudeSid
  // Drop the session entry so startChat's "if (sessions.has(id)) return"
  // doesn't short-circuit. startChat recreates with --resume.
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
  return { ok: true, sid }
}

export interface ContextRow { name: string; tokens: number; pct: number }
export interface ContextDetailRow { name: string; source?: string; server?: string; tokens: number }
export interface ContextSnapshot {
  model: string
  totalTokens: number
  totalLimit: number
  totalPct: number
  categories: ContextRow[]
  mcpTools: ContextDetailRow[]
  customAgents: ContextDetailRow[]
  memoryFiles: ContextDetailRow[]
  skills: ContextDetailRow[]
  scrapedAtMs: number
}

const contextCache = new Map<string, ContextSnapshot>()
const CONTEXT_TTL_MS = 5 * 60 * 1000  // 5 min

/**
 * Parse "9k" / "104.5k" / "685.4k" / "1.2m" / "159" → number of tokens.
 * The slash command emits human-rounded values; we accept m/M/k/K/raw.
 */
function parseTokenStr(s: string): number {
  if (!s) return 0
  const m = s.trim().match(/^([\d.]+)\s*([kKmM]?)$/)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  return Math.round(unit === 'm' ? n * 1_000_000 : unit === 'k' ? n * 1_000 : n)
}

/** Parse "28%" / "0.0%" → number. */
function parsePctStr(s: string): number {
  const m = (s || '').match(/([\d.]+)\s*%/)
  return m ? parseFloat(m[1]) : 0
}

/**
 * Pull rows out of a markdown table whose header is followed by a
 * separator row (`|---|---|...`). Skips `Tool|Server|Tokens` style and
 * generic `Category|Tokens|Percentage` style alike. Returns one
 * { cells: [...] } per row in source order.
 */
function parseMarkdownTable(markdown: string): { headers: string[], rows: string[][] } | null {
  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'))
  if (lines.length < 3) return null
  // Header row, separator row, then data rows.
  const splitRow = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const headers = splitRow(lines[0])
  if (!/^\|?\s*-+/.test(lines[1].replace(/\|/g, '|'))) {
    // Not a markdown table after all
    return null
  }
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) rows.push(splitRow(lines[i]))
  return { headers, rows }
}

/**
 * Slice the markdown by `### Header` sections. Returns a map of
 * lowercased section name → markdown body (everything until next `###`).
 */
function sliceMarkdownSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /^###\s+(.+)$/gm
  const matches: { name: string; idx: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ name: m[1].trim().toLowerCase(), idx: m.index })
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx
    const end = i + 1 < matches.length ? matches[i + 1].idx : markdown.length
    out[matches[i].name] = markdown.slice(start, end)
  }
  return out
}

/**
 * Convert the markdown produced by `/context` into a structured snapshot.
 * Sections we care about:
 *  - Estimated usage by category    (Category | Tokens | Percentage)
 *  - MCP Tools                       (Tool | Server | Tokens)
 *  - Custom Agents                   (Agent | Tokens) or similar
 *  - Memory Files                    (Path | Tokens)
 *  - Skills                          (Skill | Source | Tokens)
 */
function parseContextMarkdown(markdown: string): Omit<ContextSnapshot, 'scrapedAtMs'> {
  // Header line: **Tokens:** 281.6k / 1m (28%)
  const tokenMatch = markdown.match(/\*\*Tokens:\*\*\s*([\d.]+\s*[kKmM]?)\s*\/\s*([\d.]+\s*[kKmM]?)\s*\((\d+)%/)
  const totalTokens = tokenMatch ? parseTokenStr(tokenMatch[1]) : 0
  const totalLimit = tokenMatch ? parseTokenStr(tokenMatch[2]) : 0
  const totalPct = tokenMatch ? parseInt(tokenMatch[3], 10) : 0
  const modelMatch = markdown.match(/\*\*Model:\*\*\s*(\S+)/)
  const model = modelMatch ? modelMatch[1] : ''

  const sections = sliceMarkdownSections(markdown)

  const categories: ContextRow[] = []
  const catSec = sections['estimated usage by category'] || ''
  const catTab = parseMarkdownTable(catSec)
  if (catTab) {
    for (const r of catTab.rows) {
      if (r.length < 3) continue
      categories.push({ name: r[0], tokens: parseTokenStr(r[1]), pct: parsePctStr(r[2]) })
    }
  }

  const mcpTools: ContextDetailRow[] = []
  const mcpTab = parseMarkdownTable(sections['mcp tools'] || '')
  if (mcpTab) {
    for (const r of mcpTab.rows) {
      if (r.length < 3) continue
      mcpTools.push({ name: r[0], server: r[1], tokens: parseTokenStr(r[2]) })
    }
  }

  const customAgents: ContextDetailRow[] = []
  const agentTab = parseMarkdownTable(sections['custom agents'] || '')
  if (agentTab) {
    for (const r of agentTab.rows) {
      if (r.length < 2) continue
      // Last column is always tokens; rest joined as name.
      customAgents.push({
        name: r[0],
        tokens: parseTokenStr(r[r.length - 1])
      })
    }
  }

  const memoryFiles: ContextDetailRow[] = []
  const memTab = parseMarkdownTable(sections['memory files'] || '')
  if (memTab) {
    for (const r of memTab.rows) {
      if (r.length < 2) continue
      memoryFiles.push({ name: r[0], tokens: parseTokenStr(r[r.length - 1]) })
    }
  }

  const skills: ContextDetailRow[] = []
  const skillTab = parseMarkdownTable(sections['skills'] || '')
  if (skillTab) {
    for (const r of skillTab.rows) {
      if (r.length < 3) continue
      skills.push({ name: r[0], source: r[1], tokens: parseTokenStr(r[2]) })
    }
  }

  return { model, totalTokens, totalLimit, totalPct, categories, mcpTools, customAgents, memoryFiles, skills }
}

/**
 * Scrape /context for a live session. Steps:
 *   1. Kill the live --print to avoid concurrent JSONL writes
 *   2. Spawn `claude --print --resume <sid> /context --output-format
 *      stream-json --verbose` as a brief throwaway child
 *   3. Collect stream-json events; when we see `result` extract its
 *      `result` field (markdown blob) and parse it
 *   4. Respawn the live --print --resume <sid> so the user can keep
 *      typing — same dance as compactSession's resume tail
 *   5. Cache the snapshot for CONTEXT_TTL_MS
 *
 * Cost: 0 API turns (slash command runs locally), wall time ~5–8s.
 */
export async function scrapeContextLive(id: string, force = false): Promise<{ ok: boolean; data?: ContextSnapshot; error?: string }> {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: 'session-id not yet captured — send a message first' }
  const sid = session.claudeSid

  // Cache hit?
  if (!force) {
    const cached = contextCache.get(sid)
    if (cached && Date.now() - cached.scrapedAtMs < CONTEXT_TTL_MS) {
      return { ok: true, data: cached }
    }
  }

  const opts = session.startOpts
  const cwd = session.cwd || process.env.HOME || '/'

  broadcast(`chat:stderr:${id}`, '⏳ Pausing chat for /context scrape (~7s)…\n')

  session.internalRecycle = true
  try { session.child?.kill() } catch {}
  session.child = null

  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    let snapshot: ContextSnapshot | null = null

    const finish = (ok: boolean, error?: string) => {
      if (settled) return
      settled = true
      try { child.kill() } catch {}
      sessions.delete(id)  // so startChat doesn't short-circuit
      startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
      if (ok && snapshot) {
        contextCache.set(sid, snapshot)
        broadcast(`chat:stderr:${id}`, '✅ /context scraped — session resumed\n')
      } else {
        broadcast(`chat:stderr:${id}`, `⚠ /context scrape ${error || 'failed'} — session resumed\n`)
      }
      resolve(ok && snapshot ? { ok: true, data: snapshot } : { ok: false, error })
    }

    // Pass --agent so /context sees the same system prompt + skills
    // + soul that the live --print uses. Without it claude renders
    // the breakdown for the *default* agent (different system prompt
    // size, no custom skills) and Messages tokens for our session
    // would be computed against the wrong cache key.
    const args = ['--print', '--resume', sid, '/context', '--output-format', 'stream-json', '--verbose']
    if (opts.agent) args.unshift('--agent', opts.agent)
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          // Both `assistant` and `result` carry the markdown — `result.result`
          // is the canonical place. Prefer it.
          if (ev.type === 'result' && typeof ev.result === 'string') {
            const parsed = parseContextMarkdown(ev.result)
            snapshot = { ...parsed, scrapedAtMs: Date.now() }
          } else if (ev.type === 'assistant' && !snapshot) {
            const blocks = (ev.message?.content || []) as any[]
            const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
            if (text.includes('Context Usage')) {
              const parsed = parseContextMarkdown(text)
              snapshot = { ...parsed, scrapedAtMs: Date.now() }
            }
          }
        } catch {}
      }
    })
    child.on('error', () => finish(false, 'spawn_error'))
    child.on('exit', (code) => {
      if (snapshot) finish(true)
      else finish(false, code === 0 ? 'no_result_event' : `exit_${code}`)
    })

    // Safety timeout: /context normally returns within 5s.
    setTimeout(() => finish(false, 'timeout'), 30000)
  })
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
async function queryUsagePctViaPty(cwd?: string): Promise<{ fiveHour?: number; sevenDay?: number; fiveHourReset?: string; sevenDayReset?: string } | null> {
  return new Promise(resolve => {
    let done = false
    let child: pty.IPty | null = null
    const finish = (v: { fiveHour?: number; sevenDay?: number; fiveHourReset?: string; sevenDayReset?: string } | null) => {
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
      // Match BOTH old (`Current session ... 23% used`) and new
      // (`5h: ░░░░░░░░░░ 23% | 7d: 5%`) formats. claude refactored
      // /usage TUI in v2.1.x to a compact inline string and our old
      // regex stopped matching → 25s timeout → null pct → ModelUsageBar
      // displayed `—` instead of an actual percentage.
      const fiveOld = text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/)
      const fiveNew = text.match(/\b5h\b\s*:\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
      const sevenOld = text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/)
      const sevenNew = text.match(/\b7d\b\s*:?\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
      const weekly = text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i)
      const five = fiveOld || fiveNew
      const seven = sevenOld || sevenNew || weekly
      // Reset countdown — old format only; new inline format omits
      // resets entirely, so we surface undefined and ModelUsageBar
      // simply skips the "· in 4h 12m" suffix.
      const sessionReset = text.match(/Current session[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
      const weekReset = text.match(/Current week[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
      if (five || seven) {
        finish({
          fiveHour: five ? parseInt(five[1], 10) : undefined,
          sevenDay: seven ? parseInt(seven[1], 10) : undefined,
          fiveHourReset: sessionReset ? sessionReset[1].trim() : undefined,
          sevenDayReset: weekReset ? weekReset[1].trim() : undefined
        })
      }
    }

    let warningHandled = false
    child.onData((d: string) => {
      term.write(d, () => {
        const grid = dumpGrid()
        // Settings.json warning page: claude renders a "1. Continue /
        // 2. Exit and fix manually" menu before the real TUI prompt.
        // The `❯` glyph in that menu used to fool prompt detection,
        // making us write `/usage` into the menu (where it's eaten as
        // input) and the real prompt never gets it. Detect the warning
        // and send Enter once to acknowledge → real prompt appears.
        if (!warningHandled && /Settings\s+Warning|Exit and fix manually|Enter to confirm/i.test(grid)) {
          warningHandled = true
          setTimeout(() => { try { child?.write('\r') } catch {} }, 200)
          return
        }
        // Stage 1: wait for prompt glyph → send /usage. Require the
        // model name banner to be present so we know we're past any
        // settings/warning screen. Match both old format ("Opus 4.7" /
        // "Sonnet 4.6") and new hyphenated format ("claude-sonnet-4-6" /
        // "claude-opus-4-7") introduced in claude 2.1.x.
        if (!sent) {
          const hasModelBanner = /(Opus|Sonnet|Haiku)\s+\d|claude-(?:opus|sonnet|haiku)/i.test(grid)
          const firstTen = grid.split('\n').slice(0, 20).join('\n')
          if (hasModelBanner && (firstTen.includes('❯') || /^\s*>\s/m.test(firstTen))) {
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

export interface RecentSession {
  sid: string
  title: string         // first user prompt (truncated)
  preview: string       // last assistant text (truncated)
  lastActiveMs: number
  ctxPct: number        // ctx % at last assistant turn (0 when unknown)
  totalTokens: number
}

/**
 * List the N most-recently-active sessions for a given cwd. Used by
 * the StartChooser's session picker (Resume / Compact+Resume / Fork
 * all let the user pick which historical session to act on instead of
 * always grabbing the newest).
 *
 * Each row pulls:
 *   - title    = first `last-prompt` event's lastPrompt (claude logs
 *                the user's message verbatim once per turn). Truncated.
 *   - preview  = last `assistant.message.content[].text` block. Trunc.
 *   - ctx %    = last assistant.usage iterations[-1] / inferred window
 *   - mtime    = file mtime (newest activity)
 *
 * Context window size: Claude's `~/.claude/projects/` JSONL doesn't
 * include the `[1m]` suffix, so we cross-reference Hive's own
 * `~/.hive/chat-logs` for a recent system/init with matching cwd. Same
 * trick `getPrevSessionInfo` uses.
 */
export function getRecentSessions(cwd: string, limit = 5): RecentSession[] {
  if (!cwd) return []
  try {
    const slug = cwd.replace(/\//g, '-')
    const dir = join(homedir(), '.claude', 'projects', slug)
    if (!existsSync(dir)) return []
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, limit)

    // Resolve a context window size for this cwd from Hive logs (best-effort)
    let contextWindowTokens = 0
    try {
      const hiveLogs = join(homedir(), '.hive', 'chat-logs')
      if (existsSync(hiveLogs)) {
        const hiveFiles = readdirSync(hiveLogs)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ f, m: statSync(join(hiveLogs, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = readFileSync(join(hiveLogs, hf.f), 'utf8').split('\n').filter(Boolean)
          for (const line of txt) {
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'system' && ev.subtype === 'init' && ev.cwd === cwd && typeof ev.model === 'string') {
                const m = ev.model.match(/\[(\d+)([kKmM])\]/)
                if (m) {
                  const n = parseInt(m[1], 10)
                  contextWindowTokens = m[2].toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000
                  break outer
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // Fallback: assume 1M (current Opus/Sonnet 4.x default for this user)
    if (!contextWindowTokens) contextWindowTokens = 1_000_000

    return files.map(file => {
      const sid = file.f.replace(/\.jsonl$/, '')
      let title = ''
      let preview = ''
      let lastInputTokens = 0
      try {
        const lines = readFileSync(join(dir, file.f), 'utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const ev = JSON.parse(line)
            if (!title && ev.type === 'last-prompt' && typeof ev.lastPrompt === 'string') {
              const t = ev.lastPrompt.trim()
              if (t) title = t.length > 120 ? t.slice(0, 120) + '…' : t
            }
            if (ev.type === 'assistant') {
              const blocks = (ev.message?.content || []) as any[]
              for (const b of blocks) {
                if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
                  const t = b.text.trim()
                  preview = t.length > 160 ? t.slice(0, 160) + '…' : t
                }
              }
              const u = ev.message?.usage
              if (u) {
                const its = Array.isArray(u.iterations) ? u.iterations : []
                const last = its.length > 0 ? its[its.length - 1] : u
                const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0)
                if (total) lastInputTokens = total
              }
            }
          } catch {}
        }
      } catch {}
      const ctxPct = lastInputTokens > 0
        ? Math.round((lastInputTokens / contextWindowTokens) * 100)
        : 0
      return {
        sid,
        title: title || '(no title)',
        preview: preview || '(no preview)',
        lastActiveMs: file.m,
        ctxPct,
        totalTokens: lastInputTokens
      }
    })
  } catch {
    return []
  }
}

export interface PrevSessionInfo {
  sid: string
  model: string
  contextSize: string  // "1M" | "200K" | "" (unknown)
  peakInputTokens: number
  lastActiveMs: number
}

/**
 * Probe ~/.claude/projects/<slug> for the newest .jsonl, pull out sid,
 * last assistant model, peak iteration usage, and mtime. Used by the
 * StartChooser UI to preview the prior session before the user picks
 * a startup mode (Resume / Compact+Resume / Start new / Fork).
 *
 * contextSize is best-effort: ~/.claude/projects/ logs strip the `[1m]`
 * size suffix, so we cross-reference Hive's own ~/.hive/chat-logs for
 * the most recent system/init with a matching cwd to recover it.
 * Falls back to "" when unknowable; chooser then renders a token count
 * instead of a percentage.
 */
export function getPrevSessionInfo(cwd: string): PrevSessionInfo | null {
  if (!cwd) return null
  try {
    const slug = cwd.replace(/\//g, '-')
    const dir = join(homedir(), '.claude', 'projects', slug)
    if (!existsSync(dir)) return null
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (!files.length) return null
    const latest = files[0]
    const sid = latest.f.replace(/\.jsonl$/, '')

    // Walk forward but track the LAST observed usage, not the peak. After
    // /compact the session keeps writing to the same JSONL, so old
    // pre-compact entries still sit in the file with their (now stale)
    // high token counts. Using the latest assistant.usage matches what
    // the live chat would show on resume — i.e. post-compact ~12%, not
    // the 97% peak we hit before the compact.
    let model = ''
    let peakInputTokens = 0
    const lines = readFileSync(join(dir, latest.f), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'assistant') {
          const msg = ev.message || {}
          if (msg.model) model = msg.model
          const u = msg.usage
          if (u) {
            const its = Array.isArray(u.iterations) ? u.iterations : []
            const last = its.length > 0 ? its[its.length - 1] : u
            const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0)
            peakInputTokens = total  // last-write-wins, so loop end = newest
          }
        }
      } catch {}
    }

    let contextSize = ''
    try {
      const hiveLogs = join(homedir(), '.hive', 'chat-logs')
      if (existsSync(hiveLogs)) {
        const hiveFiles = readdirSync(hiveLogs)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ f, m: statSync(join(hiveLogs, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = readFileSync(join(hiveLogs, hf.f), 'utf8').split('\n').filter(Boolean)
          for (const line of txt) {
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'system' && ev.subtype === 'init' && ev.cwd === cwd && typeof ev.model === 'string') {
                const m = ev.model.match(/\[(\d+[kKmM])\]/)
                if (m) { contextSize = m[1].toUpperCase(); break outer }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // claude 2.1.x dropped [1M] suffix from model strings in both stream-json
    // and hive chat-logs. Infer from model name when suffix lookup failed.
    if (!contextSize && model) {
      contextSize = /haiku/i.test(model) ? '200K' : '1M'
    }

    return { sid, model, contextSize, peakInputTokens, lastActiveMs: latest.m }
  } catch {
    return null
  }
}

export function registerChatIpc() {
  ipcMain.handle('chat:start', async (_e, { id, cwd, agent, name, continueSession, rebaseOnStart, resumeSid, forkSession, forceCompact }) => {
    if (forceCompact && cwd && resumeSid) {
      // User explicitly clicked Compact + Resume. If a stale child --print
      // is still tracked under this id (renderer reload, unmount cleanup
      // didn't fire, etc.), DO NOT bail with already_started — that
      // silently swallows the entire compact request and leaves context
      // unchanged. Just kill the stale child; sid + JSONL are untouched
      // (compact reads/writes the JSONL via runCompactViaPrint, then
      // startChat spawns a fresh child for the SAME sid). This is still
      // compact semantics, not fork.
      if (sessions.has(id)) stopChat(id)
      broadcast(`chat:stderr:${id}`, '⏳ Compacting prior session before resume…\n')
      const r = await runCompactViaPrint(cwd, resumeSid, agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`))
      if (r.ok) {
        broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1000).toFixed(1)}s\n`)
      } else {
        broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1000).toFixed(1)}s) — context UNCHANGED, resuming anyway\n`)
      }
      startChat(id, { cwd, agent, name, resumeSid, continueSession: false, rebaseOnStart: false })
      return { ok: true, compacted: r.ok, error: r.ok ? undefined : r.error }
    }
    return smartStartChat(id, { cwd, agent, name, continueSession, rebaseOnStart, resumeSid, forkSession })
  })
  ipcMain.handle('chat:getPrevSessionInfo', (_e, { cwd }) => getPrevSessionInfo(cwd))
  ipcMain.handle('chat:getRecentSessions', (_e, { cwd, limit }) => getRecentSessions(cwd, limit ?? 5))
  ipcMain.handle('chat:scrapeContext', (_e, { id, force }) => scrapeContextLive(id, !!force))
  ipcMain.handle('chat:send', (_e, { id, text }) => sendUserMessage(id, text))
  ipcMain.handle('chat:respondPermission', (_e, { id, requestId, decision, input, denyMessage }) =>
    respondPermission(id, requestId, decision, input, denyMessage)
  )
  ipcMain.handle('chat:stop', (_e, { id }) => { stopChat(id); return { ok: true } })
  ipcMain.handle('chat:loadOlder', (_e, { id, batch }) => loadOlderHistory(id, batch))
  ipcMain.handle('chat:startRemoteControl', (_e, { id }) => startRemoteControl(id))
  ipcMain.handle('chat:resumeFromRemoteControl', (_e, { id }) => resumeFromRemoteControl(id))
  ipcMain.handle('chat:interrupt', (_e, { id }) => interruptSession(id))
  ipcMain.handle('chat:compact', (_e, { id }) => compactSession(id))
  ipcMain.handle('chat:resumeSmart', (_e, { id }) => resumeSmart(id))
  ipcMain.handle('chat:startWithSummary', (_e, { id }) => startWithSummary(id))
  ipcMain.handle('chat:cancelAutoContinue', (_e, { id }) => cancelAutoContinue(id))
}
