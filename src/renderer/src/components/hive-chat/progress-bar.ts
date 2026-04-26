/**
 * Pure math for the grain-style progress bar (`█` filled, `░` empty).
 * Extracted out of index.tsx so it's testable in node-env vitest.
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
