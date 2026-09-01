/**
 * Shared context-size helpers used by BOTH main-process code (Handoff
 * supervisor's auto-compact detection) and renderer code (ActionToolbar
 * top ctx% bar). Previously these had duplicate implementations that
 * diverged slightly on decimal handling; consolidated here in v2.5.1
 * per user directive "应该用同一个基础".
 *
 * Zero Node / Electron / DOM imports so it compiles into both bundles.
 */

/**
 * Parse a model's context-window size string ("1M", "200K",
 * "1.5M", "500000") into an integer token count. Returns 0 on any
 * unrecognized input so callers can skip cleanly (e.g. supervisor
 * bails out of auto-compact when contextSizeTokens is 0).
 *
 * Format accepted:
 *   - "<number>" bare integer                → literal
 *   - "<number>K" / "<number>k"              → × 1_000
 *   - "<number>M" / "<number>m"              → × 1_000_000
 *   - Leading/trailing whitespace tolerated
 *   - Decimal fractions accepted: "1.5M" → 1_500_000
 */
export function parseContextSize(s: string | undefined | null): number {
  if (!s) return 0
  const cleaned = String(s).trim().toUpperCase()
  const m = cleaned.match(/^([\d.]+)\s*([KM])?$/)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!Number.isFinite(n) || n < 0) return 0
  if (m[2] === 'M') return n * 1_000_000
  if (m[2] === 'K') return n * 1_000
  return n
}

/**
 * Resolve a token budget from claude's `system:init` event, gracefully
 * handling the case where recent claude-opus-5 emits no `contextSize`
 * field at all. Prefer the explicit string when present, otherwise
 * infer from model name (haiku = 200K, everything else = 1M).
 *
 * v2.15.4: renderer already had this fallback inline; extracted here
 * so the handoff supervisor (main process) can use the SAME rule and
 * auto-compact stops silently failing when contextSize is absent.
 */
export function resolveContextSizeTokens(explicit: unknown, model: unknown): number {
  if (typeof explicit === 'string' && explicit.length > 0) {
    const n = parseContextSize(explicit)
    if (n > 0) return n
  }
  if (typeof model === 'string' && model.length > 0) {
    return parseContextSize(/haiku/i.test(model) ? '200K' : '1M')
  }
  return 0
}

// ---------------------------------------------------------------------------
// Context tokens from a claude `usage` object — and the cumulative-cache trap.
//
// The SAME field names mean two different things depending on which event
// carries them:
//
//   assistant.message.usage → PER-REQUEST. One model call. The numbers are the
//     real, model-visible context at that instant.
//
//   result.usage → TURN-CUMULATIVE. An agentic turn runs many iterations (one
//     per tool call) and each re-reads the prompt prefix from cache, so
//     `cache_read_input_tokens` at the top level is the RUNNING TOTAL across
//     every iteration — not a context size. On a long tool-heavy turn it lands
//     at 10-40x the real window.
//
// Observed (the incident this fixes): a 1M-window session reported
//   input 46 + cache_creation 36,955 + cache_read 13,966,444 = 14,003,445
// and the UI rendered "1400% used (14,003,445 / 1,000,000 tokens) · run
// /compact". The same session's last assistant.usage read 620,606 — the true
// figure, 62%. The user was told to compact a session that was nowhere near
// full.
//
// A result event carries per-iteration objects under `usage.iterations`, and
// `iterations[-1]` IS per-request, so it is the correct source when present.
// The trap is the fallback: when `iterations` is absent or empty, reaching for
// the top-level object hands back exactly the cumulative number the
// iterations lookup exists to avoid. So there is no safe fallback for a result
// event — it must report "unknown" and let the caller keep the last per-request
// value it already has.

/** One request's model-visible context: input + both cache buckets. */
export function perRequestContextTokens(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0
  const u = usage as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  return num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
}

/**
 * Context tokens from a `result` event's usage — `iterations[-1]` only.
 *
 * Returns 0 when `iterations` is missing or empty. That is deliberate and is
 * the whole point of this function: 0 means "this event cannot tell us the
 * context size", and every caller already treats 0 as "leave the current value
 * alone". Falling back to the top-level object here is what produced 1400%.
 */
export function contextTokensFromResultUsage(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0
  const its = (usage as { iterations?: unknown }).iterations
  if (!Array.isArray(its) || its.length === 0) return 0
  return perRequestContextTokens(its[its.length - 1])
}
