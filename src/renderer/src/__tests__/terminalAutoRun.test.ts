import { describe, it, expect } from 'vitest'
import { shouldCheckAgentSession, buildTerminalClaudeCmd } from '../terminalAutoRun'

const base = {
  autoRunClaude: true,
  hasStartupCommand: false,
  chatMode: false,
  ptyReady: true,
  launching: false
}

describe('shouldCheckAgentSession', () => {
  it('checks when on the Term tab with a ready pty and no launch in flight', () => {
    expect(shouldCheckAgentSession(base)).toBe(true)
  })

  it('does NOT check while Chat is the active view (the double-claude fix)', () => {
    expect(shouldCheckAgentSession({ ...base, chatMode: true })).toBe(false)
  })

  it('does NOT check when autoRunClaude is off', () => {
    expect(shouldCheckAgentSession({ ...base, autoRunClaude: false })).toBe(false)
  })

  it('does NOT check when a startupCommand owns the boot path', () => {
    expect(shouldCheckAgentSession({ ...base, hasStartupCommand: true })).toBe(false)
  })

  it('does NOT check while a launch is already in flight (debounce)', () => {
    expect(shouldCheckAgentSession({ ...base, launching: true })).toBe(false)
  })

  it('waits for the pty to be ready before checking', () => {
    expect(shouldCheckAgentSession({ ...base, ptyReady: false })).toBe(false)
  })
})

describe('buildTerminalClaudeCmd', () => {
  it('builds the plain agent command', () => {
    expect(buildTerminalClaudeCmd({ agentId: 'alex', agentName: 'Alex' }))
      .toBe('claude --agent hive-alex -n "Alex"')
  })

  it('appends -c when continuing a session', () => {
    expect(buildTerminalClaudeCmd({ agentId: 'mint', agentName: 'Mint', continueSession: true }))
      .toBe('claude --agent hive-mint -n "Mint" -c')
  })

  it('prepends the rebase preamble when rebaseOnStart is set', () => {
    const cmd = buildTerminalClaudeCmd({ agentId: 'pink', agentName: 'Pink', rebaseOnStart: true })
    expect(cmd).toContain('git fetch origin')
    expect(cmd).toContain('git rebase origin/$BASE')
    expect(cmd).toMatch(/&& claude --agent hive-pink -n "Pink"$/)
  })

  it('combines continueSession and rebaseOnStart', () => {
    const cmd = buildTerminalClaudeCmd({
      agentId: 'simon', agentName: 'Simon', continueSession: true, rebaseOnStart: true
    })
    expect(cmd).toMatch(/&& claude --agent hive-simon -n "Simon" -c$/)
  })
})
