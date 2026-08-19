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

export type HandoffStatus = 'running' | 'paused' | 'compacting' | 'done' | 'stopped' | 'failed'

/** Fixed threshold for auto-compact during Handoff (v2.5.0). Hardcoded per
 * user's "you decide" — not exposed in the modal to keep the checkbox
 * grid clean. If future users want it configurable, add a breakers field. */
export const AUTO_COMPACT_PCT_THRESHOLD = 0.70

/**
 * Report-card stats accumulated over a handoff run. All fields are
 * derived from streamed events — no separate log needed. Rendered in
 * HandoffReportCard on handoff:done.
 */
export interface HandoffStats {
  filesEdited: string[]                                // deduped paths from Edit/Write tool_use
  commits: Array<{ sha?: string; msg: string }>       // from Bash `git commit -m "..."` + tool_result sha
  lastTestRun?: { command: string; passed?: number; failed?: number; ok: boolean }
  toolErrorsRecovered: number                          // count of tool_result.is_error === true
  autoCompactCount: number                             // v2.5.0: how many times auto-compact fired
  autoCompactCostUsd: number                           // v2.5.0: total $ spent on auto-compact runs
}

export function emptyStats(): HandoffStats {
  return { filesEdited: [], commits: [], toolErrorsRecovered: 0, autoCompactCount: 0, autoCompactCostUsd: 0 }
}

// --------- Context measurement (v2.5.0) --------- //

/**
 * Extract input_tokens from an assistant event's usage field. Claude
 * emits this on every assistant message. Returns null when absent
 * (e.g. streaming intermediate events, system events).
 */
export function extractInputTokens(event: Record<string, unknown>): number | null {
  if (event.type !== 'assistant') return null
  const msg = event.message as { usage?: { input_tokens?: unknown } } | undefined
  const t = msg?.usage?.input_tokens
  return typeof t === 'number' && t >= 0 ? t : null
}

/**
 * Parse the model's advertised context size string ("1M", "200K", "1000000")
 * into a token count. Matches parseContextSize in the renderer's
 * progress-bar module so front + back agree.
 */
export function parseContextSize(s: string): number {
  const cleaned = String(s || '').trim().toUpperCase()
  const m = cleaned.match(/^([\d.]+)\s*([KM])?$/)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return 0
  if (m[2] === 'M') return n * 1_000_000
  if (m[2] === 'K') return n * 1_000
  return n
}

/**
 * Should the supervisor trigger auto-compact right now?
 * True iff pct >= threshold AND we're not already compacting/paused/stopped.
 * Zero throttling per user directive ("每次 compact 都能低于 10%").
 */
export function shouldTriggerAutoCompact(pct: number, status: HandoffStatus, alreadyCompacting: boolean, threshold = AUTO_COMPACT_PCT_THRESHOLD): boolean {
  if (alreadyCompacting) return false
  if (status !== 'running') return false
  if (!Number.isFinite(pct) || pct < 0) return false
  return pct >= threshold
}

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
  stats?: HandoffStats         // v2.3.0: accumulated during run, sent with handoff:done
  askedQuestion?: { question: string; options?: Array<{ label: string; description?: string }> } // v2.3.0 pause payload
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
    pausedMs: 0,
    stats: emptyStats()
  }
}

// --------- Stats extraction (pure) --------- //

/** Extract file_path from an Edit / Write tool_use event, if applicable. */
export function extractEditedFilePath(event: Record<string, unknown>): string | null {
  if (event.type !== 'assistant') return null
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown; input?: { file_path?: unknown } }
      if (b.type === 'tool_use' && (b.name === 'Edit' || b.name === 'Write' || b.name === 'MultiEdit')) {
        const p = b.input?.file_path
        if (typeof p === 'string' && p.length > 0) return p
      }
    }
  }
  return null
}

/** Extract git commit message from a Bash tool_use command, if `git commit -m`. */
export function extractCommitFromBash(event: Record<string, unknown>): string | null {
  if (event.type !== 'assistant') return null
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown; input?: { command?: unknown } }
      if (b.type === 'tool_use' && b.name === 'Bash' && typeof b.input?.command === 'string') {
        // Match: git commit -m "..." OR git commit -m '...' OR heredoc-style
        const m = b.input.command.match(/git\s+commit(?:\s+[^-][^\s]*)*\s+-m\s+["'](.+?)["']/s)
        if (m) return m[1].split('\n')[0].slice(0, 200)
      }
    }
  }
  return null
}

