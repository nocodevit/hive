/**
 * Compress claude's post-/compact synthetic user message into a small
 * timeline hint entry.
 *
 * The full message is a wall of prose starting with "This session is
 * being continued from a previous conversation…" and ending with a
 * line like "…read the full transcript at: /path/to/session.jsonl".
 * Rendered as a normal user bubble it dumps 5-15 KB of purple text
 * into the timeline every compact / Compact+Fork. Users rarely if ever
 * scroll back to it; the actionable payload is just the jsonl path,
 * which we surface behind a collapsed <details> in
 * CompactSummaryHint.
 *
 * Pure helper — the live handler (index.tsx) and the historical
 * replay flatten (flatten.ts) both call it so the two paths cannot
 * drift.
 */

export interface CompactSummaryHint {
  transcriptPath?: string
  summaryChars: number
}

/**
 * True iff the event is claude's synthetic compact summary — a `user`
 * event with `isCompactSummary: true` on the top level. The
 * companion `isVisibleInTranscriptOnly: true` is present in every
 * observed example but not required here (the primary flag is
 * definitive on its own).
 */
export function isCompactSummaryEvent(ev: unknown): boolean {
  if (!ev || typeof ev !== 'object') return false
  return (ev as { isCompactSummary?: unknown }).isCompactSummary === true
}

/**
 * Extract the transcript path + prose length from the compact summary
 * body. The path appears in a trailing sentence:
 *   "…read the full transcript at: /Users/.../<uuid>.jsonl"
 * On any older/newer variant that omits that sentence we still return
 * the char count so the hint chip can show "N chars hidden" without
 * a link.
 */
export function extractCompactSummaryHint(ev: unknown): CompactSummaryHint {
  const raw = ev && typeof ev === 'object'
    ? (ev as { message?: { content?: unknown } }).message?.content
    : undefined
  const text = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw
          .filter((b): b is { type: string; text?: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text')
          .map(b => String(b.text ?? ''))
          .join('\n')
      : ''
  // Deliberately anchor on "transcript at:" so a summary that mentions
  // the phrase in body prose (not the trailing sentence) doesn't
  // pull the wrong path. Path pattern: whitespace-terminated absolute
  // filesystem path ending in .jsonl.
  const m = text.match(/transcript\s+at:\s*(\S+\.jsonl)/i)
  return {
    transcriptPath: m ? m[1] : undefined,
    summaryChars: text.length
  }
}
