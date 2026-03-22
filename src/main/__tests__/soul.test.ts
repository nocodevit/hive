import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, rmSync } from 'fs'
import { writeSoulFile, deleteSoulFile } from '../utils'

const TEST_DIR = join(__dirname, '__test_souls__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('writeSoulFile', () => {
  it('creates souls directory if missing', () => {
    writeSoulFile(TEST_DIR, 'agent-1', '# Soul')
    expect(existsSync(TEST_DIR)).toBe(true)
  })

  it('writes soul content to {agentId}.md', () => {
    const content = '# Soul\n\n## Role\nFrontend dev'
    writeSoulFile(TEST_DIR, 'agent-123', content)
    const file = join(TEST_DIR, 'agent-123.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf-8')).toBe(content)
  })

  it('overwrites existing soul file', () => {
    writeSoulFile(TEST_DIR, 'agent-1', 'old soul')
    writeSoulFile(TEST_DIR, 'agent-1', 'new soul')
    expect(readFileSync(join(TEST_DIR, 'agent-1.md'), 'utf-8')).toBe('new soul')
  })

  it('handles multiple agents independently', () => {
    writeSoulFile(TEST_DIR, 'agent-a', 'Soul A')
    writeSoulFile(TEST_DIR, 'agent-b', 'Soul B')
    expect(readFileSync(join(TEST_DIR, 'agent-a.md'), 'utf-8')).toBe('Soul A')
    expect(readFileSync(join(TEST_DIR, 'agent-b.md'), 'utf-8')).toBe('Soul B')
  })
})

describe('deleteSoulFile', () => {
  it('deletes existing soul file', () => {
    writeSoulFile(TEST_DIR, 'agent-1', 'content')
    deleteSoulFile(TEST_DIR, 'agent-1')
    expect(existsSync(join(TEST_DIR, 'agent-1.md'))).toBe(false)
  })

  it('does not throw for nonexistent file', () => {
    expect(() => deleteSoulFile(TEST_DIR, 'nope')).not.toThrow()
  })
})
