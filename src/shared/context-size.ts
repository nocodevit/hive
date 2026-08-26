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
