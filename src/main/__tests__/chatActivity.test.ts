import { describe, it, expect } from 'vitest'
import {
  activityForEvent,
  agentIdFromChatId,
  liveAgentIdsFromSessions
} from '../chatActivity'

describe('activityForEvent', () => {
  it('marks a streamed delta as working — the thinking/text case with no tool yet', () => {
    // This is the whole point: a partial-message delta (thinking or text) arrives
    // long before any PreToolUse, so it must read as working immediately.
    expect(activityForEvent({ type: 'stream_event', event: { type: 'content_block_delta' } })).toBe('working')
  })

  it('marks assistant and user (tool-result feed) events as working (mid-turn)', () => {
    expect(activityForEvent({ type: 'assistant', message: {} })).toBe('working')
    expect(activityForEvent({ type: 'user', message: {} })).toBe('working')
  })

  it('marks the terminal result event as waiting (turn finished)', () => {
    expect(activityForEvent({ type: 'result', subtype: 'success' })).toBe('waiting')
    expect(activityForEvent({ type: 'result', subtype: 'error', is_error: true })).toBe('waiting')
  })

  it('leaves status unchanged (null) for neutral meta events', () => {
    // Neither of these should flip activity — init happens once, rate-limit and
    // control traffic happen mid-turn without changing whether work is happening.
    expect(activityForEvent({ type: 'system', subtype: 'init', session_id: 'x' })).toBeNull()
    expect(activityForEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })).toBeNull()
    expect(activityForEvent({ type: 'control_request' })).toBeNull()
    expect(activityForEvent({ type: 'control_response' })).toBeNull()
  })

  it('is null-safe for malformed / non-object events', () => {
    expect(activityForEvent(null)).toBeNull()
    expect(activityForEvent(undefined)).toBeNull()
    expect(activityForEvent('result')).toBeNull()
    expect(activityForEvent({})).toBeNull()
    expect(activityForEvent({ type: 42 })).toBeNull()
  })
})

describe('agentIdFromChatId', () => {
  it('strips the chat- prefix to recover the agentId', () => {
    expect(agentIdFromChatId('chat-1780455224061')).toBe('1780455224061')
  })

  it('returns a bare id unchanged', () => {
    expect(agentIdFromChatId('1780455224061')).toBe('1780455224061')
  })

  it('only strips a leading prefix, not an embedded one', () => {
    expect(agentIdFromChatId('chat-chat-x')).toBe('chat-x')
  })
})

describe('liveAgentIdsFromSessions', () => {
  it('returns agentIds only for sessions whose child is live', () => {
    const entries: Array<[string, { child: unknown }]> = [
      ['chat-a', { child: {} }],       // live
      ['chat-b', { child: null }],     // exited — child nulled out
      ['chat-c', { child: {} }],       // live
      ['chat-d', { child: undefined }] // never spawned
    ]
    expect(liveAgentIdsFromSessions(entries)).toEqual(['a', 'c'])
  })

  it('returns empty when nothing is live', () => {
    const oneDead: Array<[string, { child: unknown }]> = [['chat-a', { child: null }]]
    expect(liveAgentIdsFromSessions(oneDead)).toEqual([])
    expect(liveAgentIdsFromSessions([])).toEqual([])
  })
})
