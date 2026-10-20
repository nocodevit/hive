// Wake word forward toast — the decision logic. The toast under the Butler
// button shows where a spoken command will go; a ready, single, running
// target is sent after a 3-second countdown unless cancelled. Timers and
// IPC live in components/butler/WakeToast.tsx.

export const WAKE_COUNTDOWN_MS = 3000
const RESULT_OK_MS = 1500
const RESULT_ERROR_MS = 4000

type Row = { agentId: string; agent: string; project: string }
export type Plan =
  | { kind: 'agent'; row: Row; text: string }
  | { kind: 'no_session'; row: Row; text: string }
  | { kind: 'ambiguous'; name: string; project?: string; candidates: Row[]; text: string }
  | { kind: 'not_found'; name: string; project?: string; candidates: Row[]; text: string }
  | { kind: 'butler'; live: boolean; text: string }
  | { kind: 'empty' }

export type ToastState =
  | { view: 'none' }
  | { view: 'listening' }
  | { view: 'proposal'; id: string; plan: Plan; deadline: number | null; sending: boolean }
  | { view: 'result'; ok: boolean; message: string; until: number }

export type ToastEvent =
  | { kind: 'wake' }
  | { kind: 'timeout' }
  | { kind: 'proposal'; id: string; plan: Plan; now: number }
  | { kind: 'tick'; now: number }
  | { kind: 'cancel' }        // Cancel button, Esc, or "cancel / 取消" said
  | { kind: 'sendNow' }
  | { kind: 'pick'; agentId: string }
  | { kind: 'result'; ok: boolean; message: string; now: number }

export type ToastAction = { type: 'send'; id: string; agentId?: string } | { type: 'dismiss'; id: string } | null

export const TOAST_NONE: ToastState = { view: 'none' }

/** Only a single, running target counts down; everything else waits for a click. */
export function countsDown(plan: Plan): boolean {
  return plan.kind === 'agent' || (plan.kind === 'butler' && plan.live)
}

export function toastStep(s: ToastState, ev: ToastEvent): { state: ToastState; action: ToastAction } {
  const keep = { state: s, action: null }
  switch (ev.kind) {
    case 'wake':
      // "Hola Butler" again while a proposal is up: start over.
      if (s.view === 'proposal' && !s.sending) return { state: { view: 'listening' }, action: { type: 'dismiss', id: s.id } }
      return s.view === 'proposal' ? keep : { state: { view: 'listening' }, action: null }
    case 'timeout':
      return s.view === 'listening' ? { state: TOAST_NONE, action: null } : keep
    case 'proposal':
      if (ev.plan.kind === 'empty') return { state: { view: 'result', ok: false, message: 'Didn’t catch that', until: ev.now + RESULT_ERROR_MS }, action: null }
      return {
        state: { view: 'proposal', id: ev.id, plan: ev.plan, deadline: countsDown(ev.plan) ? ev.now + WAKE_COUNTDOWN_MS : null, sending: false },
        action: null
      }
    case 'tick':
      if (s.view === 'proposal' && !s.sending && s.deadline !== null && ev.now >= s.deadline) {
        return { state: { ...s, deadline: null, sending: true }, action: { type: 'send', id: s.id } }
      }
      if (s.view === 'result' && ev.now >= s.until) return { state: TOAST_NONE, action: null }
      return keep
    case 'cancel':
      if (s.view === 'proposal' && !s.sending) return { state: TOAST_NONE, action: { type: 'dismiss', id: s.id } }
      return s.view === 'listening' ? { state: TOAST_NONE, action: null } : keep
    case 'sendNow':
      if (s.view !== 'proposal' || s.sending || !countsDown(s.plan)) return keep
      return { state: { ...s, deadline: null, sending: true }, action: { type: 'send', id: s.id } }
    case 'pick': {
      if (s.view !== 'proposal' || s.sending) return keep
      const p = s.plan
      if ((p.kind !== 'ambiguous' && p.kind !== 'not_found') || !p.candidates.some(c => c.agentId === ev.agentId)) return keep
      return { state: { ...s, deadline: null, sending: true }, action: { type: 'send', id: s.id, agentId: ev.agentId } }
    }
    case 'result':
      if (s.view !== 'proposal') return keep
      return { state: { view: 'result', ok: ev.ok, message: ev.message, until: ev.now + (ev.ok ? RESULT_OK_MS : RESULT_ERROR_MS) }, action: null }
  }
}

/** Whole seconds left on the countdown (3, 2, 1), and the ring's filled fraction. */
export function countdownView(deadline: number | null, now: number): { secs: number; fraction: number } {
  if (deadline === null) return { secs: 0, fraction: 0 }
  const left = Math.max(0, deadline - now)
  return { secs: Math.ceil(left / 1000), fraction: Math.min(1, left / WAKE_COUNTDOWN_MS) }
}

const ERRORS: Record<string, string> = {
  no_session: 'chat not running',
  not_a_candidate: 'pick an agent',
  unknown_proposal: 'expired',
  not_found: 'agent gone'
}
export function sendErrorLabel(error: string): string {
  return ERRORS[error] ?? error
}
