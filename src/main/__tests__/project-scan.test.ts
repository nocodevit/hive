import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { scanDirForTodos } from '../utils'

const TEST_DIR = join(__dirname, '__test_scan__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('scanDirForTodos', () => {
  it('finds todos in markdown files', () => {
    writeFileSync(join(TEST_DIR, 'TODO.md'), '- [ ] Fix bug\n- [x] Add tests\n')
    const todos = scanDirForTodos(TEST_DIR, 'rnd')
    expect(todos).toHaveLength(2)
    expect(todos[0]).toMatchObject({ text: 'Fix bug', done: false, category: 'rd' })
    expect(todos[1]).toMatchObject({ text: 'Add tests', done: true, category: 'rd' })
  })

  it('scans subdirectories', () => {
    mkdirSync(join(TEST_DIR, 'docs'))
    writeFileSync(join(TEST_DIR, 'docs', 'plan.md'), '- [ ] Create marketing plan\n')
    const todos = scanDirForTodos(TEST_DIR, 'non-rnd')
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ text: 'Create marketing plan', category: 'marketing' })
  })

  it('skips node_modules', () => {
    mkdirSync(join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'node_modules', 'pkg', 'README.md'), '- [New] add feature\n')
    const todos = scanDirForTodos(TEST_DIR, 'rnd')
    expect(todos).toHaveLength(0)
  })

  it('skips dist and build directories', () => {
    mkdirSync(join(TEST_DIR, 'dist'))
    writeFileSync(join(TEST_DIR, 'dist', 'notes.md'), '- [ ] Should not find this\n')
    const todos = scanDirForTodos(TEST_DIR, 'rnd')
    expect(todos).toHaveLength(0)
  })

  it('returns empty for directory with no markdown', () => {
    writeFileSync(join(TEST_DIR, 'code.ts'), '// no todos here')
    const todos = scanDirForTodos(TEST_DIR, 'rnd')
    expect(todos).toHaveLength(0)
  })

  it('sets zone name from directory', () => {
    writeFileSync(join(TEST_DIR, 'TODO.md'), '- [ ] Task\n')
    const todos = scanDirForTodos(TEST_DIR, 'rnd')
    expect(todos[0].zone).toBe('__test_scan__')
  })
})
