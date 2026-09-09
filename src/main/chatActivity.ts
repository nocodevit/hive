// Agent activity derived from the live `claude --print` stream-json event flow —
// the ground truth of what a session is doing, replacing the old tool-edge curl
// hooks (PreToolUse→working / Stop→waiting) that could not see the gaps between
// tool calls. A session that is thinking or streaming text but hasn't invoked a
// tool yet emits assistant/stream_event deltas continuously, so it reads as
// 'working' immediately — not stuck gray until the next PreToolUse edge.
//
// Turn-based, NOT tool-based: any generation event means working; the terminal
// `result` event ends the turn → waiting. Crucially, idle is decided by the
// `result` event, never by stream silence — a long-running tool goes quiet
// mid-turn but the agent is still working, so silence must not flip it to idle.

export type AgentActivity = 'working' | 'waiting'

/**
 * Map one stream-json event to the activity it implies, or null when the event
 * is status-neutral (system/init, control_request/response, rate_limit_event,
 * etc.) and should leave the current activity unchanged.
 *
 * - `result`                       → waiting  (the turn finished)
 * - `assistant` / `user` / `stream_event` → working (generating / feeding a tool
 *                                    result / streaming a delta — all mid-turn)
 */
export function activityForEvent(ev: unknown): AgentActivity | null {
  const t = (ev as { type?: unknown } | null | undefined)?.type
  if (typeof t !== 'string') return null
  if (t === 'result') return 'waiting'
  if (t === 'assistant' || t === 'user' || t === 'stream_event') return 'working'
  return null
}

/**
 * Hive convention: a chat session id is `chat-<agentId>` (see Terminal.tsx and
 * handoff.ts). Strip the prefix to recover the agentId the renderer keys agents
 * by. A bare id (no prefix) is returned unchanged.
 */
export function agentIdFromChatId(chatId: string): string {
  return chatId.startsWith('chat-') ? chatId.slice(5) : chatId
}

/**
 * The agentIds of every chat session with a live child process. Used at renderer
 * boot to seed still-running agents as non-gray: the renderer hard-resets every
 * agent to 'done' on load (persisted status is untrustworthy), which would paint
 * a genuinely-alive session gray until its next stream event — and an alive but
 * idle session emits no further event, so it would stay gray indefinitely. A
 * session is live iff its `child` is non-null. Pure over the entries so it is
 * unit-testable without the module-level sessions map.
 */
export function liveAgentIdsFromSessions(
  entries: Iterable<readonly [string, { child: unknown }]>
): string[] {
  const ids: string[] = []
  for (const [id, sess] of entries) {
    if (sess.child !== null && sess.child !== undefined) ids.push(agentIdFromChatId(id))
  }
  return ids
}
