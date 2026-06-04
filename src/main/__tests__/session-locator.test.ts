import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  latestSessionIdFromHiveLog,
  recordedCwdFromSession,
  locateSessionBucket,
  newestHiveLogForChat,
  resolveAgentSession
} from '../session-locator'

describe('latestSessionIdFromHiveLog', () => {
  it('returns the LAST session_id seen (resume/fork repoints to current)', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'old-sid' }),
      JSON.stringify({ type: 'assistant', message: {} }),
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'new-sid' })
    ]
    expect(latestSessionIdFromHiveLog(lines)).toBe('new-sid')
  })

  it('reads session_id nested under a stream event', () => {
    const lines = [JSON.stringify({ type: 'stream_event', event: { session_id: 'nested-sid' } })]
    expect(latestSessionIdFromHiveLog(lines)).toBe('nested-sid')
  })

  it('tolerates blank/corrupt lines and returns null when none present', () => {
    expect(latestSessionIdFromHiveLog(['', '  ', 'not json', '{bad'])).toBeNull()
  })
})

describe('recordedCwdFromSession', () => {
  it('returns the first absolute cwd, skipping a meta line without one', () => {
    // Mirrors real claude jsonl: first summary line has no cwd, then records do.
    const lines = [
      JSON.stringify({ type: 'summary', cwd: null }),
      JSON.stringify({ type: 'user', cwd: '/Users/me/Development/cube-new' })
    ]
    expect(recordedCwdFromSession(lines)).toBe('/Users/me/Development/cube-new')
  })

  it('returns null when no absolute cwd is present', () => {
    expect(recordedCwdFromSession([JSON.stringify({ cwd: 'relative' }), ''])).toBeNull()
  })
})

describe('locateSessionBucket', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hive-locator-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds the bucket holding <sid>.jsonl and reads its real cwd', () => {
    const projects = join(root, 'projects')
    // The session lives in the MAIN-repo bucket, not the worktree bucket.
    const bucket = join(projects, '-Users-me-Development-cube-new')
    mkdirSync(bucket, { recursive: true })
    writeFileSync(
      join(bucket, 'sid-123.jsonl'),
      JSON.stringify({ type: 'user', cwd: '/Users/me/Development/cube-new' }) + '\n'
    )
    const r = locateSessionBucket(projects, 'sid-123')
    expect(r?.cwd).toBe('/Users/me/Development/cube-new')
    expect(r?.file).toBe(join(bucket, 'sid-123.jsonl'))
  })

  it('returns null when no bucket holds the sid', () => {
    const projects = join(root, 'projects')
    mkdirSync(join(projects, '-some-bucket'), { recursive: true })
    expect(locateSessionBucket(projects, 'missing')).toBeNull()
  })

  it('returns null when the projects dir does not exist', () => {
    expect(locateSessionBucket(join(root, 'nope'), 'sid')).toBeNull()
  })
})

describe('newestHiveLogForChat', () => {
  let logs: string[]
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-logs-'))
    logs = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('matches by chat id prefix and returns the most recently modified', () => {
    const older = join(dir, 'chat-agent-1-100.jsonl')
    const newer = join(dir, 'chat-agent-1-200.jsonl')
    const other = join(dir, 'chat-agent-2-300.jsonl')
    writeFileSync(older, '{}\n')
    writeFileSync(newer, '{}\n')
    writeFileSync(other, '{}\n')
    // Force mtimes: older < newer.
    utimesSync(older, new Date(1000), new Date(1000))
    utimesSync(newer, new Date(2000), new Date(2000))
    expect(newestHiveLogForChat(dir, 'chat-agent-1')).toBe(newer)
  })

  it('returns null when no log matches the chat id', () => {
    writeFileSync(join(dir, 'chat-agent-9-1.jsonl'), '{}\n')
    expect(newestHiveLogForChat(dir, 'chat-agent-1')).toBeNull()
  })
})

describe('resolveAgentSession (end-to-end across temp dirs)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hive-resolve-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('recovers a session created under the MAIN-repo cwd from a worktree agent', () => {
    const projects = join(root, 'projects')
    const logs = join(root, 'chat-logs')
    mkdirSync(logs, { recursive: true })
    // Session stored under main-repo bucket (the mismatch we are healing).
    const bucket = join(projects, '-Users-me-Development-cube-new')
    mkdirSync(bucket, { recursive: true })
    writeFileSync(
      join(bucket, 'cf587f60.jsonl'),
      [
        JSON.stringify({ type: 'summary', cwd: null }),
        JSON.stringify({ type: 'user', cwd: '/Users/me/Development/cube-new' })
      ].join('\n') + '\n'
    )
    // Hive chat-log links the agent to that session_id.
    writeFileSync(
      join(logs, 'chat-agent-555-1.jsonl'),
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cf587f60' }) + '\n'
    )

    const r = resolveAgentSession(projects, logs, 'chat-agent-555')
    expect(r).toEqual({
      sid: 'cf587f60',
      cwd: '/Users/me/Development/cube-new',
      file: join(bucket, 'cf587f60.jsonl')
    })
  })

  it('returns null when the agent has no chat-log', () => {
    expect(resolveAgentSession(join(root, 'p'), join(root, 'l'), 'chat-agent-x')).toBeNull()
  })

  it('returns null when the linked session file is gone', () => {
    const projects = join(root, 'projects')
    const logs = join(root, 'chat-logs')
    mkdirSync(projects, { recursive: true })
    mkdirSync(logs, { recursive: true })
    writeFileSync(
      join(logs, 'chat-agent-7-1.jsonl'),
      JSON.stringify({ session_id: 'vanished' }) + '\n'
    )
    expect(resolveAgentSession(projects, logs, 'chat-agent-7')).toBeNull()
  })
})
