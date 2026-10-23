import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTodoStore } from '../butlerTodos'
import { noteApprovalOutcome, todoFromApproval } from '../butlerTodosIpc'

const card = (o: Record<string, unknown> = {}) => ({ id: 'ap-1', kind: 'feishu.followup', title: 'Pod · SOW 改动进 P4?', subtitle: 'Feishu · facts sent, your call', draft: '', payload: { chatId: 'oc_1', messageId: 'om_1', question: 'SOW 6 条', topic: '是否进 P4', sent: '收到…' }, status: 'pending', ...o }) as any

describe('todo ↔ Approve', () => {
  it('a card becomes a todo with exact refs and its message as the first step', () => {
    const t = todoFromApproval(card())
    expect(t).toMatchObject({ title: 'Pod · 是否进 P4', source: 'feishu', refs: { approvalId: 'ap-1', chatId: 'oc_1', messageId: 'om_1' }, link: 'approval:ap-1' })
    expect(t.note).toContain('SOW 6 条')
    expect(todoFromApproval(card({ kind: 'jira.comment', title: 'FAE-1 · comment', payload: { key: 'FAE-1' } }))).toMatchObject({ source: 'jira', refs: { jiraKey: 'FAE-1' } })
  })
  it('when the card is answered the todo says so and is done; dismissed only notes it', () => {
    const s = createTodoStore(mkdtempSync(join(tmpdir(), 'hive-tdi-')))
    const a = s.add(todoFromApproval(card()))!
    noteApprovalOutcome(s, { ...card(), status: 'rejected' })
    expect(s.get(a.id)).toMatchObject({ status: 'open' })
    expect(s.get(a.id)!.events.at(-1)!.text).toBe('Card dismissed')
    const b = s.add(todoFromApproval(card({ id: 'ap-2' })))!
    noteApprovalOutcome(s, { ...card({ id: 'ap-2' }), status: 'approved', draft: '先进 P4，下个冲刺' })
    expect(s.get(b.id)!.status).toBe('done')
    expect(s.get(b.id)!.events.map(e => e.text)).toContain('You replied: 先进 P4，下个冲刺')
  })
})
