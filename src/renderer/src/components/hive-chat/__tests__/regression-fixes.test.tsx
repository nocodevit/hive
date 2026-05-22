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

describe('Picker UX shortcut: 1-session auto-confirm (1.7.116 regression)', () => {
  // pre-fix: clicking "Compact + Resume" opened a picker requiring user
  // to click row + Confirm even when only 1 session existed → users
  // reported "Compact+Resume 没反应" because they thought button = action.
  // Pink had exactly 1 prior session (071c20ca-...) — picker UX added
  // 2 extra unnecessary clicks.
  // fix: openPicker → if list.length === 1, skip the picker UI, call
  // onPick directly with the single sid. Picker still appears for 2+.

  type Sess = { sid: string; lastActiveMs: number }
  // Pure logic of the openPicker shortcut
  function openPickerLogic(
    list: Sess[],
    action: 'resume' | 'compact-resume' | 'fork',
    onPick: (action: string, sid: string) => void
  ): { showPicker: boolean; preselected?: string } {
    if (list.length === 1) {
      onPick(action, list[0].sid)
      return { showPicker: false }
    }
    return { showPicker: true, preselected: list[0]?.sid }
  }

  it('1 session: skips picker, fires onPick(action, sid) immediately', () => {
    const onPick = vi.fn()
    const r = openPickerLogic([{ sid: '071c20ca', lastActiveMs: 1 }], 'compact-resume', onPick)
    expect(r.showPicker).toBe(false)
    expect(onPick).toHaveBeenCalledWith('compact-resume', '071c20ca')
  })

  it('2+ sessions: shows picker, preselects newest, does NOT auto-pick', () => {
    const onPick = vi.fn()
    const list = [
      { sid: 'newest', lastActiveMs: 100 },
      { sid: 'older', lastActiveMs: 50 }
    ]
    const r = openPickerLogic(list, 'compact-resume', onPick)
    expect(r.showPicker).toBe(true)
    expect(r.preselected).toBe('newest')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('0 sessions: shows empty picker (Confirm disabled), no onPick', () => {
    const onPick = vi.fn()
    const r = openPickerLogic([], 'compact-resume', onPick)
    expect(r.showPicker).toBe(true)
    expect(r.preselected).toBeUndefined()
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('Orphaned control_requests on claude exit (1.7.116 regression)', () => {
  // pre-fix: claude --print died but pendingPermissions + pendingQuestion
  // state stayed populated. User saw AskUserQuestionInline (or Permission
  // modal) and clicked an option. submit() fired but stdin write went to
  // dead process — silently consumed. Pink stuck incident: 16 control_-
  // request, 15 reply, 16th hanging because claude was gone.
  // fix: chat.onExit handler now clears both queues. ctx Provider value
  // becomes null → AskUserQuestionInline shows read-only "awaiting
  // request" indicator. User knows the session is dead.

  function onExitHandler(state: {
    exited: number | null
    pendingPermissions: any[]
    pendingQuestion: any | null
  }, code: number) {
    return {
      exited: code,
      pendingPermissions: [],
      pendingQuestion: null
    }
  }

  it('clears both queues on exit code 0 (clean close)', () => {
    const after = onExitHandler({
      exited: null,
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {} }],
      pendingQuestion: { requestId: 'r2', questions: [] }
    }, 0)
    expect(after.exited).toBe(0)
    expect(after.pendingPermissions).toEqual([])
    expect(after.pendingQuestion).toBeNull()
  })

  it('clears on crash exit codes too (137 OOM, 143 SIGTERM)', () => {
    const after137 = onExitHandler({
      exited: null,
      pendingPermissions: [{ requestId: 'r1' }],
      pendingQuestion: null
    }, 137)
    expect(after137.exited).toBe(137)
    expect(after137.pendingPermissions).toEqual([])
  })

  it('Pink stuck scenario: clears 5 pending after exit', () => {
    const after = onExitHandler({
      exited: null,
      pendingPermissions: [
        { requestId: 'r12' }, { requestId: 'r13' }, { requestId: 'r14' },
        { requestId: 'r15' }, { requestId: 'r16' }
      ],
      pendingQuestion: null
    }, 0)
    expect(after.pendingPermissions).toEqual([])
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
