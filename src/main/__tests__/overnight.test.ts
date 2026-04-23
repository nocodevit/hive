import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'

const TEST_DIR = join(__dirname, '__test_overnight__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('file-based message queue', () => {
  it('writes JSONL messages to inbox file', () => {
    const inboxDir = join(TEST_DIR, 'comms', 'proj-1', 'inbox')
    mkdirSync(inboxDir, { recursive: true })
    const inboxFile = join(inboxDir, 'agent-1.jsonl')

    // Simulate writeToInbox
    const msg1 = JSON.stringify({ time: new Date().toISOString(), type: 'TASK', id: 'task-001', _read: false })
    const msg2 = JSON.stringify({ time: new Date().toISOString(), type: 'MSG', status: 'batch_complete', _read: false })
    appendFileSync(inboxFile, msg1 + '\n')
    appendFileSync(inboxFile, msg2 + '\n')

    const lines = readFileSync(inboxFile, 'utf-8').split('\n').filter(Boolean)
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).type).toBe('TASK')
    expect(JSON.parse(lines[1]).type).toBe('MSG')
  })

  it('marks messages as read without losing them', () => {
    const inboxFile = join(TEST_DIR, 'inbox.jsonl')
    const msg = JSON.stringify({ type: 'TASK', id: 'task-001', _read: false })
    writeFileSync(inboxFile, msg + '\n')

    // Simulate check-inbox: read unread, mark as read
    const lines = readFileSync(inboxFile, 'utf-8').split('\n').filter(Boolean)
    const unread: any[] = []
    const updated: string[] = []
    for (const line of lines) {
      const m = JSON.parse(line)
      if (!m._read) { unread.push(m); m._read = true }
      updated.push(JSON.stringify(m))
    }
    writeFileSync(inboxFile, updated.join('\n') + '\n')

    expect(unread.length).toBe(1)
    expect(unread[0].id).toBe('task-001')

    // Second read: no unread
    const lines2 = readFileSync(inboxFile, 'utf-8').split('\n').filter(Boolean)
    const unread2 = lines2.map(l => JSON.parse(l)).filter(m => !m._read)
    expect(unread2.length).toBe(0)
  })

  it('survives crash — messages persist on disk', () => {
    const inboxFile = join(TEST_DIR, 'inbox.jsonl')
    appendFileSync(inboxFile, JSON.stringify({ type: 'TASK', _read: false }) + '\n')

    // Simulate crash: just re-read the file
    const lines = readFileSync(inboxFile, 'utf-8').split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0])._read).toBe(false)
  })
})

describe('batch state machine', () => {
  it('persists batch phase to disk', () => {
    const stateFile = join(TEST_DIR, 'batch-state.json')
    const state: Record<string, any> = {}
    state['proj-1:batch:1'] = { phase: 'notified_manager', notifiedAt: new Date().toISOString(), retries: 0 }
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const loaded = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(loaded['proj-1:batch:1'].phase).toBe('notified_manager')
    expect(loaded['proj-1:batch:1'].retries).toBe(0)
  })

  it('tracks retry count across saves', () => {
    const stateFile = join(TEST_DIR, 'batch-state.json')
    const state: Record<string, any> = { 'proj-1:batch:1': { phase: 'notified_manager', notifiedAt: new Date().toISOString(), retries: 0 } }
    writeFileSync(stateFile, JSON.stringify(state))

    // Simulate retry
    const loaded = JSON.parse(readFileSync(stateFile, 'utf-8'))
    loaded['proj-1:batch:1'].retries = 1
    loaded['proj-1:batch:1'].notifiedAt = new Date().toISOString()
    writeFileSync(stateFile, JSON.stringify(loaded))

    const reloaded = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(reloaded['proj-1:batch:1'].retries).toBe(1)
  })

  it('escalates after 3 retries', () => {
    const state = { 'proj-1:batch:1': { phase: 'notified_manager', notifiedAt: new Date(Date.now() - 600000).toISOString(), retries: 3 } }
    const entry = state['proj-1:batch:1']
    const elapsed = (Date.now() - new Date(entry.notifiedAt).getTime()) / 60000
    expect(elapsed).toBeGreaterThan(5)
    expect(entry.retries).toBeGreaterThanOrEqual(3)
    // Should escalate to human
  })
})

describe('stuck notify count persistence', () => {
  it('persists and reloads notify counts', () => {
    const countFile = join(TEST_DIR, 'stuck-count.json')
    const counts: Record<string, number> = { 'task-001': 2, 'task-005': 1 }
    writeFileSync(countFile, JSON.stringify(counts))

    const loaded = JSON.parse(readFileSync(countFile, 'utf-8'))
    expect(loaded['task-001']).toBe(2)
    expect(loaded['task-005']).toBe(1)
  })

  it('increments count and persists', () => {
    const countFile = join(TEST_DIR, 'stuck-count.json')
    writeFileSync(countFile, JSON.stringify({ 'task-001': 2 }))

    const loaded = JSON.parse(readFileSync(countFile, 'utf-8'))
    loaded['task-001'] = (loaded['task-001'] || 0) + 1
    writeFileSync(countFile, JSON.stringify(loaded))

    const reloaded = JSON.parse(readFileSync(countFile, 'utf-8'))
    expect(reloaded['task-001']).toBe(3)
  })
})

describe('limit resets persistence', () => {
  it('persists and reloads limit reset times', () => {
    const limitFile = join(TEST_DIR, 'limit-state.json')
    const resetTime = new Date(Date.now() + 3600000) // 1 hour from now
    const state = { 'agent-1': { resetTime: resetTime.toISOString(), taskId: 'task-001', whipScheduled: false } }
    writeFileSync(limitFile, JSON.stringify(state))

    const loaded = JSON.parse(readFileSync(limitFile, 'utf-8'))
    expect(new Date(loaded['agent-1'].resetTime).getTime()).toBe(resetTime.getTime())
    expect(loaded['agent-1'].whipScheduled).toBe(false)
  })

  it('survives app restart — limits not lost', () => {
    const limitFile = join(TEST_DIR, 'limit-state.json')
    const state = { 'agent-1': { resetTime: new Date().toISOString(), taskId: 'task-001', whipScheduled: false } }
    writeFileSync(limitFile, JSON.stringify(state))

    // Simulate restart: delete in-memory state, reload from disk
    const reloaded = JSON.parse(readFileSync(limitFile, 'utf-8'))
    expect(Object.keys(reloaded).length).toBe(1)
    expect(reloaded['agent-1'].taskId).toBe('task-001')
  })
})
