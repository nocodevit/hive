import { describe, it, expect } from 'vitest'

// Replicate Terminal startup command logic for testing
function buildStartupCommand(opts: {
  agentId: string
  agentName: string
  continueSession: boolean
  rebaseOnStart: boolean
  autoRunClaude: boolean
  startupCommand?: string
}): string | null {
  if (opts.startupCommand) return opts.startupCommand
  if (!opts.autoRunClaude) return null

  const agent = `hive-${opts.agentId}`
  const base = `claude --agent ${agent} -n "${opts.agentName}"`
  const claudeCmd = opts.continueSession ? `${base} -c` : base

  if (opts.rebaseOnStart) {
    const rebaseCmd = `git fetch origin 2>/dev/null && BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && [ -n "$BASE" ] && echo "⏳ Rebasing from origin/$BASE..." && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"`
    return `${rebaseCmd} && ${claudeCmd}`
  }
  return claudeCmd
}

// Replicate continueSession logic from App.tsx
function shouldContinueSession(opts: {
  appPrefContinue: boolean
  hasWorktree: boolean
  isNewAgent: boolean
}): boolean {
  return opts.appPrefContinue && opts.hasWorktree && !opts.isNewAgent
}

// Replicate rebaseOnStart logic from App.tsx
function shouldRebase(opts: {
  appPrefRebase: boolean
  isCoding: boolean
  hasWorktree: boolean
  isNewAgent: boolean
}): boolean {
  return opts.appPrefRebase && opts.isCoding && opts.hasWorktree && !opts.isNewAgent
}

describe('Startup Command Generation', () => {
  it('new agent: no -c flag', () => {
    const cont = shouldContinueSession({ appPrefContinue: true, hasWorktree: false, isNewAgent: true })
    const cmd = buildStartupCommand({
      agentId: 'agent-new', agentName: 'Kevin', continueSession: cont,
      rebaseOnStart: false, autoRunClaude: true
    })
    expect(cmd).toBe('claude --agent hive-agent-new -n "Kevin"')
    expect(cmd).not.toContain('-c')
  })

  it('new agent with worktree just created: no -c flag', () => {
    // Even if worktree was just created in startAgent, isNewAgent flag prevents -c
    const cont = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: true })
    const cmd = buildStartupCommand({
      agentId: 'agent-new', agentName: 'Kevin', continueSession: cont,
      rebaseOnStart: false, autoRunClaude: true
    })
    expect(cmd).not.toContain('-c')
  })

  it('existing agent with worktree: has -c flag', () => {
    const cont = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: false })
    const cmd = buildStartupCommand({
      agentId: 'agent-old', agentName: 'Pam', continueSession: cont,
      rebaseOnStart: false, autoRunClaude: true
    })
    expect(cmd).toContain('-c')
  })

  it('existing agent without worktree: no -c flag (prevents session cross-contamination)', () => {
    const cont = shouldContinueSession({ appPrefContinue: true, hasWorktree: false, isNewAgent: false })
    const cmd = buildStartupCommand({
      agentId: 'agent-old', agentName: 'Sam', continueSession: cont,
      rebaseOnStart: false, autoRunClaude: true
    })
    expect(cmd).not.toContain('-c')
  })

  it('appPrefs.continueSession disabled: no -c flag', () => {
    const cont = shouldContinueSession({ appPrefContinue: false, hasWorktree: true, isNewAgent: false })
    const cmd = buildStartupCommand({
      agentId: 'agent-old', agentName: 'Pam', continueSession: cont,
      rebaseOnStart: false, autoRunClaude: true
    })
    expect(cmd).not.toContain('-c')
  })

  it('custom startup command overrides everything', () => {
    const cmd = buildStartupCommand({
      agentId: 'agent-1', agentName: 'Test', continueSession: true,
      rebaseOnStart: true, autoRunClaude: true, startupCommand: 'echo hello'
    })
    expect(cmd).toBe('echo hello')
  })

  it('autoRunClaude disabled: returns null', () => {
    const cmd = buildStartupCommand({
      agentId: 'agent-1', agentName: 'Test', continueSession: false,
      rebaseOnStart: false, autoRunClaude: false
    })
    expect(cmd).toBeNull()
  })
})

describe('Rebase on Start', () => {
  it('new agent: no rebase', () => {
    expect(shouldRebase({ appPrefRebase: true, isCoding: true, hasWorktree: true, isNewAgent: true })).toBe(false)
  })

  it('existing coding agent with worktree: rebase', () => {
    expect(shouldRebase({ appPrefRebase: true, isCoding: true, hasWorktree: true, isNewAgent: false })).toBe(true)
  })

  it('non-coding agent: no rebase', () => {
    expect(shouldRebase({ appPrefRebase: true, isCoding: false, hasWorktree: false, isNewAgent: false })).toBe(false)
  })

  it('rebase disabled in settings: no rebase', () => {
    expect(shouldRebase({ appPrefRebase: false, isCoding: true, hasWorktree: true, isNewAgent: false })).toBe(false)
  })

  it('no worktree: no rebase', () => {
    expect(shouldRebase({ appPrefRebase: true, isCoding: true, hasWorktree: false, isNewAgent: false })).toBe(false)
  })

  it('rebase command includes branch detection', () => {
    const cmd = buildStartupCommand({
      agentId: 'agent-1', agentName: 'Pam', continueSession: false,
      rebaseOnStart: true, autoRunClaude: true
    })
    expect(cmd).toContain('git fetch origin')
    expect(cmd).toContain('develop main master')
    expect(cmd).toContain('git rebase origin/$BASE')
    expect(cmd).toContain('claude --agent')
  })
})

describe('Session Isolation', () => {
  it('two agents in same zone without worktrees: neither gets -c', () => {
    const agent1 = shouldContinueSession({ appPrefContinue: true, hasWorktree: false, isNewAgent: false })
    const agent2 = shouldContinueSession({ appPrefContinue: true, hasWorktree: false, isNewAgent: false })
    expect(agent1).toBe(false)
    expect(agent2).toBe(false)
  })

  it('two agents with separate worktrees: both get -c', () => {
    const agent1 = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: false })
    const agent2 = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: false })
    expect(agent1).toBe(true)
    expect(agent2).toBe(true)
  })

  it('one new agent, one existing in same project: only existing gets -c', () => {
    const newAgent = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: true })
    const existingAgent = shouldContinueSession({ appPrefContinue: true, hasWorktree: true, isNewAgent: false })
    expect(newAgent).toBe(false)
    expect(existingAgent).toBe(true)
  })
})
