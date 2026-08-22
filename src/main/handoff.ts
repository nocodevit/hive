/**
 * Handoff runtime (v2.2.0 — chat-inject model).
 *
 * v1 (v2.1.0) spawned a separate `claude -p` child per handoff and ran
 * its own event loop. That was over-engineered and disconnected the
 * handoff from the user's chat context (had to `--resume <sid>` to
 * recover the plan). This version doesn't spawn anything.
 *
 * How it works:
 *   1. startHandoff({chatId, goals, breakers}) composes a `/goal ...`
 *      command and pushes it into the chat's existing claude subprocess
 *      via chat.ts's sendUserMessage.
 *   2. The supervisor subscribes to chat.ts's chatEventBus for THIS
 *      chatId and drives the pure state machine (handoff-supervisor.ts).
 *   3. On breaker trip, calls interruptSession(chatId) — same
 *      control_request/interrupt claude uses for user-initiated cancel.
 *   4. 5h rate-limit auto-resume is inherited automatically because the
 *      chat's existing auto-continue logic re-drives its own subprocess.
 *      We only track pausedMs so the wall-time breaker doesn't count
 *      time spent waiting for rate-limit reset.
 */
import type { BrowserWindow } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { chatEventBus, sendUserMessage, interruptSession, compactSession, stopChat } from './chat'
import {
  applyEvent,
  beginPause,
  checkCircuitBreakers,
  composeSlashGoalCommand,
  detectAskUserQuestion,
  endPause,
  extractAskUserQuestion,
  extractInputTokens,
  foldStats,
  initialState,
  liveElapsedMs,
  parseContextSize,
  shouldTriggerAutoCompact,
  type HandoffBreakers,
  type HandoffConfig,
  type HandoffState
} from './handoff-supervisor'

interface RunningHandoff {
  config: HandoffConfig
  state: HandoffState
  wallTimer: NodeJS.Timeout
  resumeTimer?: NodeJS.Timeout    // set while paused for rate-limit auto-resume
  unsubscribe: () => void
  win: BrowserWindow
  lastBashCmd: string | null      // v2.3.0: for attributing test-run tool_results
  lastInputTokens: number         // v2.5.0: for auto-compact context-% detection
  contextSizeTokens: number       // v2.5.0: resolved from initial system:init event
  autoCompacting: boolean         // v2.5.0: guard against re-entering compact while one is in flight
}

const running = new Map<string, RunningHandoff>()

export interface StartHandoffInput {
  chatId: string
  goals: string[]
  breakers: HandoffBreakers
}

export interface StartHandoffResult {
  ok: boolean
  runId?: string
  error?: string
}

/**
 * Compose /goal, inject into chat, subscribe to events, arm the wall timer.
 * Does NOT spawn any subprocess — the chat's existing claude does the work.
 */
