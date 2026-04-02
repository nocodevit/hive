import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { generateHookSettings, writeSoulFile, deleteSoulFile } from '../utils'

describe('generateHookSettings', () => {
  it('returns hooks object with Stop, PreToolUse, Notification', () => {
    const settings = generateHookSettings('agent-42', 17710)
    expect(settings.hooks).toBeDefined()
    const hooks = settings.hooks as Record<string, any>
    expect(hooks.Stop).toBeDefined()
    expect(hooks.PreToolUse).toBeDefined()
    expect(hooks.Notification).toBeDefined()
  })

  it('embeds agent ID in curl commands', () => {
    const settings = generateHookSettings('my-agent', 17710)
    const hooks = settings.hooks as Record<string, any>
    const stopCmd = hooks.Stop[0].hooks[0].command
    expect(stopCmd).toContain('my-agent')
    expect(stopCmd).toContain('waiting')
  })

  it('uses correct port', () => {
    const settings = generateHookSettings('agent', 9999)
    const hooks = settings.hooks as Record<string, any>
    const cmd = hooks.PreToolUse[0].hooks[0].command
    expect(cmd).toContain('9999')
  })

  it('PreToolUse reports working status', () => {
    const settings = generateHookSettings('a1', 17710)
    const hooks = settings.hooks as Record<string, any>
    const cmd = hooks.PreToolUse[0].hooks[0].command
    expect(cmd).toContain('"status":"working"')
  })
})

const TEST_DIR = join(__dirname, '__test_souls__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('writeSoulFile', () => {
  it('creates directory if missing and writes file', () => {
    writeSoulFile(TEST_DIR, 'agent-1', '# Soul content')
    const file = join(TEST_DIR, 'agent-1.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe('# Soul content')
  })

  it('overwrites existing file', () => {
    writeSoulFile(TEST_DIR, 'agent-1', 'version 1')
    writeSoulFile(TEST_DIR, 'agent-1', 'version 2')
    expect(readFileSync(join(TEST_DIR, 'agent-1.md'), 'utf-8')).toBe('version 2')
  })
})

describe('deleteSoulFile', () => {
  it('deletes existing file', () => {
    writeSoulFile(TEST_DIR, 'agent-1', 'content')
    deleteSoulFile(TEST_DIR, 'agent-1')
    expect(existsSync(join(TEST_DIR, 'agent-1.md'))).toBe(false)
  })

  it('does not throw for non-existent file', () => {
    expect(() => deleteSoulFile(TEST_DIR, 'nonexistent')).not.toThrow()
  })

  it('does not throw for non-existent directory', () => {
    expect(() => deleteSoulFile('/tmp/nonexistent_dir_xyz', 'agent')).not.toThrow()
  })
})
