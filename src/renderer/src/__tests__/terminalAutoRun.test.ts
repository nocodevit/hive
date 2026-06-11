import { describe, it, expect } from 'vitest'
import { shouldAutoRunClaude, buildTerminalClaudeCmd } from '../terminalAutoRun'

const base = {
  autoRunClaude: true,
  hasStartupCommand: false,
  chatMode: false,
  alreadyRan: false,
  ptyReady: true
}

describe('shouldAutoRunClaude', () => {
  it('runs when on the Term tab with a ready pty and nothing has run yet', () => {
    expect(shouldAutoRunClaude(base)).toBe(true)
  })

  it('does NOT run while Chat is the active view (the double-claude fix)', () => {
    expect(shouldAutoRunClaude({ ...base, chatMode: true })).toBe(false)
  })

  it('does NOT run when autoRunClaude is off', () => {
    expect(shouldAutoRunClaude({ ...base, autoRunClaude: false })).toBe(false)
  })

  it('does NOT run when a startupCommand owns the boot path', () => {
    expect(shouldAutoRunClaude({ ...base, hasStartupCommand: true })).toBe(false)
  })

  it('does NOT run twice once it has already fired', () => {
    expect(shouldAutoRunClaude({ ...base, alreadyRan: true })).toBe(false)
  })

  it('waits for the pty to be ready before firing', () => {
    expect(shouldAutoRunClaude({ ...base, ptyReady: false })).toBe(false)
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
