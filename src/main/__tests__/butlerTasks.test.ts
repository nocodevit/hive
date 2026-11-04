import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals } from '../approvals'
import { createTodoStore } from '../butlerTodos'
import { BLOCKED_KIND, createTaskTracker, parseReport, reportLine, STALL_MS, taskTag, withReportLine } from '../butlerTasks'

const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const end = (result?: string) => ({ type: 'result', ...(result !== undefined ? { result } : {}) })

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-tasks-'))
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms: number) => { t += ms } }
  const approvals = createApprovals({ dir, now: clock.now })
  const todos = createTodoStore(dir, () => (t += 1))
  const sent: Array<{ agentId: string; text: string }> = []
  const told: string[] = []
  let busy = false
  const tracker = createTaskTracker({
    todos: () => todos, approvals, now: clock.now, busy: () => busy,
    deliver: async (agentId, text) => { sent.push({ agentId, text }); return { ok: true } },
    notify: (_kind, title) => told.push(title)
  })
  const give = (title: string, agentId = 'a1', agent = 'Ada') => {
    const todo = todos.add({ title, who: 'butler' })!
    todos.assign(todo.id, { agentId, agent, project: 'Acme' }, 'fits')
    todos.setWork(todo.id, 'sent', '', 'butler')
    tracker.invalidate()
    return todo.id
  }
  return { dir, approvals, todos, sent, told, tracker, give, clock, setBusy: (b: boolean) => { busy = b } }
}

describe('reading a report', () => {
  it('the last DONE / BLOCKED line wins; the tag is exact; markdown around it is fine', () => {
    expect(parseReport('Fixed it.\nDONE #1a2b3c4d: checkout totals fixed, tests green')).toEqual({ kind: 'done', tag: '#1a2b3c4d', text: 'checkout totals fixed, tests green' })
    expect(parseReport('**BLOCKED #1a2b3c4d:** need the UAT password')).toEqual({ kind: 'blocked', tag: '#1a2b3c4d', text: 'need the UAT password' })
    expect(parseReport('BLOCKED: x\nlater…\nDONE：都好了')).toEqual({ kind: 'done', text: '都好了' })
    expect(parseReport('I am not done yet, still working')).toBeNull()
    expect(parseReport('DONE')).toBeNull()
  })
  it('the brief gets the tag once', () => {
    const id = '1a2b3c4d-0000-0000-0000-000000000000'
    const once = withReportLine('Fix it', id)
    expect(once).toBe(`Fix it\n\n${reportLine(id)}`)
    expect(withReportLine(once, id)).toBe(once)
    expect(reportLine(id)).toContain('DONE #1a2b3c4d:')
  })
})

