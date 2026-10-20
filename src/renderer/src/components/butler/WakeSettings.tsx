import { useEffect, useState } from 'react'

type WakeState = Awaited<ReturnType<typeof window.api.wake.state>>

const STATUS: Record<WakeState['status'], string> = { off: 'Off', starting: 'Starting…', listening: 'Listening', error: 'Not running' }

/** App Settings → Wake word: the switch for "Hola Butler" (main/wakeController.ts). */
export function WakeSettings() {
  const [state, setState] = useState<WakeState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.wake.state().then(s => { if (alive) setState(s) }).catch(() => {})
    const off = window.api.wake.onEvent(ev => { if (ev.type === 'state') setState(ev.state) })
    return () => { alive = false; off() }
  }, [])

  const enabled = state?.enabled ?? false
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try { setState(await window.api.wake.setEnabled(!enabled)) } finally { setBusy(false) }
  }

  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Wake word</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-primary">Listen for “Hola Butler”</span>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Listen for “Hola Butler”"
            disabled={!state || busy}
            onClick={toggle}
            className={`w-9 h-5 shrink-0 rounded-full cursor-pointer transition-colors relative disabled:opacity-50 ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        {state && enabled && (
          <div className="mt-1.5 text-[13px]" role="status">
            <span className={state.status === 'listening' ? 'text-accent' : state.status === 'error' ? 'text-red-400' : 'text-text-primary'}>{STATUS[state.status]}</span>
            {state.status === 'error' && state.error && <span className="text-text-muted"> · {state.error}</span>}
          </div>
        )}
        <details className="mt-1.5 text-[12px] text-text-muted">
          <summary className="cursor-pointer select-none">More</summary>
          <p className="mt-1">Wake word on this Mac · command → transcription</p>
        </details>
      </div>
    </div>
  )
}
