/**
 * Pure helpers for the chat status bar — grain math and ctx-pressure
 * threshold selection. Extracted out of index.tsx so they're testable
 * in node-env vitest.
 */

export interface GrainBar {
  filled: number
  empty: number
}

export function computeGrainBar(pct: number | undefined, total = 10): GrainBar {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return { filled: 0, empty: total }
  const clamped = Math.max(0, Math.min(100, pct))
  const filled = Math.round((clamped / 100) * total)
  return { filled, empty: total - filled }
}

/**
 * Parse a model's context-window size string ("1M", "200K", etc.)
 * into an integer token count. Returns 0 for unrecognized input.
 */
export function parseContextSize(s: string | undefined): number {
  if (!s) return 0
  const m = s.match(/^(\d+)\s*([kKmM])$/)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n)) return 0
  return m[2].toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000
}

export type CtxNagTier = 'warn' | 'urgent' | null

/**
 * Decide which nag tier (if any) to show given current ctx % and the
 * user's dismissal state. Urgent (>=90) wins over warn (>=80); each
 * tier respects its own dismissal. Below 80 → no banner.
 */
export function selectCtxNagTier(
  pct: number,
  dismissed: { warn: boolean; urgent: boolean }
): CtxNagTier {
  if (pct >= 90) return dismissed.urgent ? null : 'urgent'
  if (pct >= 80) return dismissed.warn ? null : 'warn'
  return null
}
