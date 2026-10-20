import { describe, it, expect } from 'vitest'
import { TOAST_NONE, WAKE_COUNTDOWN_MS, countdownView, countsDown, toastStep, type Plan, type ToastEvent, type ToastState } from '../wake-toast'

const row = { agentId: 'a1', agent: 'Missy', project: 'Cube v2' }
const AGENT: Plan = { kind: 'agent', row, text: '继续' }
const AMBIG: Plan = { kind: 'ambiguous', name: 'Missy', candidates: [row, { agentId: 'a3', agent: 'Missy', project: 'Mobile' }], text: 'go' }

function play(events: ToastEvent[], from: ToastState = TOAST_NONE) {
  let s = from
  const actions: unknown[] = []
  for (const ev of events) {
    const r = toastStep(s, ev)
    s = r.state
    if (r.action) actions.push(r.action)
  }
  return { s, actions }
}

describe('wake toast', () => {
  it('counts down only for a single running target', () => {
    expect(countsDown(AGENT)).toBe(true)
    expect(countsDown({ kind: 'butler', live: true, text: 'x' })).toBe(true)
    expect(countsDown({ kind: 'butler', live: false, text: 'x' })).toBe(false)
    expect(countsDown({ kind: 'no_session', row, text: 'x' })).toBe(false)
    expect(countsDown(AMBIG)).toBe(false)
  })

  it('wake → listening → proposal → sends once when 3 s are up', () => {
    const { s, actions } = play([
      { kind: 'wake' },
      { kind: 'proposal', id: 'p1', plan: AGENT, now: 1000 },
      { kind: 'tick', now: 2000 },
      { kind: 'tick', now: 1000 + WAKE_COUNTDOWN_MS },
      { kind: 'tick', now: 5000 }
    ])
    expect(actions).toEqual([{ type: 'send', id: 'p1' }])
    expect(s).toMatchObject({ view: 'proposal', sending: true })
  })

  it('cancel before the deadline: nothing is sent, the proposal is dismissed', () => {
    const { s, actions } = play([
      { kind: 'proposal', id: 'p1', plan: AGENT, now: 0 },
      { kind: 'tick', now: 2900 },
      { kind: 'cancel' },
      { kind: 'tick', now: 4000 }
    ])
    expect(actions).toEqual([{ type: 'dismiss', id: 'p1' }])
    expect(s).toEqual(TOAST_NONE)
  })

  it('cancel after sending started does nothing', () => {
    const { actions } = play([
      { kind: 'proposal', id: 'p1', plan: AGENT, now: 0 },
      { kind: 'sendNow' },
      { kind: 'cancel' }
    ])
    expect(actions).toEqual([{ type: 'send', id: 'p1' }])
  })

  it('Send = now, and only once', () => {
    const { actions } = play([
      { kind: 'proposal', id: 'p1', plan: AGENT, now: 0 },
      { kind: 'sendNow' },
      { kind: 'sendNow' },
      { kind: 'tick', now: 9999 }
    ])
    expect(actions).toEqual([{ type: 'send', id: 'p1' }])
  })

  it('ambiguous never counts down; a picked candidate is sent, others refused', () => {
    const { actions } = play([
      { kind: 'proposal', id: 'p1', plan: AMBIG, now: 0 },
      { kind: 'tick', now: 60_000 },
      { kind: 'sendNow' },
      { kind: 'pick', agentId: 'zz' },
      { kind: 'pick', agentId: 'a3' }
    ])
    expect(actions).toEqual([{ type: 'send', id: 'p1', agentId: 'a3' }])
  })

  it('no_session waits for Cancel', () => {
    const { s, actions } = play([
      { kind: 'proposal', id: 'p1', plan: { kind: 'no_session', row, text: 'x' }, now: 0 },
      { kind: 'tick', now: 60_000 },
      { kind: 'sendNow' }
    ])
    expect(actions).toEqual([])
    expect(s).toMatchObject({ view: 'proposal', deadline: null })
  })

  it('saying "Hola Butler" again replaces the proposal', () => {
    const { s, actions } = play([{ kind: 'proposal', id: 'p1', plan: AGENT, now: 0 }, { kind: 'wake' }, { kind: 'tick', now: 5000 }])
    expect(actions).toEqual([{ type: 'dismiss', id: 'p1' }])
    expect(s).toEqual({ view: 'listening' })
  })

  it('listening closes on timeout or cancel', () => {
    expect(play([{ kind: 'wake' }, { kind: 'timeout' }]).s).toEqual(TOAST_NONE)
    expect(play([{ kind: 'wake' }, { kind: 'cancel' }]).s).toEqual(TOAST_NONE)
  })

  it('shows the result briefly, then closes', () => {
    const { s } = play([
      { kind: 'proposal', id: 'p1', plan: AGENT, now: 0 },
      { kind: 'sendNow' },
      { kind: 'result', ok: true, message: '✓ Sent → Missy', now: 100 }
    ])
    expect(s).toMatchObject({ view: 'result', ok: true })
    expect(toastStep(s, { kind: 'tick', now: 1000 }).state).toBe(s)
    expect(toastStep(s, { kind: 'tick', now: 2000 }).state).toEqual(TOAST_NONE)
  })

  it('an empty command shows "Didn’t catch that"', () => {
    expect(play([{ kind: 'proposal', id: 'p1', plan: { kind: 'empty' }, now: 0 }]).s).toMatchObject({ view: 'result', ok: false })
  })

  it('countdown view: 3, 2, 1 and the ring fraction', () => {
    expect(countdownView(3000, 0)).toEqual({ secs: 3, fraction: 1 })
    expect(countdownView(3000, 1500)).toEqual({ secs: 2, fraction: 0.5 })
    expect(countdownView(3000, 2999).secs).toBe(1)
    expect(countdownView(3000, 4000)).toEqual({ secs: 0, fraction: 0 })
    expect(countdownView(null, 0)).toEqual({ secs: 0, fraction: 0 })
  })
})
