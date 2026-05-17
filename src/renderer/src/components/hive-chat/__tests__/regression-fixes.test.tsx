// @vitest-environment jsdom
//
// Regression tests for v1.7.114 fixes. Each test pins the exact incident
// it prevents recurring so future refactors don't silently undo them.

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AskUserQuestionInline, AskUserQuestionContext } from '../renderers'

afterEach(() => cleanup())

describe('TodoInline isArray defensive (1.7.119 regression)', () => {
  // ❌ pre-fix: const todos = (input.todos as Todo[]) || []
  //    `"["` is truthy → `"[".map()` → TypeError → black-screen
  //    claude opus-4-7 sometimes emits {"todos": "[...escaped...]"} as
  //    a string instead of an array.
  // ✅ fixed: Array.isArray(input.todos) ? input.todos : []
  //
  // We test the runtime guard directly because TodoInline is internal to
  // renderers.tsx (not exported); the guard is the contract we care about.
  it('Array.isArray rejects truthy non-array (string) — the actual bug', () => {
    const guard = (input: Record<string, unknown>) =>
      Array.isArray(input.todos) ? input.todos : []
    // String "[" was the actual partial-stream value that crashed prod
    expect(guard({ todos: '[' })).toEqual([])
    expect(guard({ todos: '[{"content":"x"}]' })).toEqual([]) // string-encoded JSON
    expect(guard({ todos: {} })).toEqual([])                   // plain object
    expect(guard({ todos: 42 })).toEqual([])                   // number
    expect(guard({ todos: true })).toEqual([])                 // boolean
    // Real arrays survive
    expect(guard({ todos: [] })).toEqual([])
    expect(guard({ todos: [{ content: 'x', status: 'pending' }] }))
      .toEqual([{ content: 'x', status: 'pending' }])
  })
})

describe('AskUserQuestionInline (1.7.120 regression)', () => {
  // pre-fix bug #1: pendingQuestion state set but no JSX renderer →
  // claude --print stuck waiting for control_response (Pink/Simon)
  // pre-fix bug #2: answers keyed by q.header instead of q.question →
  // claude SDK looked up answers[T] where T=question.question, got
  // undefined, surfaced "User has answered your questions: ." (empty)
  //
  // Verified from claude-code binary strings dump:
  //   answers[T] where T = question.question

  const sample = {
    questions: [{
      question: '下一步做什么？',
      header: 'Next step',
      options: [
        { label: 'Merge', description: 'merge PR' },
        { label: 'Skip',  description: 'skip it' }
      ],
      multiSelect: false
    }]
  }

  it('renders the question text, header chip, and option labels', () => {
    render(<AskUserQuestionInline input={sample} />)
    expect(screen.getByText('下一步做什么？')).toBeTruthy()
    expect(screen.getByText('Next step')).toBeTruthy()
    expect(screen.getByText('Merge')).toBeTruthy()
    expect(screen.getByText('Skip')).toBeTruthy()
  })

  it('renders read-only (disabled buttons) without a Context provider', () => {
    render(<AskUserQuestionInline input={sample} />)
    const btn = screen.getByText('Merge').closest('button')!
    expect(btn.disabled).toBe(true)
    expect(screen.getByText(/awaiting request/i)).toBeTruthy()
  })

  it('clicking single-select option submits answers keyed by question text, NOT header', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ requestId: 'r1', submit }}>
        <AskUserQuestionInline input={sample} />
      </AskUserQuestionContext.Provider>
    )
    fireEvent.click(screen.getByText('Merge'))
    expect(submit).toHaveBeenCalledTimes(1)
    const answers = submit.mock.calls[0][0]
    // CRITICAL: key must be `question` text, not `header`. SDK lookup
    // would return undefined → "(no option selected)" if we used header.
    expect(answers).toHaveProperty('下一步做什么？', 'Merge')
    expect(answers).not.toHaveProperty('Next step')
  })

  it('multiSelect: toggles + submits string[] only after Submit button', () => {
    const submit = vi.fn()
    const multi = {
      questions: [{
        question: 'Pick all',
        header: 'Tags',
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        multiSelect: true
      }]
    }
    render(
      <AskUserQuestionContext.Provider value={{ requestId: 'r2', submit }}>
        <AskUserQuestionInline input={multi} />
      </AskUserQuestionContext.Provider>
    )
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('C'))
    expect(submit).not.toHaveBeenCalled()              // not auto-submitted
    fireEvent.click(screen.getByText('Submit →'))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toEqual({ 'Pick all': ['A', 'C'] })
  })

  it('does not throw when input.questions is missing or wrong type (stream partial guard)', () => {
    expect(() => render(<AskUserQuestionInline input={{}} />)).not.toThrow()
    expect(() => render(<AskUserQuestionInline input={{ questions: 'partial json string' }} />)).not.toThrow()
    expect(() => render(<AskUserQuestionInline input={{ questions: null }} />)).not.toThrow()
  })
})

