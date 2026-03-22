import { describe, it, expect } from 'vitest'
import { generateHookSettings, generateReportScript } from '../utils'

describe('generateHookSettings', () => {
  it('generates valid hook config object', () => {
    const settings = generateHookSettings('agent-123', 17710) as any
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.PreToolUse).toHaveLength(1)
  })

  it('hooks are object format with type and command', () => {
    const settings = generateHookSettings('agent-123', 17710) as any
    const stopHook = settings.hooks.Stop[0].hooks[0]
    expect(stopHook.type).toBe('command')
    expect(stopHook.command).toContain('curl')
    expect(stopHook.command).toContain('agent-123')
    expect(stopHook.command).toContain('waiting')
  })

  it('PreToolUse hook reports working status', () => {
    const settings = generateHookSettings('agent-123', 17710) as any
    const hook = settings.hooks.PreToolUse[0].hooks[0]
    expect(hook.command).toContain('working')
  })

  it('uses correct port', () => {
    const settings = generateHookSettings('agent-123', 9999) as any
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('9999')
  })

  it('matcher is empty string (match all)', () => {
    const settings = generateHookSettings('agent-123', 17710) as any
    expect(settings.hooks.Stop[0].matcher).toBe('')
    expect(settings.hooks.PreToolUse[0].matcher).toBe('')
  })
})

describe('generateReportScript', () => {
  it('generates bash script with correct agent ID', () => {
    const script = generateReportScript('agent-456', 17710)
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('agent-456')
    expect(script).toContain('17710')
  })

  it('includes usage comment', () => {
    const script = generateReportScript('agent-456', 17710)
    expect(script).toContain('Usage:')
  })
})
