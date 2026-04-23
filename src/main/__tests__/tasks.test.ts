import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { createTask, readTask, updateTask, listTasks, deleteTask, ensureReportsDir, watchTasks } from '../tasks'
import type { TaskData } from '../tasks'

const TEST_HOME = join(__dirname, '__test_tasks_home__')
const PROJECT_ID = 'test-project'

const baseTask: Omit<TaskData, 'id'> = {
  title: 'Test task',
  status: 'pending',
  owner: null,
  batch: 1,
  depends: [],
  scope: 'src/',
  acceptance: 'tests pass',
  verify: ['npm test'],
  attempt: 0,
  blocked_reason: null,
  abandoned_reason: null,
  note: null,
  estimatedMinutes: null,
  assignedAt: null
}

beforeEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true })
  mkdirSync(TEST_HOME, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true })
})

describe('createTask', () => {
  it('creates task with auto-incremented ID', () => {
    const t1 = createTask(TEST_HOME, PROJECT_ID, baseTask)
    expect(t1.id).toBe('task-001')
    const t2 = createTask(TEST_HOME, PROJECT_ID, { ...baseTask, title: 'Second' })
    expect(t2.id).toBe('task-002')
  })

  it('writes valid JSON to disk', () => {
    const t = createTask(TEST_HOME, PROJECT_ID, baseTask)
    const read = readTask(TEST_HOME, PROJECT_ID, t.id)
    expect(read).toMatchObject({ id: 'task-001', title: 'Test task', status: 'pending' })
  })
})

describe('readTask', () => {
  it('returns null for non-existent task', () => {
    expect(readTask(TEST_HOME, PROJECT_ID, 'task-999')).toBeNull()
  })

  it('reads created task correctly', () => {
    createTask(TEST_HOME, PROJECT_ID, { ...baseTask, title: 'Read me' })
    const t = readTask(TEST_HOME, PROJECT_ID, 'task-001')
    expect(t?.title).toBe('Read me')
    expect(t?.verify).toEqual(['npm test'])
  })
})

describe('updateTask', () => {
  it('merges updates without losing fields', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    const updated = updateTask(TEST_HOME, PROJECT_ID, 'task-001', { status: 'assigned', owner: 'worker-a' })
    expect(updated?.status).toBe('assigned')
    expect(updated?.owner).toBe('worker-a')
    expect(updated?.title).toBe('Test task') // preserved
    expect(updated?.verify).toEqual(['npm test']) // preserved
  })

  it('never overwrites id', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    const updated = updateTask(TEST_HOME, PROJECT_ID, 'task-001', { id: 'task-999' } as any)
    expect(updated?.id).toBe('task-001')
  })

  it('returns null for non-existent task', () => {
    expect(updateTask(TEST_HOME, PROJECT_ID, 'task-999', { status: 'done' })).toBeNull()
  })

  it('supports abandoned status with reason', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    const updated = updateTask(TEST_HOME, PROJECT_ID, 'task-001', {
      status: 'abandoned',
      abandoned_reason: 'no longer needed'
    })
    expect(updated?.status).toBe('abandoned')
    expect(updated?.abandoned_reason).toBe('no longer needed')
  })

  it('status transition: pending → assigned → in_progress → done', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    updateTask(TEST_HOME, PROJECT_ID, 'task-001', { status: 'assigned' })
    updateTask(TEST_HOME, PROJECT_ID, 'task-001', { status: 'in_progress' })
    const t = updateTask(TEST_HOME, PROJECT_ID, 'task-001', { status: 'done' })
    expect(t?.status).toBe('done')
  })

  it('status transition: in_progress → blocked with reason', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    updateTask(TEST_HOME, PROJECT_ID, 'task-001', { status: 'in_progress' })
    const t = updateTask(TEST_HOME, PROJECT_ID, 'task-001', {
      status: 'blocked', blocked_reason: 'build fails', attempt: 3
    })
    expect(t?.status).toBe('blocked')
    expect(t?.blocked_reason).toBe('build fails')
    expect(t?.attempt).toBe(3)
  })
})

describe('listTasks', () => {
  it('returns all tasks sorted by ID', () => {
    createTask(TEST_HOME, PROJECT_ID, { ...baseTask, title: 'A' })
    createTask(TEST_HOME, PROJECT_ID, { ...baseTask, title: 'B' })
    createTask(TEST_HOME, PROJECT_ID, { ...baseTask, title: 'C' })
    const tasks = listTasks(TEST_HOME, PROJECT_ID)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].id).toBe('task-001')
    expect(tasks[1].id).toBe('task-002')
    expect(tasks[2].id).toBe('task-003')
  })

  it('returns empty for no tasks', () => {
    expect(listTasks(TEST_HOME, PROJECT_ID)).toEqual([])
  })

  it('handles missing comms directory', () => {
    expect(listTasks(TEST_HOME, 'nonexistent')).toEqual([])
  })
})

describe('deleteTask', () => {
  it('removes task file', () => {
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    expect(deleteTask(TEST_HOME, PROJECT_ID, 'task-001')).toBe(true)
    expect(readTask(TEST_HOME, PROJECT_ID, 'task-001')).toBeNull()
  })

  it('returns false for non-existent task', () => {
    expect(deleteTask(TEST_HOME, PROJECT_ID, 'task-999')).toBe(false)
  })
})

describe('ensureReportsDir', () => {
  it('creates reports directory and returns path', () => {
    const dir = ensureReportsDir(TEST_HOME, PROJECT_ID)
    expect(existsSync(dir)).toBe(true)
    expect(dir).toContain('reports')
  })

  it('returns same path on repeated calls', () => {
    const dir1 = ensureReportsDir(TEST_HOME, PROJECT_ID)
    const dir2 = ensureReportsDir(TEST_HOME, PROJECT_ID)
    expect(dir1).toBe(dir2)
  })
})

describe('watchTasks', () => {
  it('returns a cleanup function', () => {
    const cleanup = watchTasks(TEST_HOME, PROJECT_ID, null)
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('cleanup can be called multiple times safely', () => {
    const cleanup = watchTasks(TEST_HOME, PROJECT_ID, null)
    cleanup()
    expect(() => cleanup()).not.toThrow()
  })

  it('fires callback with tasks when file changes', async () => {
    const sent: any[] = []
    const mockWin = {
      isDestroyed: () => false,
      webContents: { send: (_ch: string, data: any) => sent.push(data) }
    } as any
    const cleanup = watchTasks(TEST_HOME, PROJECT_ID, mockWin)
    // Trigger a file change
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    // fs.watch is async, wait for it
    await new Promise((r) => setTimeout(r, 200))
    cleanup()
    // Should have received at least one update with tasks array
    expect(sent.length).toBeGreaterThanOrEqual(1)
    expect(sent[0].projectId).toBe(PROJECT_ID)
    expect(Array.isArray(sent[0].tasks)).toBe(true)
  })

  it('does not crash when win is null', async () => {
    const cleanup = watchTasks(TEST_HOME, PROJECT_ID, null)
    createTask(TEST_HOME, PROJECT_ID, baseTask)
    await new Promise((r) => setTimeout(r, 200))
    cleanup() // should not throw
  })
})