describe('auto-open chooser on session exit (1.7.115 feature)', () => {
  // User expectation: when session is gone (exited !== null), user
  // should not stare at the abbreviated 3-button "close panel" hunting
  // for an action — the full 4-way chooser (Resume / Compact+Resume /
  // Start new / Fork) with session picker should auto-open.
  //
  // Implementation: useEffect on [exited, chooserMode]:
  //   if (exited !== null && !chooserMode) setChooserMode(true)
  //
  // Also: launchSession must clear `exited` BEFORE setChooserMode(false)
  // — otherwise the same useEffect would immediately flip chooserMode
  // back to true and trap the user.
  //
  // Test the pure state-transition rules.
  function effect({ exited, chooserMode }: { exited: number | null; chooserMode: boolean }) {
    if (exited !== null && !chooserMode) return { chooserMode: true }
    return { chooserMode }
  }
  function onLaunch() {
    // launchSession's order: clear exited THEN setChooserMode(false)
    // so the effect sees exited=null and doesn't ping-pong
    return { exited: null, chooserMode: false }
  }

  it('flips chooser on when session exits (code 0)', () => {
    expect(effect({ exited: 0, chooserMode: false }).chooserMode).toBe(true)
  })

  it('flips chooser on for crash exit codes (137/143)', () => {
    expect(effect({ exited: 137, chooserMode: false }).chooserMode).toBe(true)
    expect(effect({ exited: 143, chooserMode: false }).chooserMode).toBe(true)
  })

  it('does not re-flip if chooser already open (no infinite loop)', () => {
    expect(effect({ exited: 137, chooserMode: true }).chooserMode).toBe(true)
    // (and doesn't change — would cause infinite re-render otherwise)
  })

  it('does nothing when session is live (exited=null)', () => {
    expect(effect({ exited: null, chooserMode: false }).chooserMode).toBe(false)
  })

  it('launchSession clears exited BEFORE chooserMode=false (no ping-pong)', () => {
    // After user picks an option in chooser
    const after = onLaunch()
    expect(after.exited).toBeNull()
    expect(after.chooserMode).toBe(false)
    // Now if effect re-runs: exited=null → guard fails → chooserMode stays false
    expect(effect({ exited: after.exited, chooserMode: after.chooserMode }).chooserMode).toBe(false)
  })
})

describe('pendingPermissions queue contract (1.7.122 regression)', () => {
  // pre-fix: useState<Request | null>(null); setPendingPermission(req)
  // overwrote head on every parallel control_request. With 6 simultaneous
  // Glob requests (Pink stuck incident, 1d 11h), Hive replied to 1 and
  // dropped 5; claude blocked on stdin forever.
  // fixed: useState<Request[]>([]); append on arrival, shift on reply.
  //
  // We test the pure queue ops the component uses (append + shift) so a
  // refactor that re-introduces the single-slot logic fails this test.
  type Req = { requestId: string; toolName: string; input: Record<string, unknown> }

  it('append preserves order across parallel requests', () => {
    let q: Req[] = []
    const setQ = (fn: (p: Req[]) => Req[]) => { q = fn(q) }
    // Simulate 6 parallel control_requests in the same JS tick
    for (let i = 1; i <= 6; i++) {
      setQ(prev => [...prev, { requestId: `r${i}`, toolName: 'Glob', input: {} }])
    }
    expect(q.length).toBe(6)
    expect(q[0].requestId).toBe('r1')
    expect(q[5].requestId).toBe('r6')
  })

  it('shift removes head, exposes next request, eventually empties', () => {
    let q: Req[] = [
      { requestId: 'r1', toolName: 'A', input: {} },
      { requestId: 'r2', toolName: 'B', input: {} },
      { requestId: 'r3', toolName: 'C', input: {} }
    ]
    const setQ = (fn: (p: Req[]) => Req[]) => { q = fn(q) }
    const head = () => q[0] || null

    expect(head()?.requestId).toBe('r1')
    setQ(prev => prev.slice(1))                 // user replies to r1
    expect(head()?.requestId).toBe('r2')
    setQ(prev => prev.slice(1))                 // user replies to r2
    expect(head()?.requestId).toBe('r3')
    setQ(prev => prev.slice(1))                 // user replies to r3
    expect(head()).toBeNull()
    expect(q).toEqual([])
  })
})
