import { describe, it, expect } from 'vitest'
import { isCompactSummaryEvent, extractCompactSummaryHint, COMPACT_SUMMARY_OPENING } from '../compact-summary'

/**
 * Realistic slice of the exact event claude writes into <session>.jsonl
 * after `/compact`. Truncated to the trailing sentence + a chunk of
 * middle prose so tests stay readable.
 */
const REAL_TAIL = "…Summary of prior work continues…\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/test/.claude/projects/-Users-test-Projects-example/abc12345-0000-0000-0000-000000000000.jsonl"

const realEvent = {
  type: 'user',
  isCompactSummary: true,
  isVisibleInTranscriptOnly: true,
  message: { role: 'user', content: REAL_TAIL }
}

describe('isCompactSummaryEvent', () => {
  it('true when the flag is present', () => {
    expect(isCompactSummaryEvent(realEvent)).toBe(true)
  })

  it('false on a normal user event (no flag)', () => {
    expect(isCompactSummaryEvent({ type: 'user', message: { content: 'hi' } })).toBe(false)
  })

  it('false on flag=false', () => {
    expect(isCompactSummaryEvent({ ...realEvent, isCompactSummary: false })).toBe(false)
  })

  it('false on flag=truthy-but-not-true (defense: only accept literal true, no coercion surprises)', () => {
    expect(isCompactSummaryEvent({ ...realEvent, isCompactSummary: 1 })).toBe(false)
    expect(isCompactSummaryEvent({ ...realEvent, isCompactSummary: 'yes' })).toBe(false)
  })

  it('false on null/undefined/primitive input', () => {
    expect(isCompactSummaryEvent(null)).toBe(false)
    expect(isCompactSummaryEvent(undefined)).toBe(false)
    expect(isCompactSummaryEvent('user')).toBe(false)
    expect(isCompactSummaryEvent(42)).toBe(false)
  })

  // ---- v2.2.4 belt-and-suspenders: content-pattern fallback ----
  // If Anthropic renames isCompactSummary, or a future replay path
  // strips it again, the content prose still gives us a signal.
  describe('content-pattern fallback (flag missing / renamed)', () => {
    const wallContent = `${COMPACT_SUMMARY_OPENING}. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request…`

    it('true when flag is ABSENT but content starts with the canonical opening (string content)', () => {
      const ev = { type: 'user', message: { role: 'user', content: wallContent } }
      // no isCompactSummary flag on the event
      expect(isCompactSummaryEvent(ev)).toBe(true)
    })

    it('true when flag is ABSENT but content starts with the opening (block-array content)', () => {
      const ev = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: wallContent }] } }
      expect(isCompactSummaryEvent(ev)).toBe(true)
    })

    it('false when a user message just MENTIONS the phrase somewhere in the middle', () => {
      const ev = { type: 'user', message: { content: 'hey did you see the message "This session is being continued from a previous conversation"? weird right' } }
      expect(isCompactSummaryEvent(ev)).toBe(false)
    })

    it('false on assistant events even if they somehow contain the opening (compact-summary is user-only)', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'text', text: wallContent }] } }
      expect(isCompactSummaryEvent(ev)).toBe(false)
    })

    it('false on system events even if content matches (system events never carry compact-summary)', () => {
      const ev = { type: 'system', subtype: 'notification', message: { content: wallContent } }
      expect(isCompactSummaryEvent(ev)).toBe(false)
    })

    it('COMPACT_SUMMARY_OPENING is exported for grep-ability + external assertions', () => {
      expect(typeof COMPACT_SUMMARY_OPENING).toBe('string')
      expect(COMPACT_SUMMARY_OPENING.length).toBeGreaterThan(30)
    })
  })
})

describe('extractCompactSummaryHint', () => {
  it('pulls the jsonl path out of the trailing "transcript at:" sentence', () => {
    const h = extractCompactSummaryHint(realEvent)
    expect(h.transcriptPath).toBe('/Users/test/.claude/projects/-Users-test-Projects-example/abc12345-0000-0000-0000-000000000000.jsonl')
    expect(h.summaryChars).toBe(REAL_TAIL.length)
  })

  it('handles the block-array content variant (content: [{type:text, text:…}])', () => {
    const h = extractCompactSummaryHint({
      type: 'user', isCompactSummary: true,
      message: { role: 'user', content: [{ type: 'text', text: REAL_TAIL }] }
    })
    expect(h.transcriptPath).toBe('/Users/test/.claude/projects/-Users-test-Projects-example/abc12345-0000-0000-0000-000000000000.jsonl')
  })

  it('returns transcriptPath=undefined but still reports char count when the "transcript at:" line is absent', () => {
    const noTail = "Summary body only — some future claude variant omits the trailing sentence"
    const h = extractCompactSummaryHint({
      type: 'user', isCompactSummary: true, message: { content: noTail }
    })
    expect(h.transcriptPath).toBeUndefined()
    expect(h.summaryChars).toBe(noTail.length)
  })

  it('does NOT mistake a mid-body mention for the trailing path (anchor on "transcript at:")', () => {
    const misleading = "The user mentioned .jsonl files earlier. /tmp/decoy.jsonl was involved."
    const h = extractCompactSummaryHint({
      type: 'user', isCompactSummary: true, message: { content: misleading }
    })
    expect(h.transcriptPath).toBeUndefined()
  })

  it('is case-insensitive on the "transcript at:" anchor', () => {
    const upper = "See full Transcript At: /path/to/file.jsonl"
    const h = extractCompactSummaryHint({ type: 'user', message: { content: upper } })
    expect(h.transcriptPath).toBe('/path/to/file.jsonl')
  })

  it('non-object / missing message returns 0-char hint with no path', () => {
    expect(extractCompactSummaryHint(null)).toEqual({ transcriptPath: undefined, summaryChars: 0 })
    expect(extractCompactSummaryHint({})).toEqual({ transcriptPath: undefined, summaryChars: 0 })
  })
})
