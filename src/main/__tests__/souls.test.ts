import { describe, it, expect } from 'vitest'
import { getManagerSoulAddendum, getWorkerSoulAddendum, getQaSoulAddendum, getCriticSoulAddendum } from '../souls'

describe('getManagerSoulAddendum', () => {
  it('contains batch proposal instructions', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'docs/todo.md' })
    expect(soul).toContain('batch-propose')
    expect(soul).toContain('docs/todo.md')
  })

  it('contains task-assign command', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'todo.md' })
    expect(soul).toContain('task-assign TASK_ID WORKER_ID')
  })

  it('contains HIVE message recognition', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'todo.md' })
    expect(soul).toContain('[HIVE:HUMAN]')
    expect(soul).toContain('[HIVE:MSG]')
  })
})

describe('getWorkerSoulAddendum', () => {
  it('contains /clear protocol', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 3 })
    expect(soul).toContain('/clear')
    expect(soul).toContain('lessons.md')
  })

  it('contains HIVE:TASK recognition', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 3 })
    expect(soul).toContain('[HIVE:TASK]')
  })

  it('includes max retries value', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 5 })
    expect(soul).toContain('5 failures')
  })

  it('contains task-done and task-blocked commands', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 3 })
    expect(soul).toContain('task-done TASK_ID')
    expect(soul).toContain('task-blocked TASK_ID')
  })
})

describe('getQaSoulAddendum', () => {
  it('contains test report instructions', () => {
    const soul = getQaSoulAddendum()
    expect(soul).toContain('test report')
    expect(soul).toContain('coverage')
  })

  it('contains verify instructions', () => {
    const soul = getQaSoulAddendum()
    expect(soul).toContain('verify[]')
  })

  it('specifies never fix code', () => {
    const soul = getQaSoulAddendum()
    expect(soul).toContain('NEVER fix code')
  })
})

describe('getCriticSoulAddendum', () => {
  it('contains delivery protocol steps', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('Rebase')
    expect(soul).toContain('Independent Gate')
    expect(soul).toContain('Test Report')
    expect(soul).toContain('PR Review')
    expect(soul).toContain('Create PR')
  })

  it('references /review skill', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('/review')
  })

  it('requires test report before PR', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('REFUSE to proceed')
    expect(soul).toContain('No test report = no PR')
  })

  it('contains gh pr create', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('gh pr create')
  })
})
