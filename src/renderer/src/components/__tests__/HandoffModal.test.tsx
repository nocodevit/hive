// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HandoffModal, { HANDOFF_PRESETS } from '../HandoffModal'

afterEach(() => cleanup())

const baseProps = {
  open: true,
  agentId: 'agent-abc',
  agentName: 'David',
  cwd: '/tmp/proj',
  onCancel: vi.fn(),
  onStarted: vi.fn()
}

beforeEach(() => {
  ;(window as any).api = {
    handoff: {
      start: vi.fn().mockResolvedValue({ ok: true, runId: 'hnd_xyz' })
    }
  }
})

describe('HandoffModal', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<HandoffModal {...baseProps} open={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows agent name in the title so user can\'t accidentally hand off to the wrong one', () => {
    render(<HandoffModal {...baseProps} />)
    expect(screen.getByText(/Hand off to David/)).toBeInTheDocument()
  })

  it('defaults to Normal rope (mid preset)', () => {
    render(<HandoffModal {...baseProps} />)
    // The selected rope button has purple bg (#6B50FF); assert Normal is selected by finding the aria-label / text pattern
    // Simpler: click Show advanced and read the numbers to confirm defaults are Normal preset
    fireEvent.click(screen.getByText(/Show advanced/))
    expect(screen.getByText(/max turns:/).textContent).toContain('60')
    expect(screen.getByText(/max cost:/).textContent).toContain('$5.00')
  })

  it('changes advanced numbers when a different rope is picked', () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.click(screen.getByText(/Show advanced/))
    fireEvent.click(screen.getByText(/Quick/))
    expect(screen.getByText(/max turns:/).textContent).toContain('15')
    expect(screen.getByText(/max cost:/).textContent).toContain('$1.00')
    fireEvent.click(screen.getByText(/Marathon/))
    expect(screen.getByText(/max turns:/).textContent).toContain('200')
    expect(screen.getByText(/max cost:/).textContent).toContain('$20.00')
  })

  it('Go button is disabled until goal is non-empty (whitespace does not count)', () => {
    render(<HandoffModal {...baseProps} />)
    const go = screen.getByRole('button', { name: /^Go$/ }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    const textarea = screen.getByPlaceholderText(/All tests in test\/auth/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '    \n\n   ' } })
    expect(go.disabled).toBe(true)
    fireEvent.change(textarea, { target: { value: 'do the thing' } })
    expect(go.disabled).toBe(false)
  })

  it('clicking Go invokes handoff.start with the current goal + rope + trimmed', async () => {
    const started = vi.fn()
    render(<HandoffModal {...baseProps} onStarted={started} />)
    const textarea = screen.getByPlaceholderText(/All tests in test\/auth/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '  do stuff  ' } })
    fireEvent.click(screen.getByText(/Quick/))
    fireEvent.click(screen.getByRole('button', { name: /^Go$/ }))
    // wait a tick for promise
    await new Promise(r => setTimeout(r, 10))
    expect((window as any).api.handoff.start).toHaveBeenCalledWith({
      agentId: 'agent-abc',
      cwd: '/tmp/proj',
      goal: 'do stuff',
      rope: 'quick'
    })
    expect(started).toHaveBeenCalledWith('hnd_xyz')
  })

  it('surfaces the supervisor error inline instead of silently swallowing it', async () => {
    ;(window as any).api.handoff.start = vi.fn().mockResolvedValue({ ok: false, error: 'agent already has a handoff running' })
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/All tests in test\/auth/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /^Go$/ }))
    await new Promise(r => setTimeout(r, 10))
    expect(screen.getByText(/agent already has a handoff running/)).toBeInTheDocument()
  })

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(<HandoffModal {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('HANDOFF_PRESETS is monotonic — quick < normal < marathon', () => {
    expect(HANDOFF_PRESETS[0].maxTurns).toBeLessThan(HANDOFF_PRESETS[1].maxTurns)
    expect(HANDOFF_PRESETS[1].maxTurns).toBeLessThan(HANDOFF_PRESETS[2].maxTurns)
  })
})
