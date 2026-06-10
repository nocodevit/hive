// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'

import { StartChooser, SessionPickerInline, ContextModal, CrushTooltip, chooserKeyMode } from '../index'

/**
 * Minimal window.api mock. Each test calls `setApi(overrides)` to swap
 * specific endpoints. Anything unused throws so accidental reliance
 * surfaces as a test failure (vs. silently returning undefined).
 */
const fail = (name: string) => () => { throw new Error(`window.api.chat.${name} not stubbed`) }
function setApi(overrides: Partial<any> = {}) {
  ;(globalThis as any).window.api = {
    chat: {
      start: fail('start'),
      getRecentSessions: fail('getRecentSessions'),
      getPrevSessionInfo: fail('getPrevSessionInfo'),
      compact: fail('compact'),
      scrapeContext: fail('scrapeContext'),
      ...overrides
    }
  }
}

const aSession = (overrides: Partial<any> = {}) => ({
  sid: 'aaaaaaaa-1111-1111-1111-111111111111',
  model: 'claude-opus-4-7',
  contextSize: '1M',
  peakInputTokens: 220_000,
  lastActiveMs: Date.now() - 5 * 60_000,
  ...overrides
})

const aRecentRow = (i: number, overrides: Partial<any> = {}) => ({
  sid: `${i}eadbeef-1111-1111-1111-${i.toString().padStart(12, '0')}`,
  title: `session ${i} title`,
  preview: `last reply ${i}`,
  lastActiveMs: Date.now() - i * 60_000,
  ctxPct: 20 + i * 5,
  totalTokens: 200_000 + i * 10_000,
  ...overrides
})

beforeEach(() => { setApi() })
afterEach(() => { cleanup() })

describe('StartChooser button highlight', () => {
  it('clicking Compact+Resume moves green border off Resume onto Compact+Resume', async () => {
    setApi({
      getRecentSessions: vi.fn(async () => [aRecentRow(1), aRecentRow(2)])
    })
    const onPick = vi.fn()
    render(
      <StartChooser
        cwd="/Users/x/test"
        loaded={true}
        info={aSession()}
        onPick={onPick}
      />
    )

    // Initial: smart-default highlights Resume (ctx 22% < 80% so default is resume)
    const resumeBtn = screen.getByRole('button', { name: /↻\s*Resume/ })
    const compactBtn = screen.getByRole('button', { name: /⎙\s*Compact \+ Resume/ })

    // Resume has 2px Bok border initially. JSDOM serializes the Crush
    // hex (#68FFD6) as rgb(104, 255, 214) — compare against normalized.
    expect(resumeBtn.style.borderWidth).toMatch(/2px/)
    expect(resumeBtn.style.borderColor).toBe('rgb(104, 255, 214)')

    // Click Compact+Resume → opens picker → highlight should move
    fireEvent.click(compactBtn)
    await waitFor(() => expect(screen.getByText(/Pick a session to/)).toBeInTheDocument())

    // Now Compact+Resume should have the 2px border, Resume should NOT
    expect(compactBtn.style.borderWidth).toMatch(/2px/)
    expect(compactBtn.style.borderColor).toBe('rgb(107, 80, 255)')  // Charple
    expect(resumeBtn.style.borderWidth).not.toMatch(/2px/)
  })

  it('Start new bypasses picker and calls onPick directly', async () => {
    const onPick = vi.fn()
    render(<StartChooser cwd="/x" loaded={true} info={aSession()} onPick={onPick} />)

    fireEvent.click(screen.getByRole('button', { name: /✦\s*Start new/ }))
    expect(onPick).toHaveBeenCalledWith('new')
    // Picker not rendered for Start new
    expect(screen.queryByText(/Pick a session to/)).not.toBeInTheDocument()
  })
})

describe('chooserKeyMode — digit-3 swallow regression', () => {
  // Bug: backgrounded chat panels stay mounted; their StartChooser window
  // keydown listener swallowed '3' (→ 'new', the only mode with no !hasPrev
  // guard), forcing the user to press '3' once per lingering background
  // chooser before it would type into the focused panel's textarea.

  it('inactive panel ignores ALL keys (3 included) so they reach the textarea', () => {
    for (const key of ['Enter', '1', '2', '3', '4']) {
      expect(chooserKeyMode(key, false, false, 'new')).toBeNull()
      expect(chooserKeyMode(key, false, true, 'resume')).toBeNull()
    }
  })

  it('active panel with no prior session only consumes 3 (→ new); 1/2/4 pass through', () => {
    expect(chooserKeyMode('1', true, false, 'new')).toBeNull() // resume needs prev
    expect(chooserKeyMode('2', true, false, 'new')).toBeNull() // compact needs prev
    expect(chooserKeyMode('3', true, false, 'new')).toBe('new')
    expect(chooserKeyMode('4', true, false, 'new')).toBeNull() // fork needs prev
  })

  it('active panel with a prior session maps every digit to its mode', () => {
    expect(chooserKeyMode('1', true, true, 'resume')).toBe('resume')
    expect(chooserKeyMode('2', true, true, 'resume')).toBe('compact-resume')
    expect(chooserKeyMode('3', true, true, 'resume')).toBe('new')
    expect(chooserKeyMode('4', true, true, 'resume')).toBe('fork')
  })

  it('Enter picks the smart default; non-digit keys fall through', () => {
    expect(chooserKeyMode('Enter', true, true, 'compact-resume')).toBe('compact-resume')
    expect(chooserKeyMode('Enter', true, false, 'new')).toBe('new')
    expect(chooserKeyMode('a', true, true, 'resume')).toBeNull()
    expect(chooserKeyMode('5', true, true, 'resume')).toBeNull()
  })
})

