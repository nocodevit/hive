// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import HandoffBanner, { formatDuration } from '../HandoffBanner'

afterEach(() => cleanup())

let progressCb: ((s: any) => void) | null = null
let doneCb: ((s: any) => void) | null = null

beforeEach(() => {
  progressCb = null
  doneCb = null
  ;(window as any).api = {
    handoff: {
      list: vi.fn().mockResolvedValue([]),
      stop: vi.fn().mockResolvedValue({ ok: true }),
      onProgress: vi.fn((cb: any) => { progressCb = cb; return () => { progressCb = null } }),
      onDone: vi.fn((cb: any) => { doneCb = cb; return () => { doneCb = null } })
    }
  }
})

describe('HandoffBanner', () => {
  it('renders nothing when no active handoff for this agent', async () => {
    const { container } = render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    expect(container).toBeEmptyDOMElement()
  })

  it('hydrates from existing running handoff on mount', async () => {
    ;(window as any).api.handoff.list = vi.fn().mockResolvedValue([
      { runId: 'hnd_1', agentId: 'agent-1', status: 'running', turnCount: 3, totalCostUsd: 0.42, startedAt: Date.now(), elapsedMs: 0 }
    ])
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByText(/Handoff running/)).toBeInTheDocument()
    expect(screen.getByText(/turn 3/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument()
  })

  it('ignores progress events for OTHER agents', async () => {
    const { container } = render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      progressCb?.({ runId: 'hnd_x', agentId: 'agent-2', status: 'running', turnCount: 1, totalCostUsd: 0.1, startedAt: Date.now(), elapsedMs: 0 })
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows Stop button on running strip', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      progressCb?.({ runId: 'hnd_1', agentId: 'agent-1', status: 'running', turnCount: 2, totalCostUsd: 0.5, startedAt: Date.now(), elapsedMs: 0 })
    })
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeInTheDocument()
  })

  it('after handoff:done event, shows final card with the terminal status', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      progressCb?.({ runId: 'hnd_1', agentId: 'agent-1', status: 'running', turnCount: 5, totalCostUsd: 1.2, startedAt: Date.now() - 5000, elapsedMs: 5000 })
    })
    act(() => {
      doneCb?.({ runId: 'hnd_1', agentId: 'agent-1', status: 'done', turnCount: 7, totalCostUsd: 1.5, startedAt: Date.now() - 60_000, elapsedMs: 60_000 })
    })
    expect(screen.getByText(/Handoff done/)).toBeInTheDocument()
    expect(screen.getByText(/1m 0s/)).toBeInTheDocument()
    // Stop button gone
    expect(screen.queryByRole('button', { name: /^Stop$/ })).not.toBeInTheDocument()
  })

  it('shows stop reason on failed / stopped runs', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      doneCb?.({ runId: 'hnd_1', agentId: 'agent-1', status: 'stopped', turnCount: 12, totalCostUsd: 5.02, startedAt: Date.now() - 60_000, elapsedMs: 60_000, stopReason: 'hit cost cap $5.00 (spent $5.02)' })
    })
    expect(screen.getByText(/hit cost cap/)).toBeInTheDocument()
  })

  it('final card can be dismissed', async () => {
    render(<HandoffBanner agentId="agent-1" />)
    await new Promise(r => setTimeout(r, 5))
    act(() => {
      doneCb?.({ runId: 'hnd_1', agentId: 'agent-1', status: 'done', turnCount: 3, totalCostUsd: 0.1, startedAt: Date.now(), elapsedMs: 1000 })
    })
    expect(screen.getByText(/Handoff done/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^✕$/ }))
    expect(screen.queryByText(/Handoff done/)).not.toBeInTheDocument()
  })
})

describe('formatDuration', () => {
  it('under 1m shows seconds', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(0)).toBe('0s')
  })
  it('under 1h shows m s', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(59 * 60 * 1000 + 12_000)).toBe('59m 12s')
  })
  it('over 1h shows h m only (no seconds)', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m')
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe('3h 0m')
  })
  it('clamps negatives to 0s', () => {
    expect(formatDuration(-5000)).toBe('0s')
  })
})
