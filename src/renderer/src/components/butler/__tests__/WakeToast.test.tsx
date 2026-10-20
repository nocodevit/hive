// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { WakeToast } from '../WakeToast'

let emit: (ev: any) => void
const send = vi.fn(async () => ({ ok: true, to: 'Missy' }))
const dismiss = vi.fn(async () => ({ ok: true }))

beforeEach(() => {
  send.mockClear(); dismiss.mockClear()
  ;(globalThis as any).window.api = {
    wake: {
      state: vi.fn(async () => ({ enabled: true, status: 'listening' })),
      onEvent: vi.fn((cb: (ev: any) => void) => { emit = cb; return () => {} }),
      send, dismiss
    }
  }
})
afterEach(() => cleanup())

const row = { agentId: 'a1', agent: 'Missy', project: 'Cube v2' }

describe('WakeToast', () => {
  it('shows target and text; Send sends now', async () => {
    render(<WakeToast onOpenButler={() => {}} />)
    act(() => emit({ type: 'proposal', proposal: { id: 'p1', heard: '', plan: { kind: 'agent', row, text: '继续做 mobile e2e' } } }))
    expect(screen.getByText('→ Cube v2 / Missy')).toBeInTheDocument()
    expect(screen.getByText('继续做 mobile e2e')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(send).toHaveBeenCalledWith('p1', undefined)
    expect(await screen.findByText('✓ Sent → Missy')).toBeInTheDocument()
  })

  it('Esc cancels without sending', () => {
    render(<WakeToast onOpenButler={() => {}} />)
    act(() => emit({ type: 'proposal', proposal: { id: 'p1', heard: '', plan: { kind: 'agent', row, text: 'go' } } }))
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(screen.queryByText('go')).toBeNull()
    expect(dismiss).toHaveBeenCalledWith('p1')
    expect(send).not.toHaveBeenCalled()
  })

  it('ambiguous shows candidate chips; a pick sends to that agent', async () => {
    render(<WakeToast onOpenButler={() => {}} />)
    const other = { agentId: 'a3', agent: 'Missy', project: 'Mobile' }
    act(() => emit({ type: 'proposal', proposal: { id: 'p2', heard: '', plan: { kind: 'ambiguous', name: 'Missy', candidates: [row, other], text: 'go' } } }))
    expect(screen.getByText('Which Missy?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mobile / Missy' })) })
    expect(send).toHaveBeenCalledWith('p2', 'a3')
  })

  it('Butler not running offers Open Butler', () => {
    const open = vi.fn()
    render(<WakeToast onOpenButler={open} />)
    act(() => emit({ type: 'proposal', proposal: { id: 'p3', heard: '', plan: { kind: 'butler', live: false, text: '谁在跑' } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Butler' }))
    expect(open).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
