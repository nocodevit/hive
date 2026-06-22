import { describe, expect, it } from 'vitest'
import { dismissActionForAuthState, type AuthModalState } from '../renderers'

describe('dismissActionForAuthState', () => {
  it('returns null for idle (nothing to dismiss)', () => {
    expect(dismissActionForAuthState('idle')).toBeNull()
  })

  it('EVERY non-idle state is dismissable (the trap-the-user regression)', () => {
    // This is the core invariant: the sign-in modal must never strand the
    // user. 'in-progress' used to render only text with no button — Escape /
    // Cancel now route through this helper for every non-idle state.
    const nonIdle: AuthModalState[] = ['needed', 'in-progress', 'success', 'failed']
    for (const s of nonIdle) {
      expect(dismissActionForAuthState(s)).not.toBeNull()
    }
  })

  it('kills the hung child ONLY for in-progress', () => {
    // in-progress has a live `claude auth login` that must be SIGTERM'd; the
    // other states have no running child, so killing would be a no-op/wrong.
    expect(dismissActionForAuthState('in-progress')).toEqual({ killProcess: true })
    expect(dismissActionForAuthState('needed')).toEqual({ killProcess: false })
    expect(dismissActionForAuthState('failed')).toEqual({ killProcess: false })
    expect(dismissActionForAuthState('success')).toEqual({ killProcess: false })
  })
})
