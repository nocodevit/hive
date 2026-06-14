// buildChatArgs is the single source of truth for the `claude --print` argv
// that startChat spawns AND that the forensic spawn log records. Testing it
// directly locks the "system command" contract — including the resume vs
// continue precedence that, when broken, silently fails to resume. (v1.7.136)

import { describe, it, expect } from 'vitest'
import { buildChatArgs } from '../chat'

describe('buildChatArgs', () => {
  it('always emits the --print stream-json base flags', () => {
    const a = buildChatArgs({})
    expect(a).toContain('--print')
    expect(a.join(' ')).toContain('--input-format stream-json')
    expect(a.join(' ')).toContain('--output-format stream-json')
    expect(a).toContain('--verbose')
    expect(a).toContain('--permission-prompt-tool')
  })

  it('a bare session does NOT resume or continue', () => {
    const a = buildChatArgs({})
    expect(a).not.toContain('--resume')
    expect(a).not.toContain('-c')
  })

  it('resumeSid adds "--resume <sid>" with the sid immediately after', () => {
    const a = buildChatArgs({ resumeSid: 'ac066b17-04f3-434b-9584-ca68583c9f63' })
    expect(a).toContain('--resume')
    expect(a[a.indexOf('--resume') + 1]).toBe('ac066b17-04f3-434b-9584-ca68583c9f63')
  })

  it('resumeSid + forkSession adds --fork-session', () => {
    const a = buildChatArgs({ resumeSid: 'x', forkSession: true })
    expect(a).toContain('--fork-session')
  })

  it('forkSession without a resumeSid is ignored', () => {
    const a = buildChatArgs({ forkSession: true })
    expect(a).not.toContain('--fork-session')
  })

  it('--resume wins over -c when both resumeSid and continueSession are set', () => {
    const a = buildChatArgs({ resumeSid: 'x', continueSession: true })
    expect(a).toContain('--resume')
    expect(a).not.toContain('-c')
  })

  it('continueSession alone adds -c (most-recent session)', () => {
    const a = buildChatArgs({ continueSession: true })
    expect(a).toContain('-c')
    expect(a).not.toContain('--resume')
  })

  it('agent + name are forwarded as --agent / -n', () => {
    const a = buildChatArgs({ agent: 'hive-agent-1778381101991', name: 'Alex' })
    expect(a[a.indexOf('--agent') + 1]).toBe('hive-agent-1778381101991')
    expect(a[a.indexOf('-n') + 1]).toBe('Alex')
  })
})
