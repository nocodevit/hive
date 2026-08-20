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
 * v2.5.1: parseContextSize is now defined ONCE in src/shared/context-size.ts
 * and re-exported here so existing importers (renderers/tests) keep working.
 * Consolidation was requested by user: "应该用同一个基础不是吗" — main-
 * process Handoff supervisor now uses the exact same math, no drift.
 */
export { parseContextSize } from '../../../../shared/context-size'

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

export type CompactBtnTier = 'normal' | 'warn' | 'urgent'

/**
 * Tier for the always-on Compact button in the action toolbar.
 * Different (lower) thresholds than the nag banner: 60% triggers a
 * Zest border + `(⚠ X%)` suffix on the label, 80% escalates to
 * Sriracha (matching the nag banner's urgent color).
 */
export function selectCompactBtnTier(pct: number): CompactBtnTier {
  if (pct >= 80) return 'urgent'
  if (pct >= 60) return 'warn'
  return 'normal'
}
