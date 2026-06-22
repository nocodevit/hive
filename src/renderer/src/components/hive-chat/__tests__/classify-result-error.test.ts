import { describe, expect, it } from 'vitest'
import { classifyResultError } from '../renderers'

describe('classifyResultError', () => {
  it('returns null when the result is not an error', () => {
    expect(classifyResultError({ is_error: false, result: 'all good' })).toBeNull()
    expect(classifyResultError({})).toBeNull()
    // is_error undefined → treated as not-an-error
    expect(classifyResultError({ result: 'done', stop_reason: 'end_turn' } as any)).toBeNull()
  })

  describe('auth_expired — re-login fixes it', () => {
    it('classifies the real 401 shape that emits junk stop_sequence', () => {
      // This is the exact incident: rejected OAuth credential. The CLI sends
      // is_error + api_error_status:401 + "Failed to authenticate" + a junk
      // stop_reason of "stop_sequence". Must be auth_expired, message = real text.
      const r = classifyResultError({
        is_error: true,
        api_error_status: 401,
        result: 'Failed to authenticate. API Error: 401 Invalid authentication credentials'
      })
      expect(r?.kind).toBe('auth_expired')
      expect(r?.message).toContain('Failed to authenticate')
      expect(r?.message).not.toContain('stop_sequence')
    })

    it('classifies the legacy "Not logged in" shape', () => {
      const r = classifyResultError({ is_error: true, result: 'Not logged in. Please run claude login.' })
      expect(r?.kind).toBe('auth_expired')
    })

    it('classifies error==="authentication_failed"', () => {
      const r = classifyResultError({ is_error: true, error: 'authentication_failed' })
      expect(r?.kind).toBe('auth_expired')
    })

    it('falls back to a friendly message when result text is empty', () => {
      const r = classifyResultError({ is_error: true, api_error_status: 401 })
      expect(r?.kind).toBe('auth_expired')
      expect(r?.message).toMatch(/sign in/i)
    })
  })

  describe('region_blocked — re-login does NOT help', () => {
    it('classifies an unavailable-country message', () => {
      const r = classifyResultError({
        is_error: true,
        result: 'Claude is not available in your country.'
      })
      expect(r?.kind).toBe('region_blocked')
    })

    it('region wins even when a 401/403 is also present', () => {
      // A geo block can carry an auth-ish status; we must NOT tell the user to
      // re-login because re-login can't fix a region restriction.
      const r = classifyResultError({
        is_error: true,
        api_error_status: 403,
        result: 'Unsupported country or region. Access denied.'
      })
      expect(r?.kind).toBe('region_blocked')
    })
  })

  describe('generic — surface the real message, no sign-in', () => {
    it('classifies a 500 server error', () => {
      const r = classifyResultError({
        is_error: true,
        api_error_status: 500,
        result: 'Internal server error'
      })
      expect(r?.kind).toBe('generic')
      expect(r?.message).toBe('Internal server error')
    })

    it('synthesizes a message from status when no text given', () => {
      const r = classifyResultError({ is_error: true, api_error_status: 529 })
      expect(r?.kind).toBe('generic')
      expect(r?.message).toContain('529')
    })
  })
})
