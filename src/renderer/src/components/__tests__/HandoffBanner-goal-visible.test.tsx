// @vitest-environment jsdom
//
// v2.15.5 — the running handoff banner MUST show the user's goal(s).
//
// User complaint: 'handoff running 的 detail 应该 show, goal 我输入的内容,
// 不然我忘了'. Long-running /goal loops (hour-plus) killed the user's
// ability to remember what they asked for; the banner just showed
// timer/cost/turn and no goal echo, so users had to hunt through the
// chat history.
//
// This test pins two invariants:
//   1. The FIRST goal (or truncated multi-goal preview) shows INLINE
//      on the running strip (no click needed) — the "🎯 <goal>" span.
//   2. The ⓘ expand box shows ALL goals in full, unwrapped.

import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import HandoffBanner from '../HandoffBanner'

afterEach(() => cleanup())

let progressCb: ((s: any) => void) | null = null

beforeEach(() => {
  progressCb = null
  ;(window as any).api = {
    handoff: {
      list: vi.fn().mockResolvedValue([]),
      stop: vi.fn().mockResolvedValue({ ok: true }),
      onProgress: vi.fn((cb: any) => { progressCb = cb; return () => { progressCb = null } }),
      onDone: vi.fn(() => () => {})
    }
  }
})

const baseState = (goals: string[] | undefined) => ({
  runId: 'hnd_g1',
  agentId: 'agent-1',
  status: 'running' as const,
  turnCount: 5,
  totalCostUsd: 1.23,
  startedAt: Date.now(),
  elapsedMs: 60_000,
  goals
})

describe('HandoffBanner running-strip goal echo (v2.15.5)', () => {
  it('shows the single-goal text INLINE with 🎯 prefix', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState(['refactor auth middleware to use JWT']))
    })
    const inline = screen.getByTestId('handoff-goal-inline')
    expect(inline).toBeInTheDocument()
    expect(inline.textContent).toMatch(/refactor auth middleware to use JWT/)
    expect(inline.textContent).toContain('🎯')
  })

  it('shows "first goal (+N more)" INLINE when multiple goals', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState([
        'fix login regression',
        'add e2e for reset flow',
        'update changelog'
      ]))
    })
    const inline = screen.getByTestId('handoff-goal-inline')
    expect(inline.textContent).toMatch(/fix login regression/)
    expect(inline.textContent).toMatch(/\+2 more/)
  })

  it('shows nothing goal-related when goals array is empty (backwards compat)', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState([]))
    })
    // No goal chip — banner still renders the meters/status normally.
    expect(screen.queryByTestId('handoff-goal-inline')).not.toBeInTheDocument()
    expect(screen.getByText(/Handoff running/)).toBeInTheDocument()
  })

  it('shows nothing goal-related when goals field is undefined (backwards compat)', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState(undefined))
    })
    expect(screen.queryByTestId('handoff-goal-inline')).not.toBeInTheDocument()
    expect(screen.getByText(/Handoff running/)).toBeInTheDocument()
  })

  it('ⓘ expand shows ALL goals in full (numbered when >1)', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState([
        'goal one full text',
        'goal two full text',
        'goal three full text'
      ]))
    })
    // Click ⓘ to expand.
    fireEvent.click(screen.getByTitle(/Show meta/i))
    const full = screen.getByTestId('handoff-goal-full')
    expect(full).toBeInTheDocument()
    expect(full.textContent).toMatch(/1\.\s*goal one full text/)
    expect(full.textContent).toMatch(/2\.\s*goal two full text/)
    expect(full.textContent).toMatch(/3\.\s*goal three full text/)
    expect(full.textContent).toMatch(/goals \(3\):/)
  })

  it('ⓘ expand omits numbering when single goal (cleaner)', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise((r) => setTimeout(r, 5))
    act(() => {
      progressCb?.(baseState(['just one goal']))
    })
    fireEvent.click(screen.getByTitle(/Show meta/i))
    const full = screen.getByTestId('handoff-goal-full')
    expect(full.textContent).toMatch(/^goal:/)
    expect(full.textContent).not.toMatch(/^1\./)
  })
})
