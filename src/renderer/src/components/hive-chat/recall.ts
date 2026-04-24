/**
 * Bash-style history recall for the HiveChat input. Pure helpers — the
 * UI layer owns the textarea + state refs, but the state transitions
 * (which index to land on, when to save/restore the draft) live here
 * so they can be unit-tested without wiring up a DOM.
 */

export interface RecallState {
  /** -1 = not browsing. 0 = most recent sent message, 1 = second-most, … */
  idx: number
  /** Saved current input when the user first hits ↑ — restored on ↓-past-newest. */
  draft: string
}

export const EMPTY_RECALL: RecallState = { idx: -1, draft: '' }

/**
 * ↑ step: returns the next older history item + new state, or null if:
 *   - there's no history
 *   - we're already at the oldest entry
 *   - cursor isn't at the top of the textarea AND we're not already browsing
 *     (so typing multi-line text + ↑ navigates within text, not history)
 */
export function recallUp(
  history: string[],
  state: RecallState,
  currentInput: string,
  cursorAtTop: boolean
): { state: RecallState; input: string } | null {
  if (!history.length) return null
  if (!cursorAtTop && state.idx === -1) return null
  const nextIdx = state.idx + 1
  if (nextIdx >= history.length) return null
  const draft = state.idx === -1 ? currentInput : state.draft
  return {
    state: { idx: nextIdx, draft },
    input: history[history.length - 1 - nextIdx]
  }
}

/**
 * ↓ step: only active while browsing. Past the newest entry it restores
 * the saved draft and exits browsing mode. Returns null outside browsing.
 */
export function recallDown(
  history: string[],
  state: RecallState
): { state: RecallState; input: string } | null {
  if (state.idx === -1 || !history.length) return null
  if (state.idx === 0) {
    return { state: EMPTY_RECALL, input: state.draft }
  }
  const nextIdx = state.idx - 1
  return {
    state: { idx: nextIdx, draft: state.draft },
    input: history[history.length - 1 - nextIdx]
  }
}

/**
 * After a successful send, append the text to the history ring and clamp
 * to `max`. Always returns EMPTY_RECALL so the next ↑ starts from the
 * newest entry again.
 */
export function pushAfterSend(
  history: string[],
  text: string,
  max: number
): { history: string[]; state: RecallState } {
  const next = [...history, text]
  const start = next.length > max ? next.length - max : 0
  return { history: next.slice(start), state: EMPTY_RECALL }
}