/** Extract a test-run summary from a Bash tool_result — best-effort. */
export function extractTestSummary(event: Record<string, unknown>, lastBashCmd: string | null): { command: string; passed?: number; failed?: number; ok: boolean } | null {
  if (event.type !== 'user' || !lastBashCmd) return null
  if (!/npm test|vitest|pytest|jest|go test|cargo test/i.test(lastBashCmd)) return null
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; content?: unknown; is_error?: unknown }
      if (b.type === 'tool_result') {
        const text = Array.isArray(b.content)
          ? b.content.map((c: any) => c?.text ?? '').join('\n')
          : String(b.content ?? '')
        // Common patterns: "47 passed", "3 failed", "Tests: 47 passed | 3 failed"
        const passedMatch = text.match(/(\d+)\s+passed/i)
        const failedMatch = text.match(/(\d+)\s+failed/i)
        const passed = passedMatch ? parseInt(passedMatch[1], 10) : undefined
        const failed = failedMatch ? parseInt(failedMatch[1], 10) : undefined
        const ok = !b.is_error && (failed ?? 0) === 0
        return { command: lastBashCmd, passed, failed, ok }
      }
    }
  }
  return null
}

/** Was this event a tool_result with is_error=true? Counts recovered errors. */
export function isToolErrorResult(event: Record<string, unknown>): boolean {
  if (event.type !== 'user') return false
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return false
  return content.some(block => {
    if (!block || typeof block !== 'object') return false
    const b = block as { type?: unknown; is_error?: unknown }
    return b.type === 'tool_result' && b.is_error === true
  })
}

/** Extract the pending Bash command being invoked (used to attribute test-run tool_result). */
export function extractBashCommand(event: Record<string, unknown>): string | null {
  if (event.type !== 'assistant') return null
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown; input?: { command?: unknown } }
      if (b.type === 'tool_use' && b.name === 'Bash' && typeof b.input?.command === 'string') {
        return b.input.command
      }
    }
  }
  return null
}

/** Pure: fold a stream event into an existing stats snapshot. */
export function foldStats(stats: HandoffStats, event: Record<string, unknown>, lastBashCmd: string | null): { stats: HandoffStats; nextBashCmd: string | null } {
  let nextStats = stats
  let nextBashCmd = lastBashCmd

  const editedPath = extractEditedFilePath(event)
  if (editedPath && !stats.filesEdited.includes(editedPath)) {
    nextStats = { ...nextStats, filesEdited: [...nextStats.filesEdited, editedPath] }
  }

  const commitMsg = extractCommitFromBash(event)
  if (commitMsg) {
    nextStats = { ...nextStats, commits: [...nextStats.commits, { msg: commitMsg }] }
  }

  const bashCmd = extractBashCommand(event)
  if (bashCmd) nextBashCmd = bashCmd

  const testSummary = extractTestSummary(event, lastBashCmd)
  if (testSummary) {
    nextStats = { ...nextStats, lastTestRun: testSummary }
    nextBashCmd = null  // consumed
  }

  if (isToolErrorResult(event)) {
    nextStats = { ...nextStats, toolErrorsRecovered: nextStats.toolErrorsRecovered + 1 }
  }

  return { stats: nextStats, nextBashCmd }
}

/** Detect AskUserQuestion payload (question + options) for pause UI. */
export function extractAskUserQuestion(event: Record<string, unknown>): { question: string; options?: Array<{ label: string; description?: string }> } | null {
  if (event.type !== 'assistant') return null
  const msg = event.message as { content?: unknown } | undefined
  const content = msg?.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: unknown; name?: unknown; input?: { question?: unknown; questions?: unknown; options?: unknown } }
      if (b.type === 'tool_use' && b.name === 'AskUserQuestion') {
        // Real payload shape: { questions: [{ question, options: [...] }] } — take the first question.
        const questions = b.input?.questions as Array<{ question?: string; options?: Array<{ label?: string; description?: string }> }> | undefined
        if (Array.isArray(questions) && questions.length > 0 && typeof questions[0].question === 'string') {
          return {
            question: questions[0].question,
            options: (questions[0].options || []).map(o => ({ label: String(o?.label || ''), description: o?.description ? String(o.description) : undefined }))
          }
        }
        // Fallback simpler shape: { question, options }
        if (typeof b.input?.question === 'string') {
          const opts = Array.isArray(b.input.options) ? (b.input.options as Array<{ label?: string; description?: string }>).map(o => ({ label: String(o?.label || ''), description: o?.description ? String(o.description) : undefined })) : undefined
          return { question: b.input.question, options: opts }
        }
        return { question: '(agent asked a question — see chat)' }
      }
    }
  }
  return null
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