describe('an agent reports back on its own', () => {
  it('DONE → "check it" for the owner (not closed), and the owner is told', async () => {
    const s = setup()
    const id = s.give('Fix the checkout bug')
    await s.tracker.onEvent('a1', say('Looking at it'))
    expect(s.todos.get(id)!.work!.state).toBe('working')
    await s.tracker.onEvent('a1', say(`Fixed.\nDONE ${taskTag(id)}: totals fixed, 12 tests green`))
    await s.tracker.onEvent('a1', end())
    const t = s.todos.get(id)!
    expect(t.status).toBe('open')
    expect(t.work).toMatchObject({ state: 'check', text: 'totals fixed, 12 tests green' })
    expect(t.events.at(-1)!.text).toBe('Agent says done — check it: totals fixed, 12 tests green')
    expect(s.told).toEqual(['Ada says done — check it'])
    expect(s.sent).toEqual([])
  })

  it('BLOCKED → a card; the owner’s answer goes back to the agent with the tag', async () => {
    const s = setup()
    const id = s.give('Deploy to UAT')
    await s.tracker.onEvent('a1', end(`BLOCKED ${taskTag(id)}: need the UAT password`))
    expect(s.todos.get(id)!.work!.state).toBe('blocked')
    const [card] = s.approvals.pending()
    expect(card).toMatchObject({ kind: BLOCKED_KIND, action: 'Reply to agent', payload: { todoId: id, agentId: 'a1' } })
    // The same BLOCKED again is not a second card.
    await s.tracker.onEvent('a1', end(`BLOCKED ${taskTag(id)}: need the UAT password`))
    expect(s.approvals.pending()).toHaveLength(1)
    expect(await s.approvals.approve(card.id, 'Ask Lin, it is in 1Password')).toEqual({ ok: true })
    expect(s.sent[0]).toEqual({ agentId: 'a1', text: `[From the owner] Ask Lin, it is in 1Password\n\n${reportLine(id)}` })
    expect(s.todos.get(id)!.work!.state).toBe('sent')
  })

  it('a question or permission → "waiting for you"; talking again → working', async () => {
    const s = setup()
    const id = s.give('Fix it')
    await s.tracker.onEvent('a1', { type: 'control_request', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: {} } })
    expect(s.todos.get(id)!.work).toMatchObject({ state: 'needs_you', text: 'asks you a question' })
    await s.tracker.onEvent('a1', end())
    expect(s.sent).toEqual([])
    await s.tracker.onEvent('a1', say('Thanks, continuing'))
    expect(s.todos.get(id)!.work!.state).toBe('working')
  })

  it('a turn on the task without a report: asked once where it is, never twice', async () => {
    const s = setup()
    const id = s.give('Fix it')
    await s.tracker.onEvent('a1', say('On it'))
    await s.tracker.onEvent('a1', end('I changed the file.'))
    expect(s.todos.get(id)!.work).toMatchObject({ state: 'quiet', nudged: true })
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].text).toContain(`Where is task ${taskTag(id)}`)
    await s.tracker.onEvent('a1', say('Still'))
    await s.tracker.onEvent('a1', end('Still on it.'))
    expect(s.sent).toHaveLength(1)
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(id)}: done`))
    expect(s.todos.get(id)!.work!.state).toBe('check')
  })

  it('two tasks with one agent: only a tagged report counts, and it lands on that one', async () => {
    const s = setup()
    const a = s.give('Task A'), b = s.give('Task B')
    await s.tracker.onEvent('a1', end('DONE: something'))
    expect([s.todos.get(a)!.work!.state, s.todos.get(b)!.work!.state]).toEqual(['sent', 'sent'])
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(b)}: B done`))
    expect([s.todos.get(a)!.work!.state, s.todos.get(b)!.work!.state]).toEqual(['sent', 'check'])
  })

  it('another agent’s report never touches the task', async () => {
    const s = setup()
    const id = s.give('Fix it')
    await s.tracker.onEvent('a2', end(`DONE ${taskTag(id)}: done`))
    expect(s.todos.get(id)!.work!.state).toBe('sent')
  })

  it('no word for hours → "gone quiet" once, the owner is told; a working agent is not stalled', () => {
    const s = setup()
    const id = s.give('Fix it')
    s.clock.advance(STALL_MS + 1)
    s.setBusy(true)
    expect(s.tracker.sweep()).toBe(0)
    s.setBusy(false)
    expect(s.tracker.sweep()).toBe(1)
    expect(s.todos.get(id)!.work!.state).toBe('stalled')
    expect(s.tracker.sweep()).toBe(0)
    expect(s.told).toEqual(['Ada has gone quiet'])
  })

  it('send back: the same agent gets what is missing, the task is open again; accepted → closed', async () => {
    const s = setup()
    const id = s.give('Fix it')
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(id)}: fixed`))
    expect(await s.tracker.sendBack(id, ' ')).toEqual({ ok: false, error: 'empty_note' })
    expect(await s.tracker.sendBack(id, 'mobile layout still broken')).toEqual({ ok: true })
    expect(s.sent[0].text).toContain(`Task ${taskTag(id)} (Fix it) is not done yet: mobile layout still broken`)
    expect(s.todos.get(id)!.work!.state).toBe('sent')
    expect(s.tracker.list()[0]).toMatchObject({ tag: taskTag(id), agent: 'Ada', state: 'sent' })
    s.todos.setStatus(id, 'done', 'owner')
    expect(s.tracker.list()[0]).toMatchObject({ state: 'closed' })
  })

  it('the owner\u2019s own chat with the agent is never interrupted with "where is it?"', async () => {
    const s = setup()
    const id = s.give('Fix it')
    await s.tracker.onEvent('a1', say('On it'))
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(id)}: fixed`))
    const other = s.give('Second task')
    s.todos.setWork(other, 'working')
    s.tracker.invalidate()
    await s.tracker.onEvent('a1', say('Sure, here is how the router works'))
    await s.tracker.onEvent('a1', end('Sure, here is how the router works'))
    expect(s.sent).toEqual([])
  })

  it('DONE again is not a second notice; done withdraws a waiting BLOCKED card', async () => {
    const s = setup()
    const id = s.give('Deploy')
    await s.tracker.onEvent('a1', end(`BLOCKED ${taskTag(id)}: need a password`))
    expect(s.approvals.pending()).toHaveLength(1)
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(id)}: found it myself`))
    await s.tracker.onEvent('a1', end(`DONE ${taskTag(id)}: found it myself`))
    expect(s.told).toEqual(['Ada says done — check it'])
    expect(s.approvals.pending()).toEqual([])
  })

  it('a task closed while its BLOCKED card waits: the card is withdrawn, answering it sends nothing', async () => {
    const s = setup()
    const id = s.give('Deploy')
    await s.tracker.onEvent('a1', end(`BLOCKED ${taskTag(id)}: need a password`))
    const [card] = s.approvals.pending()
    s.todos.setStatus(id, 'dropped', 'owner')
    expect(await s.approvals.approve(card.id, 'here')).toEqual({ ok: false, error: 'task_closed' })
    s.tracker.sweep()
    expect(s.sent).toEqual([])
  })
})
