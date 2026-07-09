/**
 * Session-scoped permission gate for claude's `control_request` →
 * `can_use_tool` events.
 *
 * ## The bug this fixes
 *
 * Claude asks Hive for permission on every tool call via the stdio
 * `--permission-prompt-tool` protocol. For **shell/file tools** (Bash,
 * Read, Edit, Write, etc.) claude usually attaches a `permission_suggestions`
 * array with a rule shape like `Bash(git *)`, which Hive surfaces as an
 * "Allow & remember" button that persists to `~/.claude/settings.json` —
 * one click, never asked again.
 *
 * For **MCP tools** (e.g. `mcp__stargate__jira_update_issue`), claude
 * typically sends the `control_request` with NO `permission_suggestions`
 * at all (the tool's input is arbitrary JSON with no shape claude can
 * generalize into a rule). Hive therefore only shows "Allow once", and
 * the user is re-prompted for every single call. When an assistant turn
 * emits N parallel MCP calls (observed live: 4× `jira_update_issue` at
 * 05:26:11.845 / .12.848 / .13.357 / .13.760 — same message_id,
 * `caller: direct`, sub-second apart), the user faces N modal clicks
 * back-to-back for what was one logical intent.
 *
 * ## The fix
 *
 * A session-scoped in-memory allowlist (`Set<toolName>`) per chat id
 * (survives Compact/Resume/Fork recycles since intent is per-chat, not
 * per-subprocess). When a `control_request/can_use_tool` arrives whose
 * `tool_name` is already in the set, main auto-responds `allow` and
 * does NOT broadcast the event to the renderer → no modal, no
 * friction. The set is populated via the new "Allow this session"
 * button in the permission modal.
 *
 * Same button also drains any currently-queued permissions for the
 * same tool on the renderer side, so the parallel-call batch collapses
 * to a single click even before the main-side allowlist kicks in.
 *
 * ## Why extract a pure helper
 *
 * The stdout loop in chat.ts is a hot path that also has to survive
 * schema drift (claude has broken `permission_suggestions` shape once
 * already — see the `describeSuggestion` v1/v2 saga). This helper does
 * every defensive shape check so a defensive `false` (fall through to
 * renderer modal) is always safer than a wrong `true` (silently allow
 * something the user didn't approve).
 */

export type AutoAllowDecision =
  | { autoAllow: false }
  | {
      autoAllow: true
      requestId: string
      toolName: string
      input: Record<string, unknown>
    }

/**
 * True iff `event` is a `control_request/can_use_tool` for a tool that
 * `allowedTools` already contains. Returns the fields needed to
 * `respondPermission(id, requestId, 'allow', input)` without any
 * further parsing at the call site.
 */
export function shouldAutoAllow(event: unknown, allowedTools: Set<string>): AutoAllowDecision {
  if (!event || typeof event !== 'object') return { autoAllow: false }
  const ev = event as Record<string, unknown>
  if (ev.type !== 'control_request') return { autoAllow: false }
  const req = ev.request
  if (!req || typeof req !== 'object') return { autoAllow: false }
  const r = req as Record<string, unknown>
  if (r.subtype !== 'can_use_tool') return { autoAllow: false }
  const toolName = r.tool_name
  if (typeof toolName !== 'string' || !toolName) return { autoAllow: false }
  if (!allowedTools.has(toolName)) return { autoAllow: false }
  const requestId = ev.request_id
  if (typeof requestId !== 'string' || !requestId) return { autoAllow: false }
  // Only accept plain object input. Arrays/nulls/primitives → coerce to {}
  // (respondPermission needs a record for the `updatedInput` echo).
  const rawInput = r.input
  const input =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {}
  return { autoAllow: true, requestId, toolName, input }
}
