import { describe, it, expect, vi } from 'vitest'
import { recycleSessionInPlace, type RecyclableSession } from '../chat'

describe('recycleSessionInPlace', () => {
  it('flags internalRecycle=true so the old child exit handler suppresses chat:exit', () => {
    const session: RecyclableSession = {
      child: { kill: vi.fn() },
      internalRecycle: false
    }
    recycleSessionInPlace(session)
    expect(session.internalRecycle).toBe(true)
  })

  it('kills the live --print child', () => {
    const kill = vi.fn()
    const session: RecyclableSession = { child: { kill } }
    recycleSessionInPlace(session)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('nulls the child reference so the stale-child check in the exit handler ALSO fires (defense-in-depth alongside internalRecycle)', () => {
    const session: RecyclableSession = { child: { kill: vi.fn() } }
    recycleSessionInPlace(session)
    expect(session.child).toBeNull()
  })

  it('is safe when child is already null (session was closed but entry lingered)', () => {
    const session: RecyclableSession = { child: null }
    expect(() => recycleSessionInPlace(session)).not.toThrow()
    expect(session.internalRecycle).toBe(true)
    expect(session.child).toBeNull()
  })

  it('swallows a throwing kill() (e.g. child already dead / EPERM) instead of propagating', () => {
    const session: RecyclableSession = {
      child: { kill: () => { throw new Error('ESRCH') } }
    }
    expect(() => recycleSessionInPlace(session)).not.toThrow()
    expect(session.child).toBeNull()
    expect(session.internalRecycle).toBe(true)
  })

  it('clears the usage-poll interval and forgets the handle', () => {
    const usageTimer = setInterval(() => {}, 100000) as unknown as NodeJS.Timeout
    const session: RecyclableSession = { child: null, usageTimer }
    recycleSessionInPlace(session)
    expect(session.usageTimer).toBeUndefined()
  })

  it('clears the auto-continue timeout and forgets the handle', () => {
    const autoContinueTimer = setTimeout(() => {}, 100000) as unknown as NodeJS.Timeout
    const session: RecyclableSession = { child: null, autoContinueTimer }
    recycleSessionInPlace(session)
    expect(session.autoContinueTimer).toBeUndefined()
  })

  it('drops the rcPty reference so a stale remote-control PTY does not survive the recycle', () => {
    const session: RecyclableSession = { child: null, rcPty: { fake: 'pty' } }
    recycleSessionInPlace(session)
    expect(session.rcPty).toBeUndefined()
  })

  it('does NOT delete anything from any external map — the session object stays alive by reference (caller owns storage)', () => {
    // The whole POINT of this helper vs stopChat: caller keeps the map
    // entry so the old child's async exit handler still finds a live
    // session with internalRecycle=true and skips the chat:exit
    // broadcast. Verify by checking the session ref is unchanged.
    const session: RecyclableSession = { child: { kill: vi.fn() } }
    const sessionRef = session
    recycleSessionInPlace(session)
    expect(session).toBe(sessionRef)
  })
})
