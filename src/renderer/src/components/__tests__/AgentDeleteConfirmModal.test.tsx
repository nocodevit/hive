// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AgentDeleteConfirmModal, { AgentDeleteImpact } from '../AgentDeleteConfirmModal'

afterEach(() => cleanup())

const impact: AgentDeleteImpact = {
  hasActiveTerminal: false,
  worktreePath: '/Users/x/proj-david',
  worktreeBranch: 'hive/david-918872',
  definitionCwd: '/Users/x/proj-david'
}

describe('AgentDeleteConfirmModal', () => {
  it('renders the agent name in the title so mis-clicks are unambiguous', () => {
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/Delete agent "David"\?/)).toBeInTheDocument()
  })

  it('lists the exact worktree path so users know what disappears', () => {
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/git worktree remove \/Users\/x\/proj-david/)).toBeInTheDocument()
  })

  it('lists the branch name and marks the remote unaffected', () => {
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/hive\/david-918872/)).toBeInTheDocument()
    expect(screen.getByText(/remote is unaffected/)).toBeInTheDocument()
  })

  it('reassures users that chat logs are preserved (they historically survive agent deletion)', () => {
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/Chat logs.*are kept/i)).toBeInTheDocument()
  })

  it('Cancel button is autoFocused so pressing Enter after a mis-click does NOT delete', () => {
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('Cancel fires onCancel and NOT onConfirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Delete permanently fires onConfirm exactly once', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Escape key routes to Cancel (never Confirm)', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('backdrop click routes to Cancel (via Modal.onClose)', () => {
    const onCancel = vi.fn()
    render(<AgentDeleteConfirmModal agentName="David" impact={impact}
      onCancel={onCancel} onConfirm={vi.fn()} />)
    // Modal's backdrop is the absolute overlay div — first child of the fixed container.
    const backdrop = document.querySelector('.absolute.inset-0.bg-black\\/50')!
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('hides "Kill terminal" line when no session is running (nothing to kill)', () => {
    render(<AgentDeleteConfirmModal agentName="David"
      impact={{ ...impact, hasActiveTerminal: false }}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.queryByText(/Kill the running terminal/i)).not.toBeInTheDocument()
  })

  it('shows "Kill terminal" line when a session IS running', () => {
    render(<AgentDeleteConfirmModal agentName="David"
      impact={{ ...impact, hasActiveTerminal: true }}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByText(/Kill the running terminal/i)).toBeInTheDocument()
  })

  it('hides worktree lines for agents that have no worktree (e.g. non-coding role)', () => {
    render(<AgentDeleteConfirmModal agentName="David"
      impact={{ hasActiveTerminal: false, definitionCwd: '/Users/x/proj' }}
      onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.queryByText(/git worktree remove/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Delete local branch/)).not.toBeInTheDocument()
  })
})
