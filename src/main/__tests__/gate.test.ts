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
  it('always passes — gate is informational only', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: [] })
    expect(result.pass).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('returns scope warning when files outside declared scope', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) return 'src/main/auth.ts\nsrc/renderer/App.tsx' as any
      return ''
    })
    const result = await runGate('/test', { scope: 'src/main/', verify: [] })
    expect(result.pass).toBe(true) // never fails
    expect(result.warnings[0].step).toBe('scope')
    expect(result.warnings[0].detail).toContain('src/renderer/App.tsx')
  })

  it('no warnings when scope is "."', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: [] })
    expect(result.warnings).toEqual([])
  })

  it('no warnings when diff returns empty', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) return '' as any
      return ''
    })
    const result = await runGate('/test', { scope: 'src/', verify: [] })
    expect(result.warnings).toEqual([])
  })

  it('no warnings when diff command fails', async () => {
    mockExec.mockImplementation((cmd: any) => {
      if (typeof cmd === 'string' && cmd.includes('git diff')) throw new Error('not a git repo')
      return ''
    })
    const result = await runGate('/test', { scope: 'src/', verify: [] })
    expect(result.pass).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('ignores verify commands — Worker runs them', async () => {
    mockExec.mockReturnValue('')
    const result = await runGate('/test', { scope: '.', verify: ['npm test', 'echo fail'] })
    expect(result.pass).toBe(true)
  })
})
