import { describe, it, expect } from 'vitest'
import { mapReplayEvent } from '../chat'

/**
 * Regression: v2.2.2 shipped with the compact-summary purple-wall filter
 * (PR #34) silently broken on history replay. Root cause was chat.ts's
 * initial-replay + loadOlderHistory paths hand-copying event fields
 * (type, message, session_id, _historical) and dropping `isCompactSummary`
 * + `isVisibleInTranscriptOnly` — the exact flags the renderer's
 * isCompactSummaryEvent filter reads. Result: every time an agent's chat
 * was reopened, the compact wall reappeared.
 *
 * Fix (v2.2.3): factor the mapping into mapReplayEvent + preserve the
 * two flags. These tests lock the preservation so a future field-list
 * edit doesn't silently regress it again.
 */
describe('mapReplayEvent (v2.2.3 compact-summary regression fix)', () => {
  it('preserves isCompactSummary on user events (the whole point)', () => {
    const raw = {
      type: 'user',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { role: 'user', content: 'This session is being continued from a previous conversation…' },
      sessionId: 'sid-1',
      uuid: 'u-1',
      timestamp: '2026-08-17T10:00:00Z'
    }
    const mapped = mapReplayEvent(raw) as Record<string, unknown>
    expect(mapped).not.toBeNull()
    expect(mapped.isCompactSummary).toBe(true)
    expect(mapped.isVisibleInTranscriptOnly).toBe(true)
    expect(mapped.type).toBe('user')
    expect(mapped._historical).toBe(true)
    expect(mapped.session_id).toBe('sid-1')
  })

  it('omits isCompactSummary on normal user events (no field pollution)', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: 'hello' },
      sessionId: 'sid-1'
    }
    const mapped = mapReplayEvent(raw) as Record<string, unknown>
    expect(mapped).not.toBeNull()
    expect('isCompactSummary' in mapped).toBe(false)
    expect('isVisibleInTranscriptOnly' in mapped).toBe(false)
  })

  it('never sets isCompactSummary=true if raw had a non-true truthy (defense in depth)', () => {
    for (const bad of [1, 'true', {}, []]) {
      const raw = {
        type: 'user',
        isCompactSummary: bad,
        message: { role: 'user', content: 'x' },
        sessionId: 'sid-1'
      }
      const mapped = mapReplayEvent(raw) as Record<string, unknown>
      expect('isCompactSummary' in mapped).toBe(false)
    }
  })

  it('maps assistant events without touching compact flags (compact flag lives on user event only)', () => {
    const raw = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      sessionId: 'sid-1'
    }
    const mapped = mapReplayEvent(raw) as Record<string, unknown>
    expect(mapped).not.toBeNull()
    expect(mapped.type).toBe('assistant')
    expect(mapped._historical).toBe(true)
    expect('isCompactSummary' in mapped).toBe(false)
  })

  it('returns null for system events + malformed input (they were never rebroadcast)', () => {
    expect(mapReplayEvent({ type: 'system', subtype: 'init' })).toBeNull()
    expect(mapReplayEvent({ type: 'user' })).toBeNull() // no message
    expect(mapReplayEvent({ type: 'user', message: {} })).toBeNull() // no content
    expect(mapReplayEvent(null)).toBeNull()
    expect(mapReplayEvent(undefined)).toBeNull()
    expect(mapReplayEvent('string')).toBeNull()
    expect(mapReplayEvent(42)).toBeNull()
  })

  it('does not include claude-native metadata (uuid, timestamp, parentUuid) — those never went to renderer', () => {
    const raw = {
      type: 'user',
      message: { role: 'user', content: 'hi' },
      sessionId: 'sid-1',
      uuid: 'u-99',
      timestamp: '2026-08-17T10:00:00Z',
      parentUuid: 'p-99',
      promptId: 'pr-99',
      version: '2.1.152'
    }
    const mapped = mapReplayEvent(raw) as Record<string, unknown>
    expect('uuid' in mapped).toBe(false)
    expect('timestamp' in mapped).toBe(false)
    expect('parentUuid' in mapped).toBe(false)
    expect('promptId' in mapped).toBe(false)
    expect('version' in mapped).toBe(false)
  })
})
