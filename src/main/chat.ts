import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ipcMain, BrowserWindow, app } from 'electron'
import * as pty from 'node-pty'
import { queryUsageViaCcusage, queryUsagePctViaPty } from './chat-usage-query'
import { UsageCache } from './usage-cache'
import { ContextSnapshot, parseContextMarkdown } from './chat-context-parser'
import { RecentSession, PrevSessionInfo, getRecentSessions, getPrevSessionInfo } from './chat-recent-sessions'
import { shouldAutoAllow } from './session-permissions'
import { claudeBin } from './claude-env'
import { disposePty } from './ptyDispose'

export type { RecentSession, PrevSessionInfo }
export type { ContextRow, ContextDetailRow, ContextSnapshot } from './chat-context-parser'

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
 * Per-chat "Allow this session" tool allowlist. Keyed by chat id (agent
 * id from the renderer), NOT the claude session id. Kept module-level
 * so it survives session recycles (Compact/Resume/Fork/smartResume all
 * `sessions.delete(id)` + startChat with same id) — user consent is
 * per-chat, not per-underlying-subprocess. See `session-permissions.ts`
 * for the parallel-MCP-tool bug this fixes. Cleared on process exit
 * only; a user who closes+relaunches Hive.app gets a fresh allowlist.
 */
const sessionAllowedTools = new Map<string, Set<string>>()

function getAllowedTools(id: string): Set<string> {
  let set = sessionAllowedTools.get(id)
  if (!set) { set = new Set(); sessionAllowedTools.set(id, set) }
  return set
}

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
 *
 * Issue #7: TTL raised 30s → 5min because `ccusage blocks --json` scans
 * ALL `~/.claude/projects/*.jsonl` from scratch on every invocation; on
 * a large history (~790MB, ~1200 files) it takes ~12s at 100%+ CPU.
 * Account-level usage changes slowly enough that 5-minute staleness is
 * fine, and the rare bursts of activity are caught by the in-flight
 * dedup. UsageCache also now caches null results (pre-fix the cache was
 * skipped when pct was null → thundering-herd re-spawns).
 */
const USAGE_TTL_MS = 5 * 60_000
type CcUsage = Awaited<ReturnType<typeof queryUsageViaCcusage>>
type PctUsage = Awaited<ReturnType<typeof queryUsagePctViaPty>>
const usageCaches = new Map<string, UsageCache<NonNullable<CcUsage>, NonNullable<PctUsage>>>()