export function startHandoff(input: StartHandoffInput, win: BrowserWindow): StartHandoffResult {
  const goals = input.goals.map(g => g.trim()).filter(Boolean)
  if (goals.length === 0) return { ok: false, error: 'no goals provided (at least one required)' }
  if (!input.chatId) return { ok: false, error: 'chatId is empty' }

  // Refuse if this chat already has an active handoff — force user to
  // Stop the first visibly rather than silently double up.
  for (const h of running.values()) {
    if (h.config.chatId === input.chatId) {
      return { ok: false, error: `chat already has an active handoff (${h.config.runId})` }
    }
  }

  // Hive convention: chat id = `chat-<agentId>` (see Terminal.tsx). Strip
  // the prefix so the 🥴 overlay set (keyed by agentId) can match on the
  // same value the renderer uses in AvatarPreview.
  const agentId = input.chatId.startsWith('chat-') ? input.chatId.slice(5) : input.chatId
  const runId = `hnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const config: HandoffConfig = {
    runId,
    chatId: input.chatId,
    agentId,
    goals,
    breakers: input.breakers
  }

  // Send the /goal command. If chat has no live claude subprocess this
  // returns an error and we abort without registering the handoff.
  const cmd = composeSlashGoalCommand(config.goals, config.breakers)
  const sendRes = sendUserMessage(config.chatId, cmd)
  if (!sendRes.ok) return { ok: false, error: `chat inject failed: ${sendRes.error}` }

  const state = initialState(config, Date.now())

  // Event subscription: drive state machine per event, trip on breakers.
  const onEvent = ({ sessionId, event }: { sessionId: string; event: Record<string, unknown> }) => {
    if (sessionId !== config.chatId) return
    const now = Date.now()

    // Rate-limit event → begin pause (chat.ts's own auto-continue will
    // resume the subprocess automatically; we just stop counting wall).
    const rlEv = event as { type?: string; status?: string; resetsAt?: number; rateLimitType?: string }
    if (event.type === 'rate_limit_event' && (rlEv.status === 'blocked' || rlEv.status === 'rejected')) {
      Object.assign(state, beginPause(state, now))
      emitProgress(win, state)
      return
    }
    // When chat's auto-continue fires again after reset, the first new
    // event that ISN'T rate_limit_event closes our pause window.
    if (state.status === 'paused' && event.type !== 'rate_limit_event') {
      Object.assign(state, endPause(state, now))
      emitProgress(win, state)
    }

    // v2.3.0: fold stats (files edited, commits, test results, tool errors).
    // running.get() returns the same object we set in the map, so mutating
    // its lastBashCmd field is fine here.
    const h = running.get(runId)
    if (h && state.stats) {
      const { stats: nextStats, nextBashCmd } = foldStats(state.stats, event, h.lastBashCmd)
      state.stats = nextStats
      h.lastBashCmd = nextBashCmd
    }

    // v2.3.0: AskUserQuestion → PAUSE (not SIGTERM). User picks: resume /
    // exit+report / new goal from the banner UI. Fire desktop notification
    // so user isn't left staring at a stuck chat.
    if (config.breakers.stopOnAskUserQuestion === true && detectAskUserQuestion(event)) {
      const q = extractAskUserQuestion(event)
      if (state.status === 'running') {
        Object.assign(state, beginPause(state, now))
        state.askedQuestion = q || undefined
        emitPaused(win, state)
        fireQuestionNotification(config.agentId, q?.question)
      }
      return  // don't process breakers / turn count while paused
    }

    // v2.5.0: track context tokens for auto-compact detection.
    // system:init events carry `contextSize`; assistant events carry
    // `usage.input_tokens` on each turn.
    if (event.type === 'system' && (event as any).subtype === 'init') {
      const cs = (event as any).contextSize
      if (typeof cs === 'string' && h) h.contextSizeTokens = parseContextSize(cs)
    }
    const inputTok = extractInputTokens(event)
    if (inputTok !== null && h) h.lastInputTokens = inputTok

    const before = state.turnCount
    const next = applyEvent(state, event, now)
    Object.assign(state, next)

    // Only re-check breakers on interesting boundaries (turn/cost change).
    const turnAdvanced = state.turnCount > before
    if (!turnAdvanced) return

    emitProgress(win, state)

    // v2.5.0 auto-compact: on every result event, if context > 70%
    // and not already compacting, kick off tryAutoCompact (async, no
    // await — this event handler must return quickly, compact runs in
    // background and updates state on completion).
    if (h && h.contextSizeTokens > 0 && h.lastInputTokens > 0) {
      const pct = h.lastInputTokens / h.contextSizeTokens
      if (shouldTriggerAutoCompact(pct, state.status, h.autoCompacting)) {
        void tryAutoCompact(runId)
        return  // don't run breakers on this turn — compacting takes over
      }
    }

    const cb = checkCircuitBreakers(state, config, now, false)
    if (cb.trip && state.status === 'running') {
      state.status = 'stopped'
      state.stopReason = cb.detail
      try { interruptSession(config.chatId) } catch { /* already stopped */ }
      finalize(runId, win)
    }
  }
  chatEventBus.on('event', onEvent)
  const unsubscribe = () => { chatEventBus.off('event', onEvent) }

  // 30s wall-time tick — cheap, catches the "no turns firing" case (e.g.
  // claude stuck in a long tool call). Also runs the gate script when
  // configured (exit 1 = stop, matching user's "如果 1 就退出" intent).
  const wallTimer = setInterval(() => {
    if (state.status !== 'running') return
    const cb = checkCircuitBreakers(state, config, Date.now(), false)
    if (cb.trip) {
      state.status = 'stopped'
      state.stopReason = cb.detail
      try { interruptSession(config.chatId) } catch { /* already stopped */ }
      finalize(runId, win)
      return
    }
    // Gate script — fail-open (any non-1 exit = continue).
    if (config.breakers.gateScriptPath) {
      execFile(config.breakers.gateScriptPath, [], { timeout: 10_000, cwd: undefined }, (err) => {
        // Re-read state — could have changed while gate was running.
        if (state.status !== 'running') return
        const exitCode = (err as NodeJS.ErrnoException | null)?.code
        // execFile err is null on 0-exit; on non-zero, err.code is the exit int.
        if (typeof exitCode === 'number' && exitCode === 1) {
          state.status = 'stopped'
          state.stopReason = `gate script exit 1 (${config.breakers.gateScriptPath})`
          try { interruptSession(config.chatId) } catch { /* already stopped */ }
          finalize(runId, win)
        }
        // Any other exit (0, 2, 137, timeout) → continue, don't SIGTERM.
      })
    }
    state.elapsedMs = liveElapsedMs(state, Date.now())
    emitProgress(win, state)
  }, 30_000)

  running.set(runId, {
    config, state, wallTimer, unsubscribe, win,
    lastBashCmd: null,
    lastInputTokens: 0,
    contextSizeTokens: 0,
    autoCompacting: false
  })
  emitProgress(win, state) // paint banner immediately
  return { ok: true, runId }
}

/**
 * Auto-compact when context passes 70%. Retries once on failure; second
 * failure halts the handoff. Silent on success per user directive.
 * Wall-time is paused via same beginPause/endPause bookkeeping used by
 * 5h rate-limit — compact duration doesn't count against maxWallTimeMs.
 */
async function tryAutoCompact(runId: string): Promise<void> {
  const h = running.get(runId)
  if (!h || h.autoCompacting) return
  h.autoCompacting = true
  const before = h.state.status
  h.state.status = 'compacting'
  Object.assign(h.state, beginPause(h.state, Date.now()))
  emitProgress(h.win, h.state)

  const attempt = async () => await compactSession(h.config.chatId)
  let res = await attempt()
  if (!res.ok) {
    // Retry once — per user directive: "重试一次，再失败就 halt".
    res = await attempt()
  }

  // Restore state (or halt if both attempts failed).
  h.autoCompacting = false
  if (res.ok) {
    if (h.state.stats) {
      h.state.stats = {
        ...h.state.stats,
        autoCompactCount: h.state.stats.autoCompactCount + 1,
        autoCompactCostUsd: h.state.stats.autoCompactCostUsd + (res.costUsd || 0)
      }
    }
    // Also charge compact cost against the main cost budget so max-cost
    // breaker fires if compaction itself blows the budget.
    if (typeof res.costUsd === 'number') {
      h.state.totalCostUsd += res.costUsd
    }
    Object.assign(h.state, endPause(h.state, Date.now()))
    h.state.status = before === 'running' ? 'running' : before
    emitProgress(h.win, h.state)
  } else {
    h.state.status = 'stopped'
    h.state.stopReason = `auto-compact failed after 2 attempts: ${res.error || 'unknown'}`
    try { interruptSession(h.config.chatId) } catch { /* already stopped */ }
    finalize(runId, h.win)
  }
}

/**
 * Resume a paused handoff after the user answered claude's AskUserQuestion.
 * The answer has already been sent to claude by the existing renderer path
 * (PermissionModal/AskUserQuestionInline). We just flip status back and
 * let the next arriving stream event drive the machine.
 */
export function resumeHandoff(runId: string): boolean {
  const h = running.get(runId)
  if (!h || h.state.status !== 'paused') return false
  Object.assign(h.state, endPause(h.state, Date.now()))
  h.state.askedQuestion = undefined
  emitProgress(h.win, h.state)
  return true
}

/**
 * Stop a running handoff — v2.5.3 three-stage escalation because
 * interruptSession alone doesn't kill /goal (interrupt cancels the
 * current turn; /goal's completion checker fires ANOTHER turn on the
 * next tick). Nancy's 2026-08-22 incident: user pressed Stop, only
 * ONE interrupt fired at line 8931, /goal loop ran 6,000 more log
 * lines while user typed 15 escalating "停止" messages that all got
 * consumed as user input feeding the loop.
 *
 * Three-stage escalation:
 *   1. sendUserMessage(chatId, '/goal clear')  — claude parses it as
 *      a slash command on next turn boundary and clears the goal so
 *      the completion checker stops re-firing.
 *   2. interruptSession(chatId)                — cancel any in-flight
 *      tool call / assistant response.
 *   3. armGoalKillFallback(runId)              — 5s later, if we
 *      observe any NEW result event (loop still going), hard-kill the
 *      chat subprocess. Cannot be defeated by any /goal misbehavior.
 */
export function stopHandoff(runId: string): boolean {
  const h = running.get(runId)
  if (!h) return false
  if (h.state.status === 'running' || h.state.status === 'paused' || h.state.status === 'compacting') {
    h.state.status = 'stopped'
    h.state.stopReason = 'stopped by user'
    // Stage 1: politely ask claude to clear its /goal.
    try { sendUserMessage(h.config.chatId, '/goal clear') } catch { /* ignore */ }
    // Stage 2: cancel current turn.
    try { interruptSession(h.config.chatId) } catch { /* already dead */ }
    // Stage 3: fallback — if /goal keeps producing result events after
    // stop, hard-kill the subprocess after 5s.
    armGoalKillFallback(runId)
  }
  finalize(runId, h.win)
  return true
}

/**
 * v2.5.3 stop escalation: after stopHandoff fires stages 1+2, watch
 * for further result events for 5s. If any arrive, /goal is still
 * looping despite the clear — nuke the whole chat subprocess.
 */
function armGoalKillFallback(runId: string): void {
  const h = running.get(runId)
  if (!h) return
  const startTurns = h.state.turnCount
  const chatId = h.config.chatId
  setTimeout(() => {
    // Re-fetch — may have been finalize'd + removed from map already.
    // stateSnapshotByChatId helper isn't necessary: we just need to know
    // if the chat processed a new turn since we tried to stop. We stashed
    // startTurns above; check the local state on any handoff still tracking
    // this chatId (shouldn't be any post-finalize, but if the finalize
    // race happened we still act).
    let latestTurns = startTurns
    for (const running_h of running.values()) {
      if (running_h.config.chatId === chatId) latestTurns = running_h.state.turnCount
    }
    if (latestTurns > startTurns) {
      // Loop still running despite /goal clear + interrupt. Nuclear option.
      try { stopChat(chatId) } catch { /* already dead */ }
    }
  }, 5_000)
}

/** Clean shutdown: clear timers, unsubscribe, emit final, remove from map. */
function finalize(runId: string, win: BrowserWindow) {
  const h = running.get(runId)
  if (!h) return
  clearInterval(h.wallTimer)
  if (h.resumeTimer) clearTimeout(h.resumeTimer)
  h.unsubscribe()
  h.state.elapsedMs = liveElapsedMs(h.state, Date.now())
  running.delete(runId)
  emitDone(win, h.state)
}

/** Snapshot of all running handoffs, elapsedMs freshly computed. */
export function listRunningHandoffs(): HandoffState[] {
  const now = Date.now()
  return Array.from(running.values()).map(h => ({ ...h.state, elapsedMs: liveElapsedMs(h.state, now) }))
}

/** Agent IDs with an active handoff — powers the 🥴 overlay set. */
export function getActiveHandoffAgentIds(): string[] {
  return Array.from(running.values()).map(h => h.config.agentId)
}

/** Chat IDs with an active handoff — used by renderer's PermissionModal
 * to know when to auto-allow (v2.2.0 permission-bypass path). */
export function getActiveHandoffChatIds(): string[] {
  return Array.from(running.values()).map(h => h.config.chatId)
}

function emitProgress(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:progress', state)
}
function emitPaused(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:paused', state)
}
function emitDone(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:done', state)
}

/**
 * Fire a macOS desktop notification when the agent pauses to ask a
 * question — user asked in v2.2.4 review: "你应该发通知给我啊".
 * Non-fatal on failure (Linux/Windows: osascript missing → silent skip).
 */
function fireQuestionNotification(agentId: string, question?: string): void {
  try {
    const preview = (question || 'the agent needs your answer').slice(0, 120).replace(/["\\]/g, '')
    const title = `Handoff paused — ${agentId}`
    spawn('osascript', ['-e', `display notification "${preview}" with title "${title}" sound name "Ping"`], { stdio: 'ignore' })
  } catch { /* no notification is not a bug */ }
}
