/**
 * Pure logic for the Handoff feature (v2.1.0). No side effects, no I/O — the
 * runtime in `handoff.ts` spawns claude and calls these helpers on every
 * stream-json event.
 *
 * Why split: the supervisor loop is Claude's native `/goal` command (a
 * session-scoped Stop hook with a Haiku evaluator). `/goal` handles
 * completion detection + one turn-count cap, but has NO cost cap, wall-time
 * cap, or no-progress detection. This module encodes those three extra
 * circuit breakers as pure functions so they're exhaustively unit-testable
 * without spawning claude.
 */

export type RopeKey = 'quick' | 'normal' | 'marathon'

export interface RopePreset {
  maxTurns: number
  maxCostUsd: number
  maxWallTimeMs: number
}

export interface HandoffConfig {
  runId: string
  agentId: string
  cwd: string
  goal: string
  rope: RopeKey
  maxTurns: number
  maxCostUsd: number
  maxWallTimeMs: number
}

export type HandoffStatus = 'running' | 'done' | 'stopped' | 'failed'

export interface HandoffState {
  runId: string
  agentId: string
  status: HandoffStatus
  turnCount: number
  totalCostUsd: number
  startedAt: number
  elapsedMs: number
  lastReason?: string
  stopReason?: string
}

export type CircuitBreakerResult =
  | { trip: false }
  | { trip: true; reason: 'turns' | 'cost' | 'wall'; detail: string }

/**
 * Preset configs for the three rope lengths surfaced in the Handoff modal.
 * These numbers are ceilings, not budgets to burn — most tasks finish well
 * before hitting them.
 */
export function buildRopePresets(): Record<RopeKey, RopePreset> {
  return {
    quick: { maxTurns: 15, maxCostUsd: 1, maxWallTimeMs: 15 * 60 * 1000 },
    normal: { maxTurns: 60, maxCostUsd: 5, maxWallTimeMs: 2 * 60 * 60 * 1000 },
    marathon: { maxTurns: 200, maxCostUsd: 20, maxWallTimeMs: 8 * 60 * 60 * 1000 }
  }
}

/**
 * Wrap the user's goal with a turn-count clause so /goal's own evaluator
 * enforces the cap too (belt-and-suspenders with our external SIGTERM
 * breaker). Anthropic's /goal docs recommend this exact form.
 */
export function goalWithTurnCap(goal: string, maxTurns: number): string {
  const trimmed = goal.trim()
  return `${trimmed}\n\n(or stop after ${maxTurns} turns)`
}

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
 * Pure state transition: apply one stream-json event. Only `type:result`
 * events advance the turn counter and add cost — those are the natural
 * turn boundaries claude CLI emits, one per completed round. Everything
 * else (user/assistant/system events) is metadata we don't count.
 */
export function applyEvent(state: HandoffState, event: Record<string, unknown>, now: number): HandoffState {
  const next = { ...state, elapsedMs: now - state.startedAt }
  if (event.type === 'result') {
    const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : 0
    next.turnCount = state.turnCount + 1
    next.totalCostUsd = state.totalCostUsd + Math.max(0, cost)
  }
  return next
}

/**
 * Check the three external circuit breakers. Returns `{ trip: false }` when
 * safe to continue, or `{ trip: true, reason, detail }` when the supervisor
 * should SIGTERM the child.
 *
 * Order matters: turn > cost > wall so failure messages surface the most
 * specific reason if multiple limits are exceeded simultaneously.
 */
export function checkCircuitBreakers(state: HandoffState, config: HandoffConfig, now: number): CircuitBreakerResult {
  if (state.turnCount >= config.maxTurns) {
    return { trip: true, reason: 'turns', detail: `hit turn cap ${config.maxTurns}` }
  }
  if (state.totalCostUsd >= config.maxCostUsd) {
    return { trip: true, reason: 'cost', detail: `hit cost cap $${config.maxCostUsd.toFixed(2)} (spent $${state.totalCostUsd.toFixed(2)})` }
  }
  const elapsed = now - state.startedAt
  if (elapsed >= config.maxWallTimeMs) {
    const mins = Math.round(config.maxWallTimeMs / 60_000)
    return { trip: true, reason: 'wall', detail: `hit wall-time cap ${mins} min` }
  }
  return { trip: false }
}

/** Build the initial in-memory state for a fresh handoff. */
export function initialState(config: HandoffConfig, startedAt: number): HandoffState {
  return {
    runId: config.runId,
    agentId: config.agentId,
    status: 'running',
    turnCount: 0,
    totalCostUsd: 0,
    startedAt,
    elapsedMs: 0
  }
}

/** Build a config with rope-preset values applied. */
export function configFromRope(runId: string, agentId: string, cwd: string, goal: string, rope: RopeKey): HandoffConfig {
  const preset = buildRopePresets()[rope]
  return {
    runId,
    agentId,
    cwd,
    goal,
    rope,
    maxTurns: preset.maxTurns,
    maxCostUsd: preset.maxCostUsd,
    maxWallTimeMs: preset.maxWallTimeMs
  }
}

/** Human-readable remaining time for the UI banner. */
export function formatRemaining(state: HandoffState, config: HandoffConfig, now: number): string {
  const elapsed = now - state.startedAt
  const remaining = Math.max(0, config.maxWallTimeMs - elapsed)
  const mins = Math.round(remaining / 60_000)
  if (mins < 60) return `~${mins}m left`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `~${hours}h ${rem}m left` : `~${hours}h left`
}
