import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPrevSessionInfo } from '../chat-recent-sessions'
import { claudeProjectSlug } from '../../shared/claude-project-slug'

let home = ''
const saved = { HOME: process.env.HOME, HIVE_DATA_DIR: process.env.HIVE_DATA_DIR }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hive-butler-sid-'))
  process.env.HOME = home
  process.env.HIVE_DATA_DIR = join(home, '.hive')
})
afterEach(() => { process.env.HOME = saved.HOME; process.env.HIVE_DATA_DIR = saved.HIVE_DATA_DIR })

function session(cwd: string, sid: string, ageS: number) {
  const dir = join(home, '.claude', 'projects', claudeProjectSlug(cwd))
  mkdirSync(dir, { recursive: true })
  const f = join(dir, `${sid}.jsonl`)
  writeFileSync(f, JSON.stringify({ type: 'user', cwd, sessionId: sid, message: { content: 'hi' } }) + '\n')
  const t = Date.now() / 1000 - ageS
  utimesSync(f, t, t)
}

describe('Butler chat session', () => {
  it('resumes the session its own chat-log ran, not the newest file in the shared folder', () => {
    const cwd = join(home, '.hive', 'butler')
    session(cwd, 'desk-sid', 600)
    session(cwd, 'routine-sid', 5)
    mkdirSync(join(home, '.hive', 'chat-logs'), { recursive: true })
    writeFileSync(join(home, '.hive', 'chat-logs', 'chat-butler-1.jsonl'), JSON.stringify({ type: 'system', subtype: 'init', session_id: 'desk-sid', cwd }) + '\n')
    expect(getPrevSessionInfo(cwd, 'chat-butler')?.sid).toBe('desk-sid')
    expect(getPrevSessionInfo(cwd, 'chat-agent-1')?.sid).toBe('routine-sid')
  })
})
