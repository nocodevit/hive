import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { loadDataFromDir, saveDataToDir } from '../utils'

const TEST_DIR = join(__dirname, '__test_data__')
const TEST_FILE = join(TEST_DIR, 'data.json')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('loadDataFromDir', () => {
  it('returns defaults when file does not exist', () => {
    const data = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect(data).toEqual({ projects: [], agents: [] })
  })

  it('creates directory if missing', () => {
    loadDataFromDir(TEST_DIR, TEST_FILE)
    expect(existsSync(TEST_DIR)).toBe(true)
  })
})

describe('saveDataToDir + loadDataFromDir', () => {
  it('round-trips data correctly', () => {
    const input = { projects: [{ id: '1', name: 'Test' }], agents: [] }
    saveDataToDir(TEST_DIR, TEST_FILE, input)
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect(output).toEqual(input)
  })

  it('overwrites existing data', () => {
    saveDataToDir(TEST_DIR, TEST_FILE, { projects: [{ id: '1' }], agents: [] })
    saveDataToDir(TEST_DIR, TEST_FILE, { projects: [{ id: '2' }], agents: [] })
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect((output.projects as any[])[0].id).toBe('2')
  })

  it('loads old format without taskGroups field', () => {
    saveDataToDir(TEST_DIR, TEST_FILE, { projects: [], agents: [] })
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect(output.taskGroups).toBeUndefined()
    // Consumer should default: (output.taskGroups || [])
    expect((output.taskGroups || []) as any[]).toEqual([])
  })

  it('preserves taskGroups when present', () => {
    const data = { projects: [], agents: [], taskGroups: [{ id: 'tg-1', projectId: 'p-1' }] }
    saveDataToDir(TEST_DIR, TEST_FILE, data)
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect((output.taskGroups as any[])![0].id).toBe('tg-1')
  })

  it('loads agents with taskGroupRole field', () => {
    const data = { projects: [], agents: [{ id: 'a-1', taskGroupRole: 'manager' }] }
    saveDataToDir(TEST_DIR, TEST_FILE, data)
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect((output.agents as any[])[0].taskGroupRole).toBe('manager')
  })

  it('loads agents without taskGroupRole (old format)', () => {
    const data = { projects: [], agents: [{ id: 'a-1', name: 'Alice' }] }
    saveDataToDir(TEST_DIR, TEST_FILE, data)
    const output = loadDataFromDir(TEST_DIR, TEST_FILE)
    expect((output.agents as any[])[0].taskGroupRole).toBeUndefined()
  })
})
