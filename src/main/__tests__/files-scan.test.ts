import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'

// We need to test the scan logic directly, so replicate it here
const SKIP = new Set(['node_modules', '.git', '.next', '.cache', '.hive', '__pycache__', '.DS_Store', '.Trash', '.Spotlight-V100', 'dist', 'build', 'out'])

function scanFiles(dirPath: string, limit = 100) {
  const { readdirSync, lstatSync } = require('fs')
  const files: { path: string; mtime: number; size: number }[] = []
  function walk(dir: string, depth: number) {
    if (depth > 5 || files.length > limit * 2) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue
        const full = join(dir, entry.name)
        try {
          const st = lstatSync(full)
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) walk(full, depth + 1)
          else if (st.isFile()) {
            files.push({ path: full.slice(dirPath.length + 1), mtime: st.mtimeMs, size: st.size })
          }
        } catch {}
      }
    } catch {}
  }
  if (existsSync(dirPath)) walk(dirPath, 0)
  files.sort((a, b) => b.mtime - a.mtime)
  return files.slice(0, limit)
}

const TEST_DIR = join(__dirname, '__test_files_scan__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('scanFiles', () => {
  it('finds files in directory', () => {
    writeFileSync(join(TEST_DIR, 'app.tsx'), 'code')
    writeFileSync(join(TEST_DIR, 'style.css'), 'css')
    const files = scanFiles(TEST_DIR)
    expect(files).toHaveLength(2)
  })

  it('returns relative paths', () => {
    writeFileSync(join(TEST_DIR, 'app.tsx'), 'code')
    const files = scanFiles(TEST_DIR)
    expect(files[0].path).toBe('app.tsx')
  })

  it('finds files in subdirectories', () => {
    mkdirSync(join(TEST_DIR, 'src'))
    writeFileSync(join(TEST_DIR, 'src', 'index.ts'), 'code')
    const files = scanFiles(TEST_DIR)
    expect(files[0].path).toBe('src/index.ts')
  })

  it('skips node_modules', () => {
    mkdirSync(join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'node_modules', 'pkg', 'index.js'), 'code')
    const files = scanFiles(TEST_DIR)
    expect(files).toHaveLength(0)
  })

  it('skips .git', () => {
    mkdirSync(join(TEST_DIR, '.git'))
    writeFileSync(join(TEST_DIR, '.git', 'HEAD'), 'ref')
    const files = scanFiles(TEST_DIR)
    expect(files).toHaveLength(0)
  })

  it('shows dotfiles like .env.local', () => {
    writeFileSync(join(TEST_DIR, '.env.local'), 'SECRET=123')
    writeFileSync(join(TEST_DIR, '.eslintrc'), '{}')
    const files = scanFiles(TEST_DIR)
    expect(files.map(f => f.path).sort()).toEqual(['.env.local', '.eslintrc'])
  })

  it('sorts by mtime descending', () => {
    writeFileSync(join(TEST_DIR, 'old.txt'), 'old')
    // Touch with slight delay
    const now = Date.now()
    require('fs').utimesSync(join(TEST_DIR, 'old.txt'), new Date(now - 10000), new Date(now - 10000))
    writeFileSync(join(TEST_DIR, 'new.txt'), 'new')
    const files = scanFiles(TEST_DIR)
    expect(files[0].path).toBe('new.txt')
  })

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) writeFileSync(join(TEST_DIR, `file${i}.txt`), 'x')
    const files = scanFiles(TEST_DIR, 3)
    expect(files).toHaveLength(3)
  })

  it('returns empty for nonexistent directory', () => {
    const files = scanFiles(join(TEST_DIR, 'nope'))
    expect(files).toEqual([])
  })
})