async function getSharedUsage(scrapeCwd?: string) {
  // Subscription %% IS account-level (same answer regardless of cwd),
  // BUT the interactive `claude` PTY we spawn here gates input on a
  // workspace-trust dialog the first time it sees an unfamiliar dir.
  // $HOME is unfamiliar → trust dialog blocks → /usage never sent →
  // scrape times out and caches a null. Key the cache by the cwd so
  // that an agent in a known-trusted dir can populate it; subsequent
  // agents in the same dir reuse the value.
  const key = scrapeCwd || process.env.HOME || '/'
  let cache = usageCaches.get(key)
  if (!cache) {
    cache = new UsageCache({
      ttlMs: USAGE_TTL_MS,
      fetchCc: queryUsageViaCcusage,
      fetchPct: () => queryUsagePctViaPty(key)
    })
    usageCaches.set(key, cache)
  }
  return cache.get()
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
  if (sessions.has(id) && sessions.get(id)?.child !== null) return { ok: false, error: 'already_started' }
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
            const r = await runCompactViaPrint(opts.cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`), id)
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
// Watchdog: when /compact has run >5min AND claude hasn't emitted a
// byte in >60s, the child is almost certainly stuck (claude `--print`
// has gone unresponsive — observed Pink at 1050s+ with no UI escape).
// We broadcast a one-time `chat:compactStuck:<id>` so the renderer can
// show a Cancel button. Cancel calls window.api.chat.stop(id) which
// kills the entire chat (including this `--print` child) and clears
// pendingPermissions/pendingQuestion in HiveChat.
export const COMPACT_STUCK_ELAPSED_MS = 300_000
export const COMPACT_STUCK_IDLE_MS = 60_000

/**
 * Pure predicate — tests don't need to spawn a child. Returns true iff
 * the watchdog should broadcast a stuck signal given the elapsed time
 * since /compact started and the time since claude last emitted a byte.
 */
export function isCompactStuck(elapsedMs: number, lastOutputAgeMs: number): boolean {
  return elapsedMs > COMPACT_STUCK_ELAPSED_MS && lastOutputAgeMs > COMPACT_STUCK_IDLE_MS
}

async function runCompactViaPrint(
  cwd: string,
  sid: string,
  agent: string | undefined,
  timeoutMs = 600_000,
  onProgress?: (msg: string) => void,
  chatId?: string
): Promise<{ ok: boolean; error?: string; durationMs: number; resultEvent?: any }> {
  const startedAt = Date.now()
  return new Promise(resolve => {
    let settled = false
    let buffer = ''
    let resultEvent: any = null
    let lastByteAt = startedAt
    let stuckBroadcast = false
    // 30s heartbeat: if no result yet, broadcast `still running…Xs` so
    // the user sees the chat isn't hung. Resets when settled. After
    // COMPACT_STUCK_ELAPSED_MS + COMPACT_STUCK_IDLE_MS of no output,
    // also fire a one-time `chat:compactStuck:<id>` for the renderer
    // to expose a Cancel button.
    const progressTimer = setInterval(() => {
      if (settled) return
      const elapsed = Date.now() - startedAt
      const sinceLastByte = Date.now() - lastByteAt
      onProgress?.(`/compact still running · ${Math.round(elapsed / 1000)}s elapsed${sinceLastByte > 30_000 ? ` · last claude output ${Math.round(sinceLastByte / 1000)}s ago` : ''}`)
      if (!stuckBroadcast && chatId && isCompactStuck(elapsed, sinceLastByte)) {
        stuckBroadcast = true
        broadcast(`chat:compactStuck:${chatId}`, {
          elapsedMs: elapsed,
          lastOutputAgeMs: sinceLastByte
        })
      }
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
    const child = spawn(claudeBin(), args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })

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

/**
 * Build the exact `claude` argv for a chat --print spawn. Pure so the
 * spawned "system command" can be unit-tested AND logged verbatim (the
 * forensic spawn record below logs whatever this returns, so the log can
 * never drift from what actually ran).
 *
 * `-c` = continue most recent session; `--resume <sid>` = resume a specific
 * session id (used by resumeFromRemoteControl after the interactive TUI
 * round-trip). `--resume` wins if both are set.
 */
export function buildChatArgs(opts: StartOpts): string[] {
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--include-hook-events',
    '--permission-prompt-tool', 'stdio', // claude emits control_request on stdout; we reply with control_response on stdin
    '--verbose'
  ]
  if (opts.agent) args.push('--agent', opts.agent)
  if (opts.name) args.push('-n', opts.name)
  if (opts.resumeSid) {
    args.push('--resume', opts.resumeSid)
    if (opts.forkSession) args.push('--fork-session')
  } else if (opts.continueSession) {
    args.push('-c')
  }
  return args
}

export function startChat(id: string, opts: StartOpts = {}) {
  if (sessions.has(id) && sessions.get(id)?.child !== null) return
  const args = buildChatArgs(opts)

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

  const child = spawn(claudeBin(), args, {
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

  // Forensic spawn record. Written IMMEDIATELY (before any stdout) so that
  // even an instant-fail — e.g. claude exits with "Not logged in · Please
  // run /login" before emitting a single stream-json event — still leaves a
  // log file with the exact command + cwd that ran. Previously such failures
  // produced ZERO log (the file is only created on the first stdout append),
  // so an auth/resume failure was completely invisible. (v1.7.136)
  try {
    appendFileSync(session.logPath, JSON.stringify({
      _meta: 'spawn', t: Date.now(), command: 'claude', args, cwd: opts.cwd ?? null
    }) + '\n')
  } catch {}

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
    const allowedTools = getAllowedTools(id)
    for (const ev of events) {
      // Session-level auto-allow gate. When the user has clicked "Allow
      // this session" on a tool (typically an MCP tool like
      // `mcp__stargate__jira_update_issue` for which claude does NOT
      // send permission_suggestions), subsequent control_request events
      // for that tool are answered here without waking the renderer
      // modal. Also collapses the "4 parallel calls in one turn = 4
      // clicks" pattern into zero clicks after the first.
      const decision = shouldAutoAllow(ev, allowedTools)
      if (decision.autoAllow) {
        respondPermission(id, decision.requestId, 'allow', decision.input)
        // Log the auto-allow for post-mortem, but skip broadcast + skip
        // the normal event log (this event never reached the renderer).
        try { appendFileSync(session.logPath, JSON.stringify({ _meta: 'auto-allow', t: Date.now(), requestId: decision.requestId, toolName: decision.toolName }) + '\n') } catch {}
        continue
      }
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
    const s = chunk.toString('utf8')
    broadcast(`chat:stderr:${id}`, s)
    // Tee stderr to the session log too — auth errors ("Not logged in",
    // 403, ENOENT) land here, and the renderer-only broadcast left no
    // durable trace once the panel scrolled. (v1.7.136)
    try { appendFileSync(session.logPath, JSON.stringify({ _meta: 'stderr', t: Date.now(), data: s }) + '\n') } catch {}
  })
  child.on('exit', (code, signal) => {
    // Record every exit (code + signal) before the stale-handler guards
    // below can early-return — a non-zero/early exit is exactly the
    // forensic signal we were missing. (v1.7.136)
    try { appendFileSync(session.logPath, JSON.stringify({ _meta: 'exit', t: Date.now(), code, signal }) + '\n') } catch {}
    // When killed by signal (SIGTERM from stopChat), code is null.
    // Renderer's onExit sets state to that code; if null lands on
    // useState<number|null>(null), `exited !== null` stays false and
    // the close-session panel never renders. Coerce null → 0.
    const sess = sessions.get(id)
    // Stale exit: this child has been replaced (resumeSmart's
    // delete-then-startChat cycle, or stopChat→startChat). The Map
    // entry now points to a live newer child, and we're firing for an
    // older, already-killed process. If we ran the rest of this
    // handler, we'd broadcast a phantom chat:exit (renderer flips to
    // close-panel even though the new session is happily streaming)
    // AND null out the live child's reference. internalRecycle alone
    // doesn't protect against this — that flag lives on the OLD
    // session object, but `sess` is the NEW one after sessions.set().
    if (sess && sess.child !== child) return
    if (sess?.internalRecycle) {
      // Caller (compactSession / resumeSmart / scrapeContextLive) is
      // killing the --print intentionally and will spawn a fresh one
      // under the same id within seconds. Don't notify the renderer;
      // don't drop the session entry — keeping it means `chat.resume*`
      // calls during the gap don't fail with `no_session`.
      return
    }
    broadcast(`chat:exit:${id}`, code ?? 0)
    // Keep the session entry alive (null out the dead child) so that
    // resumeSmart / startWithSummary can still read claudeSid + startOpts
    // and the Resume / Compact+Resume buttons in the renderer work.
    // The entry is cleaned up by stopChat (explicit user close) or when
    // a new startChat call overwrites it with sessions.set(id, ...).
    if (sess) {
      sess.child = null
    } else {
      sessions.delete(id)
    }
  })
  child.on('error', (err) => {
    // Durable trace of spawn-time failures (ENOENT = claude not on PATH,
    // EACCES, etc.) — written before the stale-handler guard. (v1.7.136)
    try { appendFileSync(session.logPath, JSON.stringify({ _meta: 'spawn_error', t: Date.now(), error: String(err) }) + '\n') } catch {}
    const sess = sessions.get(id)
    // Same stale-handler protection as 'exit' above. A spawn-time
    // ENOENT for an already-replaced child must not clobber the live
    // session's child reference.
    if (sess && sess.child !== child) return
    broadcast(`chat:error:${id}`, String(err))
    if (sess) {
      sess.child = null
    } else {
      sessions.delete(id)
    }
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
  disposePty(session.rcPty)
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
  const rcPty = pty.spawn(claudeBin(), ['--resume', sid], {
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
  const r = await runCompactViaPrint(cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`), id)
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
  const r = await runCompactViaPrint(cwd, sid, opts.agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`), id)

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
  disposePty(session.rcPty)
  const opts = session.startOpts
  const sid = session.claudeSid
  // Clear the dead session so startChat starts fresh with --resume.
  sessions.delete(id)
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false })
  return { ok: true, sid }
}

const contextCache = new Map<string, ContextSnapshot>()
const CONTEXT_TTL_MS = 5 * 60 * 1000  // 5 min

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
    const child = spawn(claudeBin(), args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })

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
      const child = spawn(claudeBin(), [
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
      const r = await runCompactViaPrint(cwd, resumeSid, agent, undefined, msg => broadcast(`chat:stderr:${id}`, `⏳ ${msg}\n`), id)
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
  ipcMain.handle('chat:getPrevSessionInfo', (_e, { cwd, chatId }) => getPrevSessionInfo(cwd, chatId))
  ipcMain.handle('chat:getRecentSessions', (_e, { cwd, limit }) => getRecentSessions(cwd, limit ?? 5))
  ipcMain.handle('chat:scrapeContext', (_e, { id, force }) => scrapeContextLive(id, !!force))
  ipcMain.handle('chat:send', (_e, { id, text }) => sendUserMessage(id, text))
  ipcMain.handle('chat:respondPermission', (_e, { id, requestId, decision, input, denyMessage }) =>
    respondPermission(id, requestId, decision, input, denyMessage)
  )
  // "Allow this session" adds a tool to the per-chat allowlist so the
  // stdout interceptor auto-responds `allow` on future control_requests
  // for it (no modal). See session-permissions.ts.
  ipcMain.handle('chat:allowToolForSession', (_e, { id, toolName }: { id: string; toolName: string }) => {
    if (!id || typeof toolName !== 'string' || !toolName) return { ok: false, error: 'bad_input' }
    getAllowedTools(id).add(toolName)
    return { ok: true }
  })
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
