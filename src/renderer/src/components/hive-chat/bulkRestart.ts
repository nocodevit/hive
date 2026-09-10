// "(Re)start All Agents" resumes each NOT-running agent's prior session, picking
// the mode by how full its context was — the same ctx math the StartChooser uses
// for its default focus, but auto-EXECUTED and at a lower threshold. Pure so the
// decision is unit-testable away from the React chooser.

export interface PrevCtxInfo {
  sid?: string
  contextSize: string
  peakInputTokens: number
}

/** Context used, as a whole percent (0 when unknown). `parseSize` maps a size
 *  label like "1M"/"200K" to a token count (inject parseContextSize). */
export function ctxPctFromPrev(
  info: PrevCtxInfo | null | undefined,
  parseSize: (s: string) => number
): number {
  if (!info) return 0
  const total = parseSize(info.contextSize)
  if (!(total > 0) || !(info.peakInputTokens > 0)) return 0
  return Math.round((info.peakInputTokens / total) * 100)
}

/** Default bulk-restart threshold (percent): at/above this, compact before resume. */
export const RESTART_COMPACT_THRESHOLD = 30

/**
 * The launch mode for a bulk restart:
 *   - no prior session            → 'new'
 *   - prior session, ctx ≥ threshold → 'compact-resume'
 *   - prior session, ctx < threshold → 'resume'
 */
export function restartResumeMode(
  hasPrev: boolean,
  ctxPct: number,
  threshold: number = RESTART_COMPACT_THRESHOLD
): 'compact-resume' | 'resume' | 'new' {
  if (!hasPrev) return 'new'
  return ctxPct >= threshold ? 'compact-resume' : 'resume'
}
