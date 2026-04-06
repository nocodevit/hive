import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process before importing gate
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

import { runGate } from '../gate'
import { execSync } from 'child_process'

const mockExec = vi.mocked(execSync)

beforeEach(() => {
  mockExec.mockReset()
})

describe('runGate', () => {
  it('passes when all checks succeed', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: [] })
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('detects scope violation', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) return 'src/main/auth.ts\nsrc/renderer/App.tsx' as any
      return ''
    })
    const result = await runGate('/test', { scope: 'src/main/', verify: [] })
    expect(result.pass).toBe(false)
    expect(result.failures[0].step).toBe('scope')
    expect(result.failures[0].detail).toContain('src/renderer/App.tsx')
  })

  it('passes scope check when scope is "."', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: [] })
    expect(result.pass).toBe(true)
  })

  it('fails on verify command failure', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('grep')) throw new Error('not found')
      return ''
    })
    const result = await runGate('/test', { scope: '.', verify: ['grep -r "theme" src/'] })
    expect(result.pass).toBe(false)
    expect(result.failures[0].step).toBe('verify')
    expect(result.failures[0].detail).toContain('grep')
  })

  it('collects multiple failures', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) return 'outside/file.ts' as any
      if (typeof cmd === 'string' && cmd.includes('grep')) throw new Error('not found')
      return ''
    })
    const result = await runGate('/test', { scope: 'src/', verify: ['grep -r "x" src/'] })
    expect(result.pass).toBe(false)
    expect(result.failures).toHaveLength(2)
    expect(result.failures[0].step).toBe('scope')
    expect(result.failures[1].step).toBe('verify')
  })

  it('passes scope check when diff returns empty', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) return '' as any
      return ''
    })
    const result = await runGate('/test', { scope: 'src/', verify: [] })
    expect(result.pass).toBe(true)
  })

  it('passes scope check when diff command fails', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) throw new Error('not a git repo')
      return ''
    })
    const result = await runGate('/test', { scope: 'src/', verify: [] })
    expect(result.pass).toBe(true)
  })

  it('passes verify when command succeeds', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: ['echo ok', 'test -f x'] })
    expect(result.pass).toBe(true)
    expect(result.failures).toEqual([])
  })
})
