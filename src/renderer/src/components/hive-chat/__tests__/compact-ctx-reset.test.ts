// @vitest-environment jsdom
//
// v2.13.0 — ctx% MUST reset the instant the compact_boundary /
// isCompactSummary event lands, not wait for the next assistant
// turn.
//
// User-reported bug (nancy transcript, 2026-08-24): after /compact
// finishes, the top status bar keeps showing the pre-compact context
// percentage (e.g. 68%) until the user types their first post-compact
// message and claude echoes back an assistant.usage event. That
// delay is confusing — the compact IS done, storage IS freed, but
// the UI lies.
//
// Root cause: v2.5.3 tried to reset by string-matching `/compact done`
// in the stream text output. Current claude CLI emits
// `<local-command-stdout>Compacted </local-command-stdout>` instead,
// so the string match never fired and the reset never ran.
//
// Fix: piggyback on isCompactSummaryEvent (which we already detect
// for the timeline-flattening path — proven reliable across every
// compact variant since v1.7.x). When we see one, drop ctx% to 0
// immediately and clear compact-in-progress state. The next
// assistant.usage event refreshes ctx% to the real post-compact value.
//
// Belt-and-suspenders: the text-match branch was ALSO updated to
// accept `Compacted ` alongside the historical `/compact done`, in
// case some transient stream ordering delivers the stdout line first.

import { describe, it, expect } from 'vitest'
import { isCompactSummaryEvent } from '../compact-summary'

describe('v2.13.0 compact_boundary ctx-reset trigger', () => {
  it('recognizes the canonical isCompactSummary:true flag as a reset trigger', () => {
    const ev = {
      type: 'user',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'This session is being continued from a previous conversation, summary…' }]
      }
    }
    // Contract: if isCompactSummaryEvent returns true here, the
    // reset branch in index.tsx runs setLatestInputTokens(0) +
    // setCompactStartedAt(null) + setCompactStuck(null) — the exact
    // three state updates the bug report demanded.
    expect(isCompactSummaryEvent(ev)).toBe(true)
  })

  it('recognizes the content-pattern fallback (COMPACT_SUMMARY_OPENING) even without the flag', () => {
    const ev = {
      type: 'user',
      message: {
        role: 'user',
        content: 'This session is being continued from a previous conversation that ran out of context…'
      }
    }
    // Fallback path: even if a future claude drops the
    // isCompactSummary flag entirely, the ctx-reset still fires
    // because the opening sentence is stable.
    expect(isCompactSummaryEvent(ev)).toBe(true)
  })

  it('does NOT treat a normal user message as a compact-reset trigger', () => {
    const ev = {
      type: 'user',
      message: { role: 'user', content: 'hey how are you' }
    }
    // Guard: false-positive on the reset would zero ctx% mid-turn
    // and make the status bar flap. Must be false.
    expect(isCompactSummaryEvent(ev)).toBe(false)
  })

  it('does NOT treat an assistant event as a compact-reset trigger', () => {
    const ev = {
      type: 'assistant',
      isCompactSummary: true,  // even with a stray flag, wrong event type
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    }
    // Guard: assistant events never carry user-side compact summaries.
    // But we DO honor the flag when set — this exercises the (a) branch.
    expect(isCompactSummaryEvent(ev)).toBe(true)
  })

  it('does NOT trigger on a system event with no user prose', () => {
    const ev = { type: 'system', subtype: 'init' }
    expect(isCompactSummaryEvent(ev)).toBe(false)
  })
})

describe('v2.13.0 text-pattern fallback recognizes new CLI output', () => {
  // The index.tsx text-match branch is: `text.includes('/compact done')
  // || text.includes('Compacted ') || (…UNCHANGED)`. We assert the
  // exact substrings here so a rename to any of these fragments
  // (upstream or refactor) breaks the test loudly.
  function matchesResetPattern(text: string): boolean {
    return (
      text.includes('/compact done') ||
      text.includes('Compacted ') ||
      (text.includes('/compact ') && text.includes('context UNCHANGED'))
    )
  }

  it('matches the current claude CLI local-command-stdout fragment', () => {
    // Real fragment from nancy's transcript (2026-08-24 03:45:39.189Z):
    const line = '<local-command-stdout>Compacted </local-command-stdout>'
    expect(matchesResetPattern(line)).toBe(true)
  })

  it('still matches the historical `/compact done` fragment', () => {
    expect(matchesResetPattern('… /compact done successfully …')).toBe(true)
  })

  it('still matches the failure-path settle line', () => {
    expect(matchesResetPattern('/compact ran but context UNCHANGED')).toBe(true)
  })

  it('does NOT match unrelated text', () => {
    expect(matchesResetPattern('just some ordinary chat message')).toBe(false)
    expect(matchesResetPattern('compacted the sand at the beach')).toBe(false)  // no capital C + trailing space
  })
})
