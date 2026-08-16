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
import { execFile } from 'node:child_process'
import { chatEventBus, sendUserMessage, interruptSession } from './chat'
import {
  applyEvent,
  beginPause,
  checkCircuitBreakers,
  composeSlashGoalCommand,
  detectAskUserQuestion,
  endPause,
  initialState,
  liveElapsedMs,
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

    const askedQuestion = config.breakers.stopOnAskUserQuestion === true && detectAskUserQuestion(event)
    const before = state.turnCount
    const next = applyEvent(state, event, now)
    Object.assign(state, next)

    // Only re-check breakers on interesting boundaries (turn/cost change or
    // AskUserQuestion) — no need to re-check on every stream chunk.
    const turnAdvanced = state.turnCount > before
    if (!turnAdvanced && !askedQuestion) return

    if (turnAdvanced) emitProgress(win, state)
    const cb = checkCircuitBreakers(state, config, now, askedQuestion)
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

  running.set(runId, { config, state, wallTimer, unsubscribe, win })
  emitProgress(win, state) // paint banner immediately
  return { ok: true, runId }
}

/** Stop a running handoff — interrupt the chat + tear down subscription. */
export function stopHandoff(runId: string): boolean {
  const h = running.get(runId)
  if (!h) return false
  if (h.state.status === 'running' || h.state.status === 'paused') {
    h.state.status = 'stopped'
    h.state.stopReason = 'stopped by user'
    try { interruptSession(h.config.chatId) } catch { /* already stopped */ }
  }
  finalize(runId, h.win)
  return true
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
function emitDone(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:done', state)
}
