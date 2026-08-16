/**
 * Pure logic for the Handoff feature (v2.2.0 — chat-inject model).
 *
 * v2.1.0 spawned a separate `claude -p` subprocess per handoff and used
 * DIY cost tracking / --max-budget-usd. That was over-engineered.
 *
 * v2.2.0 injects `/goal <composed>` into the existing chat's claude
 * subprocess (via sendUserMessage) and subscribes to chat.ts's event bus
 * to enforce breakers. This module holds all the pure logic that the
 * runtime supervisor calls per event:
 *   - composeGoalCondition: join user's checkbox goals into one string
 *   - parseStreamJsonLine: safe JSON parse (still needed for tests)
 *   - applyEvent: state transition on stream-json event
 *   - detectAskUserQuestion: recognize claude asking a human question
 *   - checkCircuitBreakers: turn/cost/wall (with pause offset) breaker check
 *   - formatRemaining / formatDuration: banner text helpers
 *
 * Rope presets (Quick/Normal/Marathon) are kept as UI convenience for the
 * modal's autofill buttons — they no longer wrap the entire config.
 */

/** Optional per-breaker knobs. Only fields the user checked get numbers. */
export interface HandoffBreakers {
  maxTurns?: number
  maxCostUsd?: number
  maxWallTimeMs?: number
  gateScriptPath?: string
  stopOnAskUserQuestion?: boolean
}

export interface HandoffConfig {
  runId: string
  chatId: string       // the HiveChat id — passed to sendUserMessage / interruptSession
  agentId: string      // display + used to key active overlay set for renderer
  goals: string[]      // free-text and preset-derived goal fragments (composeGoalCondition joins)
  breakers: HandoffBreakers
}

export type HandoffStatus = 'running' | 'paused' | 'done' | 'stopped' | 'failed'

export interface HandoffState {
  runId: string
  chatId: string
  agentId: string
  status: HandoffStatus
  turnCount: number
  totalCostUsd: number
  startedAt: number
  elapsedMs: number
  pausedMs: number             // total accumulated paused duration (5h rate-limit)
  pauseStartedAt?: number      // when current pause began; undefined if not paused
  lastReason?: string          // e.g. evaluator's last "no" reason
  stopReason?: string
}

export type CircuitBreakerResult =
  | { trip: false }
  | { trip: true; reason: 'turns' | 'cost' | 'wall' | 'askUserQuestion'; detail: string }

// --------- Rope presets (UI-only autofill) --------- //

export type RopeKey = 'quick' | 'normal' | 'marathon'

export interface RopePreset {
  maxTurns: number
  maxCostUsd: number
  maxWallTimeMs: number
}

export function buildRopePresets(): Record<RopeKey, RopePreset> {
  return {
    quick:    { maxTurns: 15,  maxCostUsd: 1,  maxWallTimeMs: 15 * 60 * 1000 },
    normal:   { maxTurns: 60,  maxCostUsd: 5,  maxWallTimeMs: 2 * 60 * 60 * 1000 },
    marathon: { maxTurns: 200, maxCostUsd: 20, maxWallTimeMs: 8 * 60 * 60 * 1000 }
  }
}

// --------- Goal composition --------- //

/**
 * Compose the user's checkbox goals + free text into a single /goal
 * condition string. Multiple goals join with "AND ALSO" so claude's
 * Haiku evaluator treats them as a conjunction (all must hold).
 *
 * If the user included a turn cap breaker, append the "or stop after N
 * turns" clause per Anthropic's /goal docs recommendation — the native
 * evaluator honors it and we get belt-and-suspenders with our external
 * turn counter.
 */
export function composeGoalCondition(goals: string[], breakers: HandoffBreakers): string {
  const clean = goals.map(g => g.trim()).filter(Boolean)
  if (clean.length === 0) return ''
  const joined = clean.length === 1
    ? clean[0]
    : clean.map((g, i) => `(${i + 1}) ${g}`).join(' AND ALSO ')
  const turnClause = breakers.maxTurns
    ? ` (or stop after ${breakers.maxTurns} turns)`
    : ''
  return joined + turnClause
}

/**
 * Compose the full text sent via sendUserMessage. The `/goal ` prefix
 * activates claude's native completion checker. Kept as a separate
 * helper so the runtime file stays free of string plumbing.
 */
export function composeSlashGoalCommand(goals: string[], breakers: HandoffBreakers): string {
  return `/goal ${composeGoalCondition(goals, breakers)}`
}

// --------- Event parsing --------- //

