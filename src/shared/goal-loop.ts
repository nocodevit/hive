// A native `/goal` keeps a session going with a Stop hook: every time
// Claude tries to end its turn, the hook answers "not done" and Claude
// goes again — all inside ONE turn. Anything the user sends meanwhile is
// only queued until that turn ends, so a stuck goal cannot be told to
// stop: `/goal clear` itself waits behind the loop it is meant to end.
// Interrupting the turn right after sending makes the queued message run
// immediately (verified: "Goal cleared", no further hook rounds).

const FEEDBACK_PREFIX = 'Stop hook feedback:'

/** The hook's text if this stream event is one of its "not done" rounds. */
export function stopHookFeedback(ev: unknown): string | null {
  const e = ev as { type?: unknown; message?: { content?: unknown } } | null
  if (!e || e.type !== 'user') return null
  const content = e.message?.content
  const texts = typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.filter(b => b?.type === 'text').map(b => String(b.text ?? ''))
      : []
  const hit = texts.find(t => t.trimStart().startsWith(FEEDBACK_PREFIX))
  return hit === undefined ? null : hit.trimStart().slice(FEEDBACK_PREFIX.length).trim()
}

export function isGoalClearCommand(text: string): boolean {
  return /^\/goal\s+clear\s*$/i.test(text.trim())
}

/**
 * Tracks whether a goal loop is still doing work or just spinning: Claude
 * answers "nothing left I can do", the hook sends it back, repeat.
 * `idleRounds` counts consecutive hook rounds with no tool call between
 * them; a round that follows real work starts the count again at 1.
 */
export interface HookLoopState { idleRounds: number; toolSinceHook: boolean }
export const HOOK_LOOP_IDLE: HookLoopState = { idleRounds: 0, toolSinceHook: false }

export function hookLoopStep(state: HookLoopState, ev: unknown): HookLoopState {
  const e = ev as { type?: unknown; parent_tool_use_id?: unknown; message?: { content?: unknown } } | null
  if (!e) return state
  if (e.type === 'result' && e.parent_tool_use_id == null) return HOOK_LOOP_IDLE
  if (stopHookFeedback(ev) !== null) {
    return { idleRounds: state.toolSinceHook ? 1 : state.idleRounds + 1, toolSinceHook: false }
  }
  if (e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some(b => b?.type === 'tool_use')) {
    return { ...state, toolSinceHook: true }
  }
  return state
}

/** Idle rounds after which the loop counts as stuck (and the UI offers to clear it). */
export const GOAL_LOOP_STUCK_AFTER = 2

/**
 * Should sending this message also interrupt the running turn?
 * - `/goal clear`: yes, during any running turn — it is an explicit stop.
 * - anything else: only when the loop is stuck spinning. While the goal
 *   is still doing real work, an ordinary message waits its turn rather
 *   than cancelling a tool call half-way.
 * Never when idle — there is nothing to interrupt.
 */
export function shouldPreemptOnSend(opts: { text: string; working: boolean; idleRounds: number }): boolean {
  if (!opts.working) return false
  return isGoalClearCommand(opts.text) || opts.idleRounds >= GOAL_LOOP_STUCK_AFTER
}

/** One collapsed timeline line for a run of hook rounds (not N user bubbles). */
export function goalCheckLine(rounds: number): string {
  return `↻ Goal not met yet — Claude was sent back to continue${rounds > 1 ? ` (×${rounds})` : ''}`
}
