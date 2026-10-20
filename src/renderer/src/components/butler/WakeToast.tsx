import { useEffect, useRef, useState } from 'react'
import { TOAST_NONE, countdownView, sendErrorLabel, toastStep, type ToastAction, type ToastEvent, type ToastState } from '../../lib/wake-toast'

type WakeApi = typeof window.api.wake
type WakeState = Awaited<ReturnType<WakeApi['state']>>

/** True while "Hola Butler" listening is on and the helper is running. */
export function useWakeListening(): boolean {
  const [s, setS] = useState<WakeState | null>(null)
  useEffect(() => {
    let alive = true
    window.api.wake.state().then(v => { if (alive) setS(v) }).catch(() => {})
    const off = window.api.wake.onEvent(ev => { if (ev.type === 'state') setS(ev.state) })
    return () => { alive = false; off() }
  }, [])
  return !!s?.enabled && s.status === 'listening'
}

const btn = 'px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer'
const chip = 'px-2.5 py-0.5 rounded-full bg-accent-subtle text-text-primary text-[12px] font-semibold cursor-pointer hover:bg-bg-hover'

/** Forward toast under the Butler button (mockup ④): where a spoken command goes, 3 s to cancel. */
export function WakeToast({ onOpenButler }: { onOpenButler: () => void }) {
  const [state, setState] = useState<ToastState>(TOAST_NONE)
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef(state)

  const run = (action: ToastAction) => {
    if (!action) return
    if (action.type === 'dismiss') { void window.api.wake.dismiss(action.id); return }
    void window.api.wake.send(action.id, action.agentId)
      .then(r => dispatch({ kind: 'result', ok: r.ok, message: r.ok ? `✓ Sent → ${r.to}` : `Not sent · ${sendErrorLabel(r.error)}`, now: Date.now() }))
      .catch(() => dispatch({ kind: 'result', ok: false, message: 'Not sent', now: Date.now() }))
  }
  const dispatch = (ev: ToastEvent) => {
    const { state: next, action } = toastStep(ref.current, ev)
    ref.current = next
    setState(next)
    run(action)
  }
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch

  useEffect(() => window.api.wake.onEvent(ev => {
    const d = dispatchRef.current
    if (ev.type === 'wake') d({ kind: 'wake' })
    else if (ev.type === 'timeout') d({ kind: 'timeout' })
    else if (ev.type === 'cancel') d({ kind: 'cancel' })
    else if (ev.type === 'proposal') d({ kind: 'proposal', id: ev.proposal.id, plan: ev.proposal.plan, now: Date.now() })
  }), [])

  const timed = (state.view === 'proposal' && state.deadline !== null) || state.view === 'result'
  useEffect(() => {
    if (!timed) return
    const t = setInterval(() => { const n = Date.now(); setNow(n); dispatchRef.current({ kind: 'tick', now: n }) }, 100)
    return () => clearInterval(t)
  }, [timed])

  const visible = state.view !== 'none'
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatchRef.current({ kind: 'cancel' }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (state.view === 'none') return null
  const cancel = <button onClick={() => dispatch({ kind: 'cancel' })} className={`${btn} bg-bg-primary text-text-primary`}>Cancel</button>
  const shell = (ring: React.ReactNode, body: React.ReactNode, actions: React.ReactNode) => (
    <div role="status" aria-label="Voice command"
      className="no-drag fixed z-50 top-[60px] right-4 w-[360px] hive-card shadow-e3 p-3 flex items-center gap-3">
      {ring}
      <div className="flex-1 min-w-0">{body}</div>
      {actions}
    </div>
  )
  const dot = (icon: string, pulse = false) => (
    <div className={`relative w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[14px] bg-accent-subtle`}>
      {icon}
      {pulse && <span className="absolute -inset-[3px] rounded-full border-2 border-red-500/45 animate-ping" />}
    </div>
  )

  if (state.view === 'listening') return shell(dot('🎙', true), <div className="text-[14px] font-semibold text-text-primary">Listening…</div>, cancel)
  if (state.view === 'result') return shell(dot(state.ok ? '✓' : '⚠'),
    <div className={`text-[13px] font-semibold ${state.ok ? 'text-text-primary' : 'text-red-400'}`}>{state.message}</div>, null)

  const { plan, deadline, sending } = state
  if (plan.kind === 'empty') return null
  const said = <div className="text-[14px] font-semibold text-text-primary truncate" title={plan.text}>{plan.text}</div>
  const to = (label: string, off = false) => <div className="text-[12px] font-bold text-accent truncate">→ {label}{off && <span className="text-text-muted font-semibold"> · off</span>}</div>

  if (plan.kind === 'agent' || (plan.kind === 'butler' && plan.live)) {
    const { secs, fraction } = countdownView(deadline, now)
    const ring = (
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ background: `conic-gradient(var(--accent) 0 ${fraction * 100}%, var(--bg-hover) ${fraction * 100}% 100%)` }}>
        <span className="w-[26px] h-[26px] rounded-full bg-bg-secondary text-[12px] font-bold text-accent flex items-center justify-center">{sending ? '…' : secs}</span>
      </div>
    )
    return shell(ring, <>{to(plan.kind === 'agent' ? `${plan.row.project} / ${plan.row.agent}` : 'Butler')}{said}</>,
      <>{cancel}<button disabled={sending} onClick={() => dispatch({ kind: 'sendNow' })} className={`${btn} bg-accent text-text-on-purple disabled:opacity-50`}>Send</button></>)
  }
  if (plan.kind === 'butler') return shell(dot('🎩'), <>{to('Butler', true)}{said}</>,
    <>{cancel}<button onClick={() => { dispatch({ kind: 'cancel' }); onOpenButler() }} className={`${btn} bg-accent text-text-on-purple`}>Open Butler</button></>)
  if (plan.kind === 'no_session') return shell(dot('💤'), <>{to(`${plan.row.project} / ${plan.row.agent}`, true)}{said}</>, cancel)

  // ambiguous / not_found: pick one of the exact-name candidates, or cancel.
  const title = plan.kind === 'ambiguous' ? `Which ${plan.name}?` : `No “${plan.project ? `${plan.project} / ` : ''}${plan.name}”`
  return shell(dot('❔'), (
    <>
      <div className="text-[12px] font-bold text-accent truncate">{title}</div>
      {said}
      {plan.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {plan.candidates.map(c => (
            <button key={c.agentId} disabled={sending} onClick={() => dispatch({ kind: 'pick', agentId: c.agentId })} className={chip}>
              {c.project || '—'} / {c.agent}
            </button>
          ))}
        </div>
      )}
    </>
  ), cancel)
}
