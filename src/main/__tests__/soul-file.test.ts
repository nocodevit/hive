import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { writeSoulFile, deleteSoulFile } from '../utils'

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
