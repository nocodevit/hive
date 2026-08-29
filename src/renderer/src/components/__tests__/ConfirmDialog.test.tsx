// @vitest-environment jsdom
//
// v2.15.9 — themed confirm dialog replaces window.confirm() everywhere.
// User: '你他妈的！点击 stop 你他妈又用了系统弹窗, 而不是应用自己
// style guide 规定的弹窗'. Native macOS confirm bypasses the app's
// design tokens (bg-secondary / border / shadow-e3) and breaks the
// Crush-palette feel.

import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { confirmDialog } from '../ConfirmDialog'

// The dialog mounts through a singleton document.body host — tear it
// down between tests so nothing leaks across cases.
afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-confirm-dialog-host]').forEach((el) => el.remove())
})

describe('confirmDialog — awaitable + themed', () => {
  it('renders with the given title, message, and button labels', async () => {
    const p = confirmDialog({
      title: 'Stop this handoff?',
      message: 'Claude will get SIGTERM immediately.',
      confirmLabel: 'Stop handoff',
      cancelLabel: 'Keep running'
    })
    // The dialog mounts asynchronously (chained via Promise.then).
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Stop this handoff?')).toBeInTheDocument()
    expect(screen.getByText(/SIGTERM/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stop handoff/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Keep running/ })).toBeInTheDocument()

    // Resolve the promise so afterEach can clean up.
    fireEvent.click(screen.getByRole('button', { name: /Keep running/ }))
    await expect(p).resolves.toBe(false)
  })

  it('resolves true on confirm click', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByTestId('confirm-ok'))
    await expect(p).resolves.toBe(true)
  })

  it('resolves false on cancel click', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    await expect(p).resolves.toBe(false)
  })

  it('resolves false on Escape key', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.keyDown(window, { key: 'Escape' })
    await expect(p).resolves.toBe(false)
  })

  it('resolves true on Enter key', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.keyDown(window, { key: 'Enter' })
    await expect(p).resolves.toBe(true)
  })

  it('resolves false on backdrop click', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    // Backdrop is the first div inside the fixed overlay — has
    // `bg-black/50` class name and onClick handler.
    const backdrop = document.querySelector('.bg-black\\/50')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)
    await expect(p).resolves.toBe(false)
  })

  it('confirm button is styled as destructive (danger) by default', async () => {
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    const ok = screen.getByTestId('confirm-ok')
    expect(ok.className).toMatch(/bg-status-danger/)
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    await expect(p).resolves.toBe(false)
  })

  it('destructive:false renders confirm as accent (non-danger)', async () => {
    const p = confirmDialog({ title: 't', message: 'm', destructive: false })
    await new Promise((r) => setTimeout(r, 0))
    const ok = screen.getByTestId('confirm-ok')
    expect(ok.className).toMatch(/bg-accent/)
    expect(ok.className).not.toMatch(/bg-status-danger/)
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    await expect(p).resolves.toBe(false)
  })

  it('back-to-back calls SERIALIZE (second waits for first to resolve)', async () => {
    // If two dialogs mounted at once through the shared root, the second
    // would overwrite the first mid-flight and the first promise would
    // hang forever. Pending chain ensures they queue.
    const p1 = confirmDialog({ title: 'first', message: 'x' })
    const p2 = confirmDialog({ title: 'second', message: 'y' })

    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.queryByText('second')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('confirm-ok'))
    await expect(p1).resolves.toBe(true)

    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('second')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    await expect(p2).resolves.toBe(false)
  })

  it('uses the app palette tokens (bg-secondary + border) — NOT native OS colors', async () => {
    // Guardrail: the whole point of this component is style-guide
    // compliance. If someone refactors to inline colors, this test
    // catches the regression.
    const p = confirmDialog({ title: 't', message: 'm' })
    await new Promise((r) => setTimeout(r, 0))
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/bg-bg-secondary/)
    expect(dialog.className).toMatch(/border-border/)
    expect(dialog.className).toMatch(/shadow-e3/)
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    await expect(p).resolves.toBe(false)
  })
})