describe('StartChooser active guard (live window listener)', () => {
  it('active=false: pressing 3 on window does NOT launch a session', () => {
    const onPick = vi.fn()
    render(<StartChooser cwd="/x" loaded={true} info={null} onPick={onPick} active={false} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('active=true (default): pressing 3 launches new session', () => {
    const onPick = vi.fn()
    render(<StartChooser cwd="/x" loaded={true} info={null} onPick={onPick} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onPick).toHaveBeenCalledWith('new')
  })
})

describe('SessionPickerInline open / close', () => {
  const sessions = [aRecentRow(1), aRecentRow(2), aRecentRow(3)]

  it('renders all sessions and shows confirm with selected sid', () => {
    render(
      <SessionPickerInline
        action="resume"
        sessions={sessions}
        loading={false}
        selectedSid={sessions[0].sid}
        onSelect={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(sessions[0].title)).toBeInTheDocument()
    expect(screen.getByText(sessions[1].title)).toBeInTheDocument()
    expect(screen.getByText(sessions[2].title)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /↻\s*Resume\s+1eadbeef/ })).toBeInTheDocument()
  })

  it('clicking Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <SessionPickerInline
        action="resume" sessions={sessions} loading={false}
        selectedSid={sessions[0].sid}
        onSelect={() => {}} onConfirm={() => {}} onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Confirm fires onConfirm with selected sid in label', () => {
    const onConfirm = vi.fn()
    render(
      <SessionPickerInline
        action="compact-resume" sessions={sessions} loading={false}
        selectedSid={sessions[1].sid}
        onSelect={() => {}} onConfirm={onConfirm} onCancel={() => {}}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /⎙\s*Compact \+ Resume\s+2eadbeef/ }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('clicking ✕ in header also closes', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <SessionPickerInline
        action="fork" sessions={sessions} loading={false}
        selectedSid={sessions[0].sid}
        onSelect={() => {}} onConfirm={() => {}} onCancel={onCancel}
      />
    )
    const close = Array.from(container.querySelectorAll('span'))
      .find(el => el.textContent === '✕')
    expect(close).toBeTruthy()
    fireEvent.click(close!)
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('CrushTooltip', () => {
  it('hides by default; shows after 250ms hover; hides on mouseleave', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <CrushTooltip text="run /compact">
          <button>⎙</button>
        </CrushTooltip>
      )

      expect(screen.queryByText('run /compact')).not.toBeInTheDocument()

      // mouseEnter on the wrapper span (the trigger), not the inner button
      const wrapper = container.firstElementChild as HTMLElement
      act(() => { fireEvent.mouseEnter(wrapper) })
      expect(screen.queryByText('run /compact')).not.toBeInTheDocument() // not yet
      act(() => { vi.advanceTimersByTime(260) })
      expect(screen.queryByText('run /compact')).toBeInTheDocument()

      act(() => { fireEvent.mouseLeave(wrapper) })
      expect(screen.queryByText('run /compact')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ContextModal close paths', () => {
  it('Esc closes', () => {
    const onClose = vi.fn()
    render(
      <ContextModal
        loading={false}
        error={null}
        data={null}
        claudeSid="abcdef12-1111-1111-1111-111111111111"
        onRefresh={() => {}}
        onClose={onClose}
      />
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the header ✕ button calls onClose', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ContextModal
        loading={false}
        error={null}
        data={null}
        claudeSid="abcdef12-1111-1111-1111-111111111111"
        onRefresh={() => {}}
        onClose={onClose}
      />
    )
    // Header ✕ is the first button rendered (modal-head close).
    const closeBtn = within(container).getAllByRole('button')
      .find(b => b.textContent === '✕')!
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the footer Close button also calls onClose', () => {
    const onClose = vi.fn()
    render(
      <ContextModal
        loading={false}
        error={null}
        data={null}
        claudeSid="abcdef12-1111-1111-1111-111111111111"
        onRefresh={() => {}}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
