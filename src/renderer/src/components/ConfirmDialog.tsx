// v2.15.9 — themed confirm dialog. Replaces every `window.confirm()` /
// `confirm()` call in the renderer so destructive actions get an in-app
// modal matching the style guide (bg-secondary + border + shadow-e3
// tokens, just like Modal.tsx / MarkdownPreviewModal / etc), NOT the
// macOS system dialog. User report 2026-08-29: 'stop 又用了系统弹窗,
// 而不是应用自己 style guide 规定的弹窗'.
//
// Not a wrapper around Modal.tsx — this is stripped-down (title +
// message + two buttons, no children), keyboard-first (Enter =
// confirm, Esc = cancel), and awaitable so callers stay linear:
//   if (!(await confirm(...))) return
//
// Renders through a singleton React root so any component can call
// `confirm(...)` without threading state through props.

import { useEffect, useState, useCallback } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface ConfirmOptions {
  title: string
  /** Body text. Kept as a single string — no rich content (that's what
   * Modal.tsx is for). Multi-line via \n rendered with white-space:pre-wrap. */
  message: string
  /** Confirm button label. Default 'Confirm'. */
  confirmLabel?: string
  /** Cancel button label. Default 'Cancel'. */
  cancelLabel?: string
  /** True → confirm button rendered as destructive (red). Default true;
   * pass false for benign confirms. */
  destructive?: boolean
}

interface DialogProps extends ConfirmOptions {
  onResolve: (choice: boolean) => void
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onResolve
}: DialogProps) {
  const [open, setOpen] = useState(true)
  const close = useCallback((choice: boolean) => {
    setOpen(false)
    onResolve(choice)
  }, [onResolve])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      // Enter only fires confirm if focus isn't inside a text input —
      // avoids accidental submits when the calling context has one.
      if (e.key === 'Enter' && !(document.activeElement instanceof HTMLTextAreaElement)) {
        e.preventDefault(); close(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!open) return null
  const confirmClass = destructive
    ? 'bg-status-danger text-text-on-purple hover:opacity-90'
    : 'bg-accent text-text-on-purple hover:bg-accent-hover'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => close(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-bg-secondary border border-border rounded-2xl shadow-e3 w-[420px] max-w-[92vw]"
      >
        <div className="px-6 pt-5 pb-3">
          <h2
            id="confirm-dialog-title"
            className="font-heading font-semibold text-base text-text-primary"
          >{title}</h2>
        </div>
        <div className="px-6 pb-5">
          <p
            className="text-sm text-text-muted"
            style={{ whiteSpace: 'pre-wrap' }}
          >{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button
            data-testid="confirm-cancel"
            onClick={() => close(false)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-text-primary
              border border-border hover:bg-bg-hover transition-colors cursor-pointer"
          >{cancelLabel}</button>
          <button
            data-testid="confirm-ok"
            onClick={() => close(true)}
            autoFocus
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-colors ${confirmClass}`}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- Singleton mount ----------

let rootRef: Root | null = null
let hostRef: HTMLDivElement | null = null

function ensureHost(): { root: Root; host: HTMLDivElement } {
  // Also check the host is still connected — tests (or a future
  // hot-reload path) may remove it out from under us. Re-create then.
  if (rootRef && hostRef && hostRef.isConnected) return { root: rootRef, host: hostRef }
  const host = document.createElement('div')
  host.setAttribute('data-confirm-dialog-host', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  rootRef = root
  hostRef = host
  return { root, host }
}

/**
 * Awaitable themed confirm. Resolves true on OK / Enter, false on
 * Cancel / Esc / backdrop click. Serializes if called back-to-back —
 * subsequent callers wait on the current dialog's promise before
 * their own dialog mounts.
 */
let pending: Promise<boolean> = Promise.resolve(true)
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const next = pending.then(() => new Promise<boolean>((resolve) => {
    const { root } = ensureHost()
    const onResolve = (choice: boolean) => {
      root.render(<></>)
      resolve(choice)
    }
    root.render(<ConfirmDialog {...opts} onResolve={onResolve} />)
  }))
  pending = next.then(() => true, () => true)  // reset chain state regardless
  return next
}
