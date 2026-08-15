/**
 * Handoff runtime supervisor (v2.1.0). Spawns `claude -p "/goal <goal>"` in
 * headless stream-json mode, tails stdout, drives the pure state machine in
 * `handoff-supervisor.ts`, and enforces three external circuit breakers
 * (turn, cost, wall-time) via SIGTERM.
 *
 * All I/O lives here — the pure logic module has zero side effects and is
 * exhaustively unit-tested. Keep it that way when extending (new breaker
 * dimensions belong in `handoff-supervisor.ts`, not this file).
 */
import { spawn, ChildProcess } from 'child_process'
import type { BrowserWindow } from 'electron'
import {
  applyEvent,
  buildRopePresets,
  checkCircuitBreakers,
  configFromRope,
  goalWithTurnCap,
  initialState,
  parseStreamJsonLine,
  type HandoffState,
  type RopeKey
} from './handoff-supervisor'

interface RunningHandoff {
  config: HandoffConfig
  state: HandoffState
  child: ChildProcess
  wallTimer: NodeJS.Timeout
  buffer: string
  win: BrowserWindow
}

const running = new Map<string, RunningHandoff>()

export interface StartHandoffInput {
  agentId: string
  cwd: string
  goal: string
  rope: RopeKey
}

export interface StartHandoffResult {
  ok: boolean
  runId?: string
  error?: string
}

/**
 * Spawn a headless claude with /goal + stream-json + verbose. The verbose
 * flag is REQUIRED for stream-json to emit per-turn events instead of
 * blocking silently until completion.
 */
export function startHandoff(input: StartHandoffInput, win: BrowserWindow): StartHandoffResult {
  if (!input.goal.trim()) return { ok: false, error: 'goal is empty' }
  if (!input.cwd) return { ok: false, error: 'cwd is empty' }
  // Rope is IPC input from the renderer — validate at the boundary rather
  // than trusting the type. An out-of-vocab rope would NPE downstream at
  // configFromRope (preset.maxTurns on undefined) and crash the handler.
  const validRopes = Object.keys(buildRopePresets()) as RopeKey[]
  if (!validRopes.includes(input.rope)) {
    return { ok: false, error: `invalid rope "${input.rope}" (expected one of: ${validRopes.join(', ')})` }
  }
  // One handoff per agent — if the user hits Handoff twice, refuse rather
  // than silently doubling up. Force them to Stop the first one visibly.
  for (const h of running.values()) {
    if (h.config.agentId === input.agentId) {
      return { ok: false, error: `agent already has a handoff running (${h.config.runId})` }
    }
  }

  const runId = `hnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const config = configFromRope(runId, input.agentId, input.cwd, input.goal, input.rope)
  const wrappedGoal = goalWithTurnCap(config.goal, config.maxTurns)
  const args = [
    '-p', `/goal ${wrappedGoal}`,
    '--output-format', 'stream-json',
    '--verbose'
  ]

  let child: ChildProcess
  try {
    child = spawn('claude', args, {
      cwd: config.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    return { ok: false, error: `spawn failed: ${String(err)}` }
  }

  const state = initialState(config, Date.now())
  let buffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const ev = parseStreamJsonLine(line)
      if (!ev) continue
      const before = state.turnCount
      const next = applyEvent(state, ev, Date.now())
      Object.assign(state, next)
      if (state.turnCount > before) {
        emitProgress(win, state)
        const cb = checkCircuitBreakers(state, config, Date.now())
        if (cb.trip && state.status === 'running') {
          state.status = 'stopped'
          state.stopReason = cb.detail
          try { child.kill('SIGTERM') } catch { /* already dead */ }
        }
      }
    }
  })

  child.stderr?.on('data', () => {
    // stderr is diagnostic only — do NOT flip state on this. claude emits
    // lots of harmless warnings (settings-file deprecations, MCP handshake
    // logs). Real errors come through as the process exit code.
  })

  const wallTimer = setInterval(() => {
    const cb = checkCircuitBreakers(state, config, Date.now())
    if (cb.trip && state.status === 'running') {
      state.status = 'stopped'
      state.stopReason = cb.detail
      try { child.kill('SIGTERM') } catch { /* already dead */ }
    }
  }, 60_000)

  child.on('exit', (code) => {
    clearInterval(wallTimer)
    if (state.status === 'running') {
      state.status = code === 0 ? 'done' : 'failed'
      if (state.status === 'failed') state.stopReason = `claude exited ${code}`
    }
    state.elapsedMs = Date.now() - state.startedAt
    running.delete(runId)
    emitDone(win, state)
  })

  running.set(runId, { config, state, child, wallTimer, buffer, win })
  emitProgress(win, state) // paint the banner immediately, don't wait for turn 1
  return { ok: true, runId }
}

/** Stop a running handoff — SIGTERM the child. Idempotent. */
export function stopHandoff(runId: string): boolean {
  const h = running.get(runId)
  if (!h) return false
  h.state.status = 'stopped'
  h.state.stopReason = 'stopped by user'
  try { h.child.kill('SIGTERM') } catch { /* already dead */ }
  return true
}

/** Snapshot of all currently-running handoffs, with elapsedMs freshly computed. */
export function listRunningHandoffs(): HandoffState[] {
  const now = Date.now()
  return Array.from(running.values()).map(h => ({ ...h.state, elapsedMs: now - h.state.startedAt }))
}

/** Set of agent IDs currently in a handoff — used by renderer to overlay
 * the "🥴 loop" sticker on avatars. Cheap enough to poll every few seconds. */
export function getActiveHandoffAgentIds(): string[] {
  return Array.from(running.values()).map(h => h.config.agentId)
}

function emitProgress(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:progress', state)
}
function emitDone(win: BrowserWindow, state: HandoffState) {
  if (win.isDestroyed()) return
  win.webContents.send('handoff:done', state)
}
