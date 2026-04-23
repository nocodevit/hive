import { describe, it, expect } from 'vitest'
import { generateReportScript } from '../utils'

describe('generateReportScript', () => {
  const script = generateReportScript('test-agent-123', 17710)

  it('generates valid bash script with CMD helper', () => {
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('AGENT="test-agent-123"')
    expect(script).toContain('CMD="curl')
  })

  it('defaults to $HOME/.hive/port.lock when no dataDir passed', () => {
    expect(script).toContain('LOCK_FILE="$HOME/.hive/port.lock"')
  })

  it('uses custom dataDir for lock file (dev isolation)', () => {
    const devScript = generateReportScript('dev-agent', 17711, '/tmp/hive-dev')
    expect(devScript).toContain('LOCK_FILE="/tmp/hive-dev/port.lock"')
  })

  it('task-done has git commit + rebase + push with structured error output', () => {
    expect(script).toContain('task-done)')
    expect(script).toContain('git add -A')
    expect(script).toContain('git commit')
    expect(script).toContain('git rebase')
    expect(script).toContain('git push --force-with-lease')
    expect(script).toContain('REBASE_CONFLICT')
    expect(script).toContain('PUSH_FAILED')
    expect(script).toContain('exit 1')
  })

  it('task-assign checks HTTP code and exits on failure', () => {
    expect(script).toContain('task-assign)')
    expect(script).toContain('HTTP_CODE')
    expect(script).toContain('exit 1')
  })

  it('task-abandon checks HTTP code and exits on failure', () => {
    expect(script).toContain('task-abandon)')
    expect(script).toContain('HTTP_CODE')
  })

  it('all task commands hit correct endpoints', () => {
    expect(script).toContain('/task-create')
    expect(script).toContain('/task-assign')
    expect(script).toContain('/task-done')
    expect(script).toContain('/task-blocked')
    expect(script).toContain('/task-abandon')
    expect(script).toContain('/task-status')
  })

  it('all reporting commands hit correct endpoints', () => {
    expect(script).toContain('/report')
    expect(script).toContain('/report-human')
    expect(script).toContain('/ready')
    expect(script).toContain('/batch-propose')
  })

  it('has unknown command handler', () => {
    expect(script).toContain('unknown command')
    expect(script).toContain('exit 1')
  })

  it('no commands swallow output (no >/dev/null)', () => {
    // All commands should print their response for agent to read
    const devNullCount = (script.match(/> \/dev\/null/g) || []).length
    expect(devNullCount).toBe(0)
  })

  it('uses target branch variable for rebase', () => {
    const branchScript = generateReportScript('ag', 17710, undefined, 'develop')
    expect(branchScript).toContain('origin/develop')
  })

  it('has check-inbox command for message queue', () => {
    expect(script).toContain('check-inbox)')
    expect(script).toContain('/check-inbox')
  })

  it('task-done has retry loop (3 attempts) for rebase+push', () => {
    expect(script).toContain('for ATTEMPT in 1 2 3')
    expect(script).toContain('sleep 3')
    expect(script).toContain('PUSH_OK=false')
    expect(script).toContain('after 3 attempts')
  })

  it('task-done retries curl to dispatcher', () => {
    // Second retry loop for the HTTP call
    const matches = script.match(/for ATTEMPT in 1 2 3/g)
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('task-done returns structured error JSON on failure', () => {
    expect(script).toContain('REBASE_CONFLICT')
    expect(script).toContain('PUSH_FAILED')
    expect(script).toContain('ok')
    expect(script).toContain('false')
  })
})
