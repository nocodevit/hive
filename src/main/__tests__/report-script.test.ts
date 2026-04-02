import { describe, it, expect } from 'vitest'
import { generateReportScript } from '../utils'

describe('generateReportScript', () => {
  const script = generateReportScript('test-agent-123', 17710)

  it('generates valid bash script', () => {
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('AGENT="test-agent-123"')
    expect(script).toContain('PORT=17710')
  })

  it('includes original commands: start, done, todo', () => {
    expect(script).toContain('start)')
    expect(script).toContain('done)')
    expect(script).toContain('todo)')
  })

  it('includes task-create command', () => {
    expect(script).toContain('task-create)')
    expect(script).toContain('/task-create')
  })

  it('includes task-assign command with TASK_ID and TARGET args', () => {
    expect(script).toContain('task-assign)')
    expect(script).toContain('TASK_ID="$2"')
    expect(script).toContain('TARGET="$3"')
    expect(script).toContain('/task-assign')
  })

  it('includes task-done command with TASK_ID and SUMMARY', () => {
    expect(script).toContain('task-done)')
    expect(script).toContain('/task-done')
    // Should send agentId + taskId + summary
    expect(script).toContain('agentId')
    expect(script).toContain('taskId')
    expect(script).toContain('summary')
  })

  it('includes task-blocked command with reason', () => {
    expect(script).toContain('task-blocked)')
    expect(script).toContain('/task-blocked')
    expect(script).toContain('reason')
  })

  it('includes task-status as POST with agentId', () => {
    expect(script).toContain('task-status)')
    expect(script).toContain('/task-status')
    expect(script).toContain('agentId')
  })

  it('includes ready command', () => {
    expect(script).toContain('ready)')
    expect(script).toContain('/ready')
  })

  it('includes report-human command', () => {
    expect(script).toContain('report-human)')
    expect(script).toContain('/report-human')
    expect(script).toContain('message')
  })

  it('includes batch-propose command', () => {
    expect(script).toContain('batch-propose)')
    expect(script).toContain('/batch-propose')
  })

  it('uses correct port in all curl commands', () => {
    const portMatches = script.match(/127\.0\.0\.1:\$PORT/g)
    // Should have many curl calls using $PORT
    expect(portMatches!.length).toBeGreaterThanOrEqual(10)
  })

  it('uses correct agent ID variable', () => {
    const agentMatches = script.match(/\$AGENT/g)
    expect(agentMatches!.length).toBeGreaterThanOrEqual(5)
  })
})
