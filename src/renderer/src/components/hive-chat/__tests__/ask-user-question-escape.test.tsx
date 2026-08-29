// @vitest-environment jsdom
//
// v2.15.8 — AskUserQuestionInline must ALWAYS have a way out.
//
// User: 'AskUserQuestion --- 根本无法退出！！！选项不能选择的时候怎么办呢！！！'
//
// Root cause: interactive = !!ctx && !submitted. When ctx was null
// (control_request orphaned — claude died mid-question, or the card
// re-rendered from history replay after the request already resolved)
// every option button rendered disabled with no dismiss control. User
// stuck staring at frozen buttons.
//
// Two escape hatches now pinned by this test:
//   1. ✕ Dismiss button — always enabled, closes the card locally
//      (also sends empty answer if the request is still live so
//      claude moves on instead of hanging)
//   2. Free-text textarea — for the "none of these options fit"
//      case; user types + Enter (or Send text →) submits arbitrary
//      text as the answer (works only when interactive; canned
//      options remain the primary path)

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AskUserQuestionInline, AskUserQuestionContext } from '../renderers'

afterEach(() => cleanup())

const OPTS = {
  questions: [{
    question: 'Which fix approach?',
    header: 'FIX',
    options: [
      { label: 'A: rollback', description: 'safest' },
      { label: 'B: patch forward', description: 'faster' }
    ]
  }]
}

describe('AskUserQuestionInline — ✕ Dismiss escape hatch (v2.15.8)', () => {
  it('renders ✕ Dismiss even when ctx is null (orphaned request)', () => {
    // No provider = ctx is null = "request already resolved / claude died"
    render(<AskUserQuestionInline input={OPTS as any} />)
    const dismiss = screen.getByRole('button', { name: /✕ Dismiss/ })
    expect(dismiss).toBeInTheDocument()
    expect(dismiss).not.toBeDisabled()
  })

  it('clicking Dismiss while orphaned collapses the card (visual only, no submit call to make)', () => {
    render(<AskUserQuestionInline input={OPTS as any} />)
    fireEvent.click(screen.getByRole('button', { name: /✕ Dismiss/ }))
    // Card collapsed → the FIX header + option labels are gone
    expect(screen.queryByText('FIX')).not.toBeInTheDocument()
    expect(screen.queryByText(/A: rollback/)).not.toBeInTheDocument()
    // …but a small "dismissed" line remains with a restore control
    expect(screen.getByText(/dismissed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /↺ show/ })).toBeInTheDocument()
  })

  it('clicking Dismiss when interactive ALSO sends empty answer + closes', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    fireEvent.click(screen.getByRole('button', { name: /✕ Dismiss/ }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({})
    // Card collapsed too.
    expect(screen.queryByText('FIX')).not.toBeInTheDocument()
  })

  it('Dismiss survives a submit() that throws (ctx dead but ref still non-null)', () => {
    const submit = vi.fn(() => { throw new Error('channel closed') })
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    // Should not throw / crash. Just log-and-close.
    expect(() => fireEvent.click(screen.getByRole('button', { name: /✕ Dismiss/ }))).not.toThrow()
    expect(screen.queryByText('FIX')).not.toBeInTheDocument()
  })

  it('↺ show reopens after dismiss (recoverable — user changed mind)', () => {
    render(<AskUserQuestionInline input={OPTS as any} />)
    fireEvent.click(screen.getByRole('button', { name: /✕ Dismiss/ }))
    fireEvent.click(screen.getByRole('button', { name: /↺ show/ }))
    expect(screen.getByText('FIX')).toBeInTheDocument()
    expect(screen.getByText(/A: rollback/)).toBeInTheDocument()
  })
})

describe('AskUserQuestionInline — free-text escape hatch (v2.15.8)', () => {
  it('renders a free-text textarea when interactive + single-question', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    expect(screen.getByTestId('ask-user-question-freetext')).toBeInTheDocument()
  })

  it('does NOT render free-text when ctx is null (orphaned — nowhere to send)', () => {
    render(<AskUserQuestionInline input={OPTS as any} />)
    expect(screen.queryByTestId('ask-user-question-freetext')).not.toBeInTheDocument()
  })

  it('typing + clicking Send text → submits the typed answer', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    const ta = screen.getByTestId('ask-user-question-freetext')
    fireEvent.change(ta, { target: { value: 'C: hot-fix in staging first, then rollout' } })
    fireEvent.click(screen.getByRole('button', { name: /Send text/ }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({
      'Which fix approach?': 'C: hot-fix in staging first, then rollout'
    })
  })

  it('Enter (no shift) submits the typed answer', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    const ta = screen.getByTestId('ask-user-question-freetext')
    fireEvent.change(ta, { target: { value: 'my answer' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith({ 'Which fix approach?': 'my answer' })
  })

  it('Shift+Enter does NOT submit (newline behavior)', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    const ta = screen.getByTestId('ask-user-question-freetext')
    fireEvent.change(ta, { target: { value: 'my answer' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(submit).not.toHaveBeenCalled()
  })

  it('empty free-text does NOT submit (guard against accidental empty send)', () => {
    const submit = vi.fn()
    render(
      <AskUserQuestionContext.Provider value={{ submit }}>
        <AskUserQuestionInline input={OPTS as any} />
      </AskUserQuestionContext.Provider>
    )
    const ta = screen.getByTestId('ask-user-question-freetext')
    fireEvent.change(ta, { target: { value: '   ' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(submit).not.toHaveBeenCalled()
  })
})
