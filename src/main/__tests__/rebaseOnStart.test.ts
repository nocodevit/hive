import { describe, it, expect } from 'vitest'
import {
  buildRebaseOnStartCommand,
  REBASE_ON_START_TIMEOUT_MS,
  isFetchTimeout
} from '../rebaseOnStart'

describe('buildRebaseOnStartCommand', () => {
  const cmd = buildRebaseOnStartCommand()

  it('makes git fetch self-abort on a stalled transfer (the anti-hang guard)', () => {
    // Without these, a stalled fetch hangs the synchronous execSync — and the
    // whole main thread — forever. This is the core of the fix.
    expect(cmd).toContain('http.lowSpeedLimit=1000')
    expect(cmd).toContain('http.lowSpeedTime=30')
    // The low-speed flags must sit on the fetch invocation itself.
    expect(cmd).toMatch(/git -c http\.lowSpeedLimit=1000 -c http\.lowSpeedTime=30 fetch origin/)
  })

  it('preserves the original rebase behavior (base pick + rebase + skip fallback)', () => {
    expect(cmd).toContain('for b in develop main master')
    expect(cmd).toContain('git rebase origin/$BASE')
    expect(cmd).toContain('✅ Rebase done')
    expect(cmd).toContain('⏭️ Rebase skipped')
  })

  it('is deterministic', () => {
    expect(buildRebaseOnStartCommand()).toBe(cmd)
  })
})

describe('REBASE_ON_START_TIMEOUT_MS', () => {
  it('is a bounded, sane backstop (30s–5min)', () => {
    expect(typeof REBASE_ON_START_TIMEOUT_MS).toBe('number')
    expect(REBASE_ON_START_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
    expect(REBASE_ON_START_TIMEOUT_MS).toBeLessThanOrEqual(300_000)
  })
})

describe('isFetchTimeout', () => {
  it('treats an execSync ETIMEDOUT or the kill signal as a stall (→ skip, not fatal)', () => {
    expect(isFetchTimeout({ code: 'ETIMEDOUT' })).toBe(true)
    expect(isFetchTimeout({ signal: 'SIGKILL' })).toBe(true)
    expect(isFetchTimeout({ signal: 'SIGTERM' })).toBe(true)
    expect(isFetchTimeout({ code: 'ETIMEDOUT', signal: 'SIGKILL' })).toBe(true)
  })

  it('treats a genuine rebase/fetch error as NOT a timeout (surface it verbatim)', () => {
    expect(isFetchTimeout({ code: 1 })).toBe(false)
    expect(isFetchTimeout({ code: 128, signal: null })).toBe(false)
    expect(isFetchTimeout({})).toBe(false)
    expect(isFetchTimeout(null)).toBe(false)
    expect(isFetchTimeout(undefined)).toBe(false)
  })
})
