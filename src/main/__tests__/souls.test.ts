import { describe, it, expect } from 'vitest'
import { getManagerSoulAddendum, getWorkerSoulAddendum, getQaSoulAddendum, getCriticSoulAddendum } from '../souls'

describe('getManagerSoulAddendum', () => {
  it('contains batch proposal and task-assign', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'docs/todo.md' })
    expect(soul).toContain('batch-propose')
    expect(soul).toContain('task-assign')
    expect(soul).toContain('estimatedMinutes')
  })

  it('contains QA loop and HIVE messages', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'todo.md' })
    expect(soul).toContain('[HIVE:HUMAN]')
    expect(soul).toContain('QA Failure Loop')
    expect(soul).toContain('3 rounds')
    expect(soul).toContain('report-human')
  })

  it('contains task-abandon with required reason', () => {
    const soul = getManagerSoulAddendum({ todoSource: 'todo.md' })
    expect(soul).toContain('task-abandon')
    expect(soul).toContain('reason required')
  })
})

describe('getWorkerSoulAddendum', () => {
  it('contains task-done and verify flow', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 3 })
    expect(soul).toContain('[HIVE:TASK]')
    expect(soul).toContain('verify[]')
    expect(soul).toContain('task-done TASK_ID')
    expect(soul).toContain('task-blocked TASK_ID')
    expect(soul).toContain('/clear')
  })

  it('includes max retries value', () => {
    const soul = getWorkerSoulAddendum({ maxRetries: 5 })
    expect(soul).toContain('5 attempts')
  })
})

describe('getQaSoulAddendum', () => {
  it('contains merge and test steps', () => {
    const soul = getQaSoulAddendum()
    expect(soul).toContain('workerBranches')
    expect(soul).toContain('git merge --no-edit')
    expect(soul).toContain('merge conflict')
    expect(soul).toContain('npm test')
    expect(soul).toContain('verify[]')
  })

  it('never fixes code', () => {
    const soul = getQaSoulAddendum()
    expect(soul).toContain('NEVER fix code')
  })
})

describe('getCriticSoulAddendum', () => {
  it('contains delivery flow', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('Rebase')
    expect(soul).toContain('QA report')
    expect(soul).toContain('/review')
    expect(soul).toContain('gh pr create')
  })

  it('refuses without QA report', () => {
    const soul = getCriticSoulAddendum()
    expect(soul).toContain('REFUSE')
    expect(soul).toContain('No QA report = no PR')
  })
})
