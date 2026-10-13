import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readOpenChats, addOpenChat, removeOpenChat, writeOpenChats, lastUserText, buildUnclosedRows, type OpenChat } from '../openChats'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hive-open-chats-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('open-chats store', () => {
  it('is empty when nothing was ever recorded', () => {
    expect(readOpenChats(dir)).toEqual([])
    expect(readOpenChats(join(dir, 'missing'))).toEqual([])
  })
  it('adds, replaces by agent, and removes', () => {
    addOpenChat(dir, { agentId: 'a1', cwd: '/x', since: 1 })
    addOpenChat(dir, { agentId: 'a2', cwd: '/y', since: 2 })
    addOpenChat(dir, { agentId: 'a1', cwd: '/x2', since: 3 })
    expect(readOpenChats(dir)).toEqual([{ agentId: 'a2', cwd: '/y', since: 2 }, { agentId: 'a1', cwd: '/x2', since: 3 }])
    removeOpenChat(dir, 'a2')
    expect(readOpenChats(dir).map(r => r.agentId)).toEqual(['a1'])
    removeOpenChat(dir, 'nope')
    expect(readOpenChats(dir).map(r => r.agentId)).toEqual(['a1'])
  })
  it('creates the data dir on first write', () => {
    const fresh = join(dir, 'new', 'deep')
    addOpenChat(fresh, { agentId: 'a1', cwd: '', since: 0 })
    expect(existsSync(join(fresh, 'open-chats.json'))).toBe(true)
  })
  it('survives a corrupt or foreign file', () => {
    writeFileSync(join(dir, 'open-chats.json'), '{not json')
    expect(readOpenChats(dir)).toEqual([])
    writeFileSync(join(dir, 'open-chats.json'), JSON.stringify({ a: 1 }))
    expect(readOpenChats(dir)).toEqual([])
    writeFileSync(join(dir, 'open-chats.json'), JSON.stringify([null, { agentId: '' }, { agentId: 'ok' }, 7]))
    expect(readOpenChats(dir)).toEqual([{ agentId: 'ok', cwd: '', since: 0 }])
  })
  it('writeOpenChats replaces the whole list', () => {
    addOpenChat(dir, { agentId: 'a1', cwd: '', since: 1 })
    writeOpenChats(dir, [])
    expect(readOpenChats(dir)).toEqual([])
  })
})

describe('lastUserText', () => {
  const stdin = (text: string) => JSON.stringify({ _direction: 'stdin', type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })
  it('returns the most recent thing the user typed', () => {
    expect(lastUserText([stdin('first task'), '{"type":"assistant"}', stdin('second\n  task'), '{"type":"result"}'])).toBe('second task')
  })
  it('ignores hook rounds, tool results and control frames', () => {
    const lines = [
      stdin('the real task'),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Stop hook feedback: keep going' }] } }),
      JSON.stringify({ _direction: 'stdin', type: 'control_request', request: { subtype: 'interrupt' } }),
      'garbage'
    ]
    expect(lastUserText(lines)).toBe('the real task')
  })
  it('clips long text and is empty when the user typed nothing', () => {
    expect(lastUserText([stdin('x'.repeat(50))], 10)).toBe('xxxxxxxxxx…')
    expect(lastUserText(['{"type":"assistant"}'])).toBe('')
    expect(lastUserText([])).toBe('')
  })
})

describe('buildUnclosedRows', () => {
  const data = {
    projects: [{ id: 'p1', name: 'Cube v2' }, { id: 'p2', name: 'Alpha' }],
    agents: [{ id: 'a1', name: 'Wendy', projectId: 'p1' }, { id: 'a2', name: 'Missy', projectId: 'p1' }, { id: 'a3', name: 'Zed', projectId: 'p2' }]
  }
  const open: OpenChat[] = [{ agentId: 'a1', cwd: '/w', since: 1 }, { agentId: 'a2', cwd: '/m', since: 2 }, { agentId: 'a3', cwd: '/z', since: 3 }, { agentId: 'gone', cwd: '/g', since: 4 }]
  const detail = (rec: OpenChat) => ({ lastTask: `task of ${rec.agentId}`, lastActiveMs: rec.since, contextSize: '1M', peakInputTokens: 1000, hasSession: true })

  it('lists recorded chats with project and agent names, sorted by project then agent', () => {
    expect(buildUnclosedRows(data, open, [], detail).map(r => `${r.project}/${r.agent}`)).toEqual(['Alpha/Zed', 'Cube v2/Missy', 'Cube v2/Wendy'])
  })
  it('carries the detail fields through', () => {
    expect(buildUnclosedRows(data, [open[0]], [], detail)[0]).toEqual({
      agentId: 'a1', agent: 'Wendy', project: 'Cube v2', lastTask: 'task of a1', lastActiveMs: 1, contextSize: '1M', peakInputTokens: 1000, hasSession: true
    })
  })
  it('skips agents that were deleted and chats that are already running again', () => {
    expect(buildUnclosedRows(data, open, ['a2'], detail).map(r => r.agentId)).toEqual(['a3', 'a1'])
  })
  it('is empty for no records or malformed data', () => {
    expect(buildUnclosedRows(data, [], [], detail)).toEqual([])
    expect(buildUnclosedRows({}, open, [], detail)).toEqual([])
  })
})
