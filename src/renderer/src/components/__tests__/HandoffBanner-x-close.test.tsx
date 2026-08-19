// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import HandoffBanner from '../HandoffBanner'

/**
 * v2.2.5 regression: user reported "Handoff stopped 的时候 x 根本关不上呀".
 * Root cause was FinalCard's leftside container had `flex: 1` but no
 * `min-width: 0`, so a long stopReason (e.g. cost-cap detail message)
 * expanded the row past the parent width and pushed the ✕ button
 * off-screen. Fix: leftside gets min-width:0, stopReason gets
 * overflow:hidden + text-overflow:ellipsis + white-space:nowrap, and
 * the ✕ button gets flex-shrink:0 so it can't be squeezed either way.
 */

afterEach(() => cleanup())

let doneCb: ((s: any) => void) | null = null

beforeEach(() => {
  doneCb = null
  ;(window as any).api = {
    handoff: {
      list: vi.fn().mockResolvedValue([]),
      stop: vi.fn().mockResolvedValue({ ok: true }),
      onProgress: vi.fn(() => () => {}),
      onDone: vi.fn((cb: any) => { doneCb = cb; return () => { doneCb = null } })
    }
  }
})

describe('HandoffBanner ✕ close (v2.2.5 fix)', () => {
  it('dismiss button is present and clickable even when stopReason is very long', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))

    // Fire a stopped event with a realistically long reason.
    const longReason = 'hit cost cap $5.00 (spent $5.02) — evaluator kept voting no because agent did not explicitly report per-item verification for items 3, 4, 5, 6, 7'
    act(() => {
      doneCb?.({
        runId: 'hnd_1',
        agentId: 'agent-1',
        status: 'stopped',
        turnCount: 60,
        totalCostUsd: 5.02,
        startedAt: Date.now() - 3600_000,
        elapsedMs: 3600_000,
        stopReason: longReason
      })
    })

    const dismiss = screen.getByRole('button', { name: /Dismiss handoff summary/i })
    expect(dismiss).toBeInTheDocument()

    // Click it — final card should disappear.
    fireEvent.click(dismiss)
    expect(screen.queryByText(/Handoff stopped/)).not.toBeInTheDocument()
  })

  it('the button has flex-shrink:0 so a long stopReason can NEVER push it off-screen', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      doneCb?.({
        runId: 'hnd_1', agentId: 'agent-1', status: 'done',
        turnCount: 3, totalCostUsd: 0.5,
        startedAt: Date.now() - 1000, elapsedMs: 1000
      })
    })
    const dismiss = screen.getByRole('button', { name: /Dismiss handoff summary/i })
    // The style attr must include the flex-shrink guarantee.
    const styleStr = dismiss.getAttribute('style') || ''
    expect(styleStr).toMatch(/flex-shrink:\s*0/)
  })

  it('has an accessible aria-label so screen readers + tests can find it', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      doneCb?.({
        runId: 'hnd_1', agentId: 'agent-1', status: 'done',
        turnCount: 1, totalCostUsd: 0.1,
        startedAt: Date.now(), elapsedMs: 500
      })
    })
    expect(screen.getByLabelText(/Dismiss handoff summary/i)).toBeInTheDocument()
  })
})
