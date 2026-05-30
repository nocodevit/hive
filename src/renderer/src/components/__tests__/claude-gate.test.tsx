// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import ClaudeGate from '../ClaudeGate'

const CMD = 'curl -fsSL https://claude.ai/install.sh | bash'

function setApi(overrides: Partial<any> = {}) {
  ;(globalThis as any).window.api = {
    claude: {
      install: vi.fn(async () => ({ ok: true })),
      onInstallOutput: vi.fn(() => () => {}),
      ...overrides
    }
  }
  // jsdom has no clipboard by default
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
}

beforeEach(() => setApi())
afterEach(() => cleanup())

describe('ClaudeGate', () => {
  it('shows the install command and the not-found message', () => {
    render(<ClaudeGate installCommand={CMD} onReady={() => {}} />)
    expect(screen.getByText(/Claude Code CLI not found/)).toBeInTheDocument()
    expect(screen.getByText(CMD)).toBeInTheDocument()
  })

  it('Copy writes the command to the clipboard', () => {
    render(<ClaudeGate installCommand={CMD} onReady={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CMD)
  })

  it('Continue anyway calls onReady immediately', () => {
    const onReady = vi.fn()
    render(<ClaudeGate installCommand={CMD} onReady={onReady} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }))
    expect(onReady).toHaveBeenCalled()
  })

  it('Install for me → success calls onReady', async () => {
    const onReady = vi.fn()
    setApi({ install: vi.fn(async () => ({ ok: true })) })
    render(<ClaudeGate installCommand={CMD} onReady={onReady} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install for me' }))
    await waitFor(() => expect(onReady).toHaveBeenCalled())
  })

  it('Install for me → failure shows the still-not-runnable hint, does NOT call onReady', async () => {
    const onReady = vi.fn()
    setApi({ install: vi.fn(async () => ({ ok: false })) })
    render(<ClaudeGate installCommand={CMD} onReady={onReady} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install for me' }))
    await waitFor(() =>
      expect(screen.getByText(/still isn't runnable/)).toBeInTheDocument()
    )
    expect(onReady).not.toHaveBeenCalled()
  })

  it('streams install output into the log', async () => {
    let emit: (d: { kind: 'stdout' | 'stderr'; text: string }) => void = () => {}
    setApi({
      onInstallOutput: vi.fn((cb: any) => { emit = cb; return () => {} }),
      install: vi.fn(
        () =>
          new Promise((resolve) => {
            emit({ kind: 'stdout', text: 'downloading installer…' })
            resolve({ ok: true })
          })
      )
    })
    render(<ClaudeGate installCommand={CMD} onReady={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install for me' }))
    await waitFor(() =>
      expect(screen.getByText(/downloading installer…/)).toBeInTheDocument()
    )
  })
})
