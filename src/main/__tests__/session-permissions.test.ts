import { describe, it, expect } from 'vitest'
import { shouldAutoAllow } from '../session-permissions'

/**
 * Contract lock for the session-scoped auto-allow gate. The negative
 * cases matter as much as the positive ones: a wrong `autoAllow: true`
 * means Hive silently grants a permission the user didn't approve, so
 * every shape check has to be paranoid.
 */
describe('shouldAutoAllow', () => {
  const allowlist = new Set<string>(['mcp__stargate__jira_update_issue'])

  describe('positive path — auto-allow', () => {
    it('allows a can_use_tool for a tool in the allowlist and returns the exact fields respondPermission needs', () => {
      const ev = {
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'mcp__stargate__jira_update_issue',
          input: { issue_key: 'P4-5954', labels: 'cube-new' }
        }
      }
      expect(shouldAutoAllow(ev, allowlist)).toEqual({
        autoAllow: true,
        requestId: 'req-1',
        toolName: 'mcp__stargate__jira_update_issue',
        input: { issue_key: 'P4-5954', labels: 'cube-new' }
      })
    })

    it('returns an empty input object when request.input is missing (respondPermission still needs a record)', () => {
      const ev = {
        type: 'control_request',
        request_id: 'req-2',
        request: { subtype: 'can_use_tool', tool_name: 'mcp__stargate__jira_update_issue' }
      }
      const r = shouldAutoAllow(ev, allowlist)
      if (r.autoAllow === false) throw new Error('expected auto-allow')
      expect(r.input).toEqual({})
    })

    it('handles the parallel-batch case: 4 successive events for same tool all auto-allow', () => {
      const eventFor = (n: number) => ({
        type: 'control_request',
        request_id: `req-${n}`,
        request: {
          subtype: 'can_use_tool',
          tool_name: 'mcp__stargate__jira_update_issue',
          input: { issue_key: `P4-${n}` }
        }
      })
      const decisions = [1, 2, 3, 4].map(n => shouldAutoAllow(eventFor(n), allowlist))
      expect(decisions.every(d => d.autoAllow === true)).toBe(true)
      expect(decisions.map(d => d.autoAllow && d.requestId)).toEqual(['req-1', 'req-2', 'req-3', 'req-4'])
    })
  })

  describe('negative path — fall through to renderer modal', () => {
    it('null / undefined / non-object event → false', () => {
      expect(shouldAutoAllow(null, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(undefined, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow('string', allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(42, allowlist)).toEqual({ autoAllow: false })
    })

    it('non-control_request event type → false', () => {
      expect(shouldAutoAllow({ type: 'stream_event' }, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow({ type: 'assistant' }, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow({ type: 'system' }, allowlist)).toEqual({ autoAllow: false })
    })

    it('control_request with different subtype (interrupt) → false', () => {
      const ev = { type: 'control_request', request_id: 'r', request: { subtype: 'interrupt' } }
      expect(shouldAutoAllow(ev, allowlist)).toEqual({ autoAllow: false })
    })

    it('tool NOT in allowlist → false (empty allowlist path)', () => {
      const ev = {
        type: 'control_request',
        request_id: 'r',
        request: { subtype: 'can_use_tool', tool_name: 'Bash' }
      }
      expect(shouldAutoAllow(ev, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(ev, new Set())).toEqual({ autoAllow: false })
    })

    it('missing / empty / non-string tool_name → false', () => {
      const mk = (tool_name: unknown) => ({
        type: 'control_request',
        request_id: 'r',
        request: { subtype: 'can_use_tool', tool_name }
      })
      expect(shouldAutoAllow(mk(undefined), allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(mk(''), allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(mk(42), allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow(mk(null), allowlist)).toEqual({ autoAllow: false })
    })

    it('missing request_id → false (main needs it to respondPermission)', () => {
      const ev = {
        type: 'control_request',
        request: { subtype: 'can_use_tool', tool_name: 'mcp__stargate__jira_update_issue' }
      }
      expect(shouldAutoAllow(ev, allowlist)).toEqual({ autoAllow: false })
    })

    it('missing request object → false', () => {
      expect(shouldAutoAllow({ type: 'control_request', request_id: 'r' }, allowlist)).toEqual({ autoAllow: false })
      expect(shouldAutoAllow({ type: 'control_request', request_id: 'r', request: null }, allowlist)).toEqual({ autoAllow: false })
    })

    it('request.input as array / null / primitive → coerced to empty object, still auto-allows', () => {
      const mk = (input: unknown) => ({
        type: 'control_request',
        request_id: 'r',
        request: { subtype: 'can_use_tool', tool_name: 'mcp__stargate__jira_update_issue', input }
      })
      const cases = [['bogus'], null, 'string', 42, undefined]
      for (const c of cases) {
        const r = shouldAutoAllow(mk(c), allowlist)
        if (r.autoAllow === false) throw new Error(`expected auto-allow for input=${JSON.stringify(c)}`)
        expect(r.input).toEqual({})
      }
    })
  })
})
