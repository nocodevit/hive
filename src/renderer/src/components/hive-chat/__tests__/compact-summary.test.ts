import { describe, it, expect } from 'vitest'
import { isCompactSummaryEvent, extractCompactSummaryHint } from '../compact-summary'

/**
 * Realistic slice of the exact event claude writes into <session>.jsonl
 * after `/compact`. Truncated to the trailing sentence + a chunk of
 * middle prose so tests stay readable.
 */
const REAL_TAIL = "…Summary of prior work continues…\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/meiyang/.claude/projects/-Users-meiyang-FrontEndProjects-cube-new-wendy/b9e59b6b-66d4-42cc-a27c-91910bf132c6.jsonl"

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
})

describe('extractCompactSummaryHint', () => {
  it('pulls the jsonl path out of the trailing "transcript at:" sentence', () => {
    const h = extractCompactSummaryHint(realEvent)
    expect(h.transcriptPath).toBe('/Users/meiyang/.claude/projects/-Users-meiyang-FrontEndProjects-cube-new-wendy/b9e59b6b-66d4-42cc-a27c-91910bf132c6.jsonl')
    expect(h.summaryChars).toBe(REAL_TAIL.length)
  })

  it('handles the block-array content variant (content: [{type:text, text:…}])', () => {
    const h = extractCompactSummaryHint({
      type: 'user', isCompactSummary: true,
      message: { role: 'user', content: [{ type: 'text', text: REAL_TAIL }] }
    })
    expect(h.transcriptPath).toBe('/Users/meiyang/.claude/projects/-Users-meiyang-FrontEndProjects-cube-new-wendy/b9e59b6b-66d4-42cc-a27c-91910bf132c6.jsonl')
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
