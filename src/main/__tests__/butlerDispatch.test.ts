import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals } from '../approvals'
import { createTodoStore } from '../butlerTodos'
import { createDispatcher, dispatchMode, parseDecisions, runDispatch, DISPATCH_KIND } from '../butlerDispatch'
import type { AgentRow } from '../butlerApi'

const agent = (agentId: string, name: string, project: string, activity: AgentRow['activity'], role = 'Engineering'): AgentRow =>
  ({ agentId, agent: name, projectId: project, project, role, note: '', chatLive: activity !== 'off', activity, updatedAt: 0 })

const setup = (rows: AgentRow[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-dispatch-'))
  let t = 1000
  const approvals = createApprovals({ dir, now: () => (t += 1000) })
  const todos = createTodoStore(dir, () => (t += 1000))
  const sent: Array<{ agentId: string; text: string }> = []
  const dispatcher = createDispatcher({ rows: () => rows, deliver: async (agentId, text) => { sent.push({ agentId, text }); return { ok: true } }, approvals, todos: () => todos })
  return { dir, approvals, todos, sent, dispatcher }
}

describe('dispatch rule', () => {
  it('sends only when Butler is sure and the agent is free; otherwise the owner confirms', () => {
    expect(dispatchMode(true, 'waiting')).toBe('send')
    expect(dispatchMode(true, 'off')).toBe('send')
    expect(dispatchMode(true, 'working')).toBe('card')
    expect(dispatchMode(false, 'waiting')).toBe('card')
  })

  it('sure + free: the brief goes to the agent now and the todo says who has it', async () => {
    const s = setup([agent('a1', 'Ada', 'Acme Web', 'waiting')])
    const todo = s.todos.add({ title: 'Fix the checkout bug' })!
    const r = await s.dispatcher.assign({ task: 'Fix the checkout bug', agent: 'ada', why: 'touched checkout last week', confident: true, todoId: todo.id })
    expect(r).toMatchObject({ ok: true, mode: 'sent' })
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].text).toContain('Fix the checkout bug')
    expect(s.sent[0].text).toContain('Why you: touched checkout last week')
    expect(s.todos.get(todo.id)).toMatchObject({ assignee: { agentId: 'a1', agent: 'Ada', project: 'Acme Web' } })
    expect(s.todos.get(todo.id)!.events.at(-1)!.text).toBe('Assigned to Ada (Acme Web) — touched checkout last week')
    expect(s.approvals.pending()).toHaveLength(0)
  })

  it('busy or not sure: a card with the brief; nothing is sent until the owner presses Assign', async () => {
    const s = setup([agent('a1', 'Ada', 'Acme Web', 'working'), agent('a2', 'Linus', 'Acme Web', 'waiting', 'QA')])
    const todo = s.todos.add({ title: 'Fix the checkout bug' })!
    const busy = await s.dispatcher.assign({ task: 'Fix the checkout bug', agent: 'Ada', why: 'checkout owner', confident: true, todoId: todo.id, alternatives: ['Linus'] })
    expect(busy).toMatchObject({ ok: true, mode: 'card', reason: 'busy' })
    const unsure = await s.dispatcher.assign({ task: 'Write release notes', agent: 'Linus', why: '', confident: false })
    expect(unsure).toMatchObject({ ok: true, mode: 'card', reason: 'not_sure' })
    expect(s.sent).toEqual([])
    const [card] = s.approvals.pending()
    expect(card).toMatchObject({ kind: DISPATCH_KIND, title: '→ Ada · Fix the checkout bug', action: 'Assign', payload: { agentId: 'a1', todoId: todo.id, alternatives: ['Linus'] } })
    expect(card.subtitle).toContain('Ada is busy right now')
    expect(s.todos.get(todo.id)!.assignee).toBeUndefined()
    // The owner edits the brief and assigns: that text goes out, the todo is linked.
    expect(await s.approvals.approve(card.id, 'Fix checkout — see P4-1')).toEqual({ ok: true })
    expect(s.sent).toEqual([{ agentId: 'a1', text: 'Fix checkout — see P4-1' }])
    expect(s.todos.get(todo.id)!.assignee).toMatchObject({ agent: 'Ada' })
  })

  it('names are exact; two with the same name need the project', async () => {
    const s = setup([agent('a1', 'Ada', 'Acme Web', 'waiting'), agent('a3', 'Ada', 'Mobile', 'waiting')])
    expect(await s.dispatcher.assign({ task: 'x', agent: 'Ada', why: '', confident: true })).toMatchObject({ ok: false, error: 'ambiguous' })
    expect(await s.dispatcher.assign({ task: 'x', agent: 'Ad', why: '', confident: true })).toMatchObject({ ok: false, error: 'no_such_agent' })
    expect(await s.dispatcher.assign({ task: 'x', agent: 'Ada', project: 'mobile', why: '', confident: true })).toMatchObject({ ok: true, mode: 'sent', agent: { agentId: 'a3' } })
  })
})

describe('the Dispatch routine', () => {
  it('asks once per open, unassigned todo; applies the rule; no fit is noted, never sent', async () => {
    const s = setup([agent('a1', 'Ada', 'Acme Web', 'off'), agent('a2', 'Linus', 'Acme Web', 'working', 'QA')])
    const a = s.todos.add({ title: 'Fix the checkout bug' })!
    const b = s.todos.add({ title: 'Test the new signup flow' })!
    const c = s.todos.add({ title: 'Reply to the landlord' })!
    const prompts: string[] = []
    const reply = JSON.stringify([
      { todoId: a.id, agent: 'Ada', project: 'Acme Web', confident: true, why: 'checkout' },
      { todoId: b.id, agent: 'Linus', confident: true, why: 'QA' },
      { todoId: c.id, agent: null, why: 'the owner’s own call' }
    ])
    const deps = { folder: s.dir, todos: () => s.todos, agents: () => [{ ...agent('a1', 'Ada', 'Acme Web', 'off'), lastTask: 'checkout page' }], dispatcher: s.dispatcher, runClaude: async (p: string) => { prompts.push(p); return `Here you go:\n${reply}` } }
    const text = await runDispatch(deps)
    expect(prompts[0]).toContain('dispatch skill')
    expect(prompts[0]).toContain('last task: checkout page')
    expect(text).toContain('Fix the checkout bug → Ada')
    expect(text).toContain('Test the new signup flow → Linus (waiting for your OK in Approve)')
    expect(text).toContain('Reply to the landlord: no agent fits')
    expect(s.sent.map(x => x.agentId)).toEqual(['a1'])
    expect(s.todos.get(c.id)!.events.at(-1)!.text).toBe('No agent fits this one — the owner’s own call')
    // Looked at once: the next pass leaves them alone.
    expect(await runDispatch(deps)).toBe('Nothing new to assign')
    expect(prompts).toHaveLength(1)
  })

  it('reads the JSON array out of a chatty reply; garbage gives nothing', () => {
    expect(parseDecisions('ok [{"todoId":"t1","agent":"Ada"}] done')).toEqual([{ todoId: 't1', agent: 'Ada' }])
    expect(parseDecisions('no json here')).toEqual([])
    expect(parseDecisions('[{"agent":"Ada"}]')).toEqual([])
  })
})
