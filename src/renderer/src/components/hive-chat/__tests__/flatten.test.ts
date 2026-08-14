import { describe, expect, it } from 'vitest'
import { flattenHistoricalEvents } from '../flatten'

const makeNextId = () => {
  let n = 0
  return () => `u${n++}`
}

describe('flattenHistoricalEvents', () => {
  it('returns [] for empty input', () => {
    expect(flattenHistoricalEvents([], makeNextId())).toEqual([])
  })

  it('flattens a plain assistant text message', () => {
    const events = [
      { type: 'assistant', message: { id: 'msg1', content: [{ type: 'text', text: 'hi there' }] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out).toEqual([
      { kind: 'assistant', text: 'hi there', id: 'msg:msg1:0' }
    ])
  })

  it('drops thinking blocks', () => {
    const events = [
      { type: 'assistant', message: { id: 'm', content: [
        { type: 'thinking', thinking: 'secret' },
        { type: 'text', text: 'visible' }
      ] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'assistant', text: 'visible', id: 'msg:m:1' })
  })

  it('flattens tool_use with stable tool:<id> key', () => {
    const events = [
      { type: 'assistant', message: { id: 'm1', content: [
        { type: 'tool_use', id: 'tu_123', name: 'Bash', input: { command: 'ls' } }
      ] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out[0]).toEqual({
      kind: 'tool_call', name: 'Bash', input: { command: 'ls' }, id: 'tool:tu_123', toolUseId: 'tu_123'
    })
  })

  it('flattens plain user text (string content)', () => {
    const events = [{ type: 'user', message: { content: 'hello' } }]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out).toEqual([{ kind: 'user', text: 'hello', id: 'u0' }])
  })

  it('flattens user array content with text + tool_result', () => {
    const events = [{
      type: 'user',
      message: { content: [
        { type: 'text', text: 'continuing' },
        { type: 'tool_result', tool_use_id: 'tu_7', content: 'ok', is_error: false }
      ] }
    }]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out).toEqual([
      { kind: 'user', text: 'continuing', id: 'u0' },
      { kind: 'tool_result', toolUseId: 'tu_7', content: 'ok', isError: false, id: 'result:tu_7' }
    ])
  })

  it('joins array tool_result.content into newline-separated text', () => {
    const events = [{
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_9', content: [{ text: 'line1' }, { text: 'line2' }] }
      ] }
    }]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out[0]).toMatchObject({ kind: 'tool_result', content: 'line1\nline2' })
  })

  it('dedupes within a single call by derived id', () => {
    const events = [
      { type: 'assistant', message: { id: 'dup', content: [{ type: 'text', text: 'A' }] } },
      { type: 'assistant', message: { id: 'dup', content: [{ type: 'text', text: 'A' }] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out).toHaveLength(1)
  })

  it('skips malformed events (missing message / non-array content)', () => {
    const events = [
      { type: 'assistant', message: null },
      { type: 'assistant', message: { id: 'x', content: 'not-an-array' } },
      { type: 'system', subtype: 'init' },
      null,
      undefined
    ]
    expect(flattenHistoricalEvents(events as any[], makeNextId())).toEqual([])
  })

  it('preserves chronological order across multiple events', () => {
    const events = [
      { type: 'user', message: { content: 'first' } },
      { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'reply1' }] } },
      { type: 'user', message: { content: 'second' } },
      { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'reply2' }] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out.map(e => (e.kind === 'user' ? e.text : e.kind === 'assistant' ? e.text : null))).toEqual([
      'first', 'reply1', 'second', 'reply2'
    ])
  })

  it('handles tool_use without id by falling back to msg:<id>:<idx>', () => {
    const events = [
      { type: 'assistant', message: { id: 'm', content: [
        { type: 'tool_use', name: 'X', input: {} }  // no id
      ] } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    expect(out[0].id).toBe('msg:m:0')
  })

  it('collapses isCompactSummary user event into a compact_summary_hint (never renders the wall of prose)', () => {
    // Exact shape of the summary event claude writes post-/compact.
    const summary = 'This session is being continued from a previous conversation…\n\nread the full transcript at: /Users/x/.claude/projects/-x/abc.jsonl'
    const events = [
      { type: 'user', message: { content: 'real user turn 1' } },
      { type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'reply' }] } },
      { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: summary } },
      { type: 'user', message: { content: 'user turn AFTER compact' } }
    ]
    const out = flattenHistoricalEvents(events, makeNextId())
    // The wall-of-prose is NOT in any entry as user text.
    expect(out.some(e => e.kind === 'user' && (e as any).text.includes('This session is being continued'))).toBe(false)
    // Instead there's a compact_summary_hint carrying the path + length.
    const hint = out.find(e => e.kind === 'compact_summary_hint') as any
    expect(hint).toBeDefined()
    expect(hint.transcriptPath).toBe('/Users/x/.claude/projects/-x/abc.jsonl')
    expect(hint.summaryChars).toBe(summary.length)
    // The real user turns before/after are still there.
    expect(out.filter(e => e.kind === 'user').map((e: any) => e.text)).toEqual([
      'real user turn 1', 'user turn AFTER compact'
    ])
  })
})