/** Safe JSON parse of one stream-json line. Returns null for blanks or garbage. */
export function parseStreamJsonLine(line: string): Record<string, unknown> | null {
  const s = line.trim()
  if (!s) return null
  try {
    const parsed = JSON.parse(s)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Detect an AskUserQuestion tool_use in an assistant event's content
 * blocks. Claude uses this native tool when it genuinely needs human
 * judgement (structured multiple-choice), distinct from PermissionRequest
 * which is tool-approval and gets auto-allowed in handoff mode.
 */
export function detectAskUserQuestion(event: Record<string, unknown>): boolean {
  if (event.type !== 'assistant') return false
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown }
      if (b.type === 'tool_use' && b.name === 'AskUserQuestion') return true
    }
  }
  return false
}

// --------- State transitions --------- //

/**
 * Pure state transition: apply one stream-json event.
 * - `type:result` events are the turn boundaries — increment turnCount + add cost.
 * - Everything else is metadata: refresh elapsedMs so the banner clock stays live.
 * Pause bookkeeping is done by the runtime (start/end pause helpers below).
 */
export function applyEvent(state: HandoffState, event: Record<string, unknown>, now: number): HandoffState {
  const next = { ...state, elapsedMs: liveElapsedMs(state, now) }
  if (event.type === 'result') {
    const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0
    next.turnCount = state.turnCount + 1
    next.totalCostUsd = state.totalCostUsd + Math.max(0, cost)
  }
  return next
}

/** Elapsed wall time excluding current + accumulated paused duration. */
export function liveElapsedMs(state: HandoffState, now: number): number {
  const rawElapsed = now - state.startedAt
  const currentPause = state.pauseStartedAt ? Math.max(0, now - state.pauseStartedAt) : 0
  return Math.max(0, rawElapsed - state.pausedMs - currentPause)
}

// --------- Circuit breakers --------- //

/**
 * Check the four external breakers. Order: askUserQuestion > turns > cost > wall.
 * askUserQuestion first because it's a hard "human required" signal and other
 * breakers might not trip on the same turn.
 */
export function checkCircuitBreakers(state: HandoffState, config: HandoffConfig, now: number, askedQuestion = false): CircuitBreakerResult {
  const b = config.breakers
  if (b.stopOnAskUserQuestion && askedQuestion) {
    return { trip: true, reason: 'askUserQuestion', detail: 'claude asked a question — needs human decision' }
  }
  if (b.maxTurns !== undefined && state.turnCount >= b.maxTurns) {
    return { trip: true, reason: 'turns', detail: `hit turn cap ${b.maxTurns}` }
  }
  if (b.maxCostUsd !== undefined && state.totalCostUsd >= b.maxCostUsd) {
    return { trip: true, reason: 'cost', detail: `hit cost cap $${b.maxCostUsd.toFixed(2)} (spent $${state.totalCostUsd.toFixed(2)})` }
  }
  if (b.maxWallTimeMs !== undefined && liveElapsedMs(state, now) >= b.maxWallTimeMs) {
    const mins = Math.round(b.maxWallTimeMs / 60_000)
    return { trip: true, reason: 'wall', detail: `hit wall-time cap ${mins} min (pause time excluded)` }
  }
  return { trip: false }
}

// --------- State factory --------- //

export function initialState(config: HandoffConfig, startedAt: number): HandoffState {
  return {
    runId: config.runId,
    chatId: config.chatId,
    agentId: config.agentId,
    status: 'running',
    turnCount: 0,
    totalCostUsd: 0,
    startedAt,
    elapsedMs: 0,
    pausedMs: 0
  }
}

/** Enter pause (called when rate_limit_event with status='blocked' arrives). */
export function beginPause(state: HandoffState, now: number): HandoffState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', pauseStartedAt: now }
}

/** Exit pause (called when rate-limit reset timer fires and we resume). */
export function endPause(state: HandoffState, now: number): HandoffState {
  if (state.status !== 'paused' || !state.pauseStartedAt) return state
  const pauseDur = Math.max(0, now - state.pauseStartedAt)
  return {
    ...state,
    status: 'running',
    pauseStartedAt: undefined,
    pausedMs: state.pausedMs + pauseDur
  }
}

// --------- UI helpers --------- //

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatRemaining(state: HandoffState, config: HandoffConfig, now: number): string {
  const cap = config.breakers.maxWallTimeMs
  if (cap === undefined) return 'no wall cap'
  const remaining = Math.max(0, cap - liveElapsedMs(state, now))
  const mins = Math.round(remaining / 60_000)
  if (mins < 60) return `~${mins}m left`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `~${hours}h ${rem}m left` : `~${hours}h left`
}
