import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTodoStore } from '../butlerTodos'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-todos-'))
  let t = 1_000
  return { dir, s: createTodoStore(dir, () => (t += 1000)) }
}

describe('todos', () => {
  it('a todo is its whole story: created, actions, notes, done — the file is only appended', () => {
    const { dir, s } = setup()
    const a = s.add({ title: '  周五前跟 Daniel 确认 Claro 漫游 ', source: 'chat', due: '2026-10-24', refs: { jiraKey: 'FAE-1422' } })!
    expect(a).toMatchObject({ title: '周五前跟 Daniel 确认 Claro 漫游', status: 'open', due: '2026-10-24', refs: { jiraKey: 'FAE-1422' } })
    s.event(a.id, { who: 'butler', kind: 'action', text: 'Butler replied in 产品小队', link: 'approval:x' })
    s.event(a.id, { who: 'owner', kind: 'note', text: '先收进 P4' })
    expect(s.setStatus(a.id, 'done')).toBe(true)
    expect(s.setStatus(a.id, 'done')).toBe(false)
    const got = s.get(a.id)!
    expect(got.status).toBe('done')
    expect(got.closedAt).toBeGreaterThan(got.createdAt)
    expect(got.events.map(e => e.kind)).toEqual(['created', 'action', 'note', 'status'])
    expect(readFileSync(join(dir, 'todos.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4)
  })
  it('refs are exact; a bad due date and an empty title are refused', () => {
    const { s } = setup()
    expect(s.add({ title: '   ' })).toBeNull()
    const t = s.add({ title: 'x', due: 'Friday', refs: { approvalId: 'ap-1', chatId: 'oc_1' } })!
    expect(t.due).toBeUndefined()
    expect(s.openByRef('approvalId', 'ap-1').map(x => x.id)).toEqual([t.id])
    expect(s.openByRef('approvalId', 'ap-')).toEqual([])
    s.setStatus(t.id, 'dropped')
    expect(s.openByRef('chatId', 'oc_1')).toEqual([])
    expect(s.event('nope', { who: 'owner', kind: 'note', text: 'x' })).toBe(false)
  })
})
