import { useEffect, useState } from 'react'

type ButlerState = {
  enabled: boolean
  status: 'off' | 'starting' | 'needs_trust' | 'connected' | 'error'
  url?: string
  error?: string
}

const STATUS_TEXT: Record<ButlerState['status'], string> = {
  off: 'Off',
  starting: 'Connecting…',
  needs_trust: 'Waiting for your OK',
  connected: 'Connected',
  error: 'Not running'
}

/** Settings → Remote control: the one switch for the built-in Butler (main/butler.ts). */
export function ButlerSettings() {
  const [state, setState] = useState<ButlerState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.butler.state().then(s => { if (alive) setState(s) })
    const off = window.api.butler.onState(s => setState(s))
    return () => { alive = false; off() }
  }, [])

  const enabled = state?.enabled ?? false
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try { setState(await window.api.butler.setEnabled(!enabled)) } finally { setBusy(false) }
  }

  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Remote Control</label>
      <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
        <div className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-primary">Allow remote control from my phone (Butler)</span>
            <button
              role="switch"
              aria-checked={enabled}
              aria-label="Allow remote control from my phone (Butler)"
              disabled={!state || busy}
              onClick={toggle}
              className={`w-9 h-5 shrink-0 rounded-full cursor-pointer transition-colors relative disabled:opacity-50 ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
          {state && enabled && (
            <div className="mt-2 text-[13px]" role="status">
              <span className="text-text-muted">Status: </span>
              <span className={state.status === 'connected' ? 'text-accent' : state.status === 'error' ? 'text-red-400' : 'text-text-primary'}>
                {STATUS_TEXT[state.status]}
              </span>
              {state.status === 'connected' && (
                <p className="mt-1 text-text-muted">
                  On your phone, open the Claude app → Code and tap “Hive Butler”.
                </p>
              )}
              {state.status === 'needs_trust' && (
                <div className="mt-1.5">
                  <p className="text-text-muted">
                    Claude Code asks whether it may run in Hive’s Butler folder. It only runs Hive’s own <code>./hive</code> commands there.
                  </p>
                  <button
                    onClick={() => window.api.butler.confirmTrust()}
                    className="mt-1.5 px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[13px] cursor-pointer"
                  >Trust and continue</button>
                </div>
              )}
              {state.status === 'error' && (
                <div className="mt-1.5">
                  <pre className="whitespace-pre-wrap text-[12px] text-text-muted font-mono">{state.error}</pre>
                  <button
                    onClick={async () => setState(await window.api.butler.retry())}
                    className="mt-1.5 px-3 py-1 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] cursor-pointer"
                  >Try again</button>
                </div>
              )}
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-text-muted">
            Off by default. When on, Hive keeps a Claude Code session called “Hive Butler” running on this Mac with Remote Control, signed in with your Claude account. From the phone it can list agents, read their chats and send a message to the agent you name — nothing else. Turning it off stops the session.
          </p>
        </div>
      </div>
    </div>
  )
}
