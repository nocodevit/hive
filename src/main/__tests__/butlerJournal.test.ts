import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listJournalDates, parseChecklist, previousWithSection, readJournalDay, readJournalText, setJournalSection, splitSections,
  toChecklist, toggleJournalItem, ignoreJournalItem, resolveMailRefs } from '../butlerJournal'
import { agentDays, createRoutineRunner, feishuText, type RoutineRunDeps } from '../butlerRoutineRun'
import { jiraTools } from '../butlerTools'
import { defaultRoutineSettings } from '../../shared/butler-routines'

const tmp = () => mkdtempSync(join(tmpdir(), 'hive-journal-'))

describe('journal', () => {
  it('writes sections in a fixed order and keeps the others', () => {
    const dir = tmp()
    setJournalSection(dir, '2026-10-20', 'Summary', 'Shipped v2.28.3')
    setJournalSection(dir, '2026-10-20', 'Plan', '- [ ] A\n- [ ] B #draft')
    setJournalSection(dir, '2026-10-20', 'Summary', 'Shipped v2.28.4')
    expect(readJournalText(dir, '2026-10-20')).toBe('# 2026-10-20\n\n## Plan\n- [ ] A\n- [ ] B #draft\n\n## Summary\nShipped v2.28.4\n')
  })
  it('keeps a section it does not know', () => {
    const dir = tmp()
    writeFileSync(join(dir, '2026-10-20.md'), '# 2026-10-20\n\n## Notes\nmine\n')
    setJournalSection(dir, '2026-10-20', 'Plan', '- [ ] A')
    expect(splitSections(readJournalText(dir, '2026-10-20')).get('Notes')).toBe('mine')
  })
  it('parses checklist items with source pills', () => {
    expect(parseChecklist('> late · ran 10:42 · due 08:30\n- [x] Review fix\n- [ ] Reply Lin · UAT #draft\n* [ ] CUBE-1432 → In Review #Jira\nnot an item')).toEqual([
      { index: 0, text: 'Review fix', done: true, ignored: false, source: null, ref: null },
      { index: 1, text: 'Reply Lin · UAT', done: false, ignored: false, source: 'draft', ref: null },
      { index: 2, text: 'CUBE-1432 → In Review', done: false, ignored: false, source: 'jira', ref: null }
    ])
  })
  it('reads ignored items and exact email keys', () => {
    expect(parseChecklist('- [-] Read the newsletter #mail:acc-1:7:42\n- [ ] Reply Gary #draft:acc-1:7:43')).toEqual([
      { index: 0, text: 'Read the newsletter', done: false, ignored: true, source: 'mail', ref: 'acc-1:7:42' },
      { index: 1, text: 'Reply Gary', done: false, ignored: false, source: 'draft', ref: 'acc-1:7:43' }
    ])
  })
  it('swaps the model\'s m-refs for exact email keys; an unknown ref is dropped', () => {
    const refs = new Map([['m1', 'acc-1:7:42'], ['m2', 'acc-1:7:43']])
    expect(resolveMailRefs('- [ ] Read it #mail:m1\n- [ ] Reply Gary #draft:m2\n- [ ] Made up #mail:m9\n- [ ] Odd #draft:m9\n- [ ] Ticket #jira', refs))
      .toBe('- [ ] Read it #mail:acc-1:7:42\n- [ ] Reply Gary #draft:acc-1:7:43\n- [ ] Made up\n- [ ] Odd #draft\n- [ ] Ticket #jira')
  })
  it('ignore: exact index + text, becomes "- [-]", returns the tag', () => {
    const dir = tmp()
    setJournalSection(dir, '2026-10-21', 'Plan', '- [ ] A\n- [ ] Read it #mail:acc-1:7:42')
    expect(ignoreJournalItem(dir, '2026-10-21', 1, 'Wrong')).toEqual({ ok: false, error: 'changed' })
    const r = ignoreJournalItem(dir, '2026-10-21', 1, 'Read it')
    expect(r).toMatchObject({ ok: true, item: { source: 'mail', ref: 'acc-1:7:42', ignored: true } })
    expect(readJournalText(dir, '2026-10-21')).toContain('- [-] Read it #mail:acc-1:7:42')
    expect(readJournalText(dir, '2026-10-21')).toContain('- [ ] A')
  })
  it('turns model output into unchecked items', () => {
    expect(toChecklist('Here is your plan:\n- [x] A\n- B\n2. C\n\nThanks')).toBe('- [ ] A\n- [ ] B\n- [ ] C')
  })
  it('toggles by exact index + text and writes back', () => {
    const dir = tmp()
    setJournalSection(dir, '2026-10-20', 'Plan', '> late · ran 10:42 · due 08:30\n- [ ] A\n- [ ] B #draft')
    expect(toggleJournalItem(dir, '2026-10-20', 1, 'B', true)).toEqual({ ok: true })
    expect(readJournalText(dir, '2026-10-20')).toContain('- [x] B #draft')
    expect(toggleJournalItem(dir, '2026-10-20', 0, 'B', true)).toEqual({ ok: false, error: 'changed' })
    expect(toggleJournalItem(dir, '2026-10-21', 0, 'A', true)).toEqual({ ok: false, error: 'no_plan' })
    const day = readJournalDay(dir, '2026-10-20')
    expect(day.plan.map(i => i.done)).toEqual([false, true])
    expect(day.planLate).toBe('late · ran 10:42 · due 08:30')
  })
  it('lists days newest first and finds the previous summary', () => {
    const dir = tmp()
    setJournalSection(dir, '2026-10-16', 'Summary', 'Fri')
    setJournalSection(dir, '2026-10-19', 'Plan', '- [ ] x')
    setJournalSection(dir, '2026-10-20', 'Summary', 'Tue')
    writeFileSync(join(dir, 'notes.md'), 'x')
    expect(listJournalDates(dir)).toEqual(['2026-10-20', '2026-10-19', '2026-10-16'])
    expect(previousWithSection(dir, '2026-10-20', 'Summary')).toEqual({ date: '2026-10-16', body: 'Fri' })
  })
  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(() => setJournalSection(tmp(), '../x', 'Plan', 'a')).toThrow('bad_date')
  })
})

describe('routine runner', () => {
  function setup(over: Partial<RoutineRunDeps> = {}, answer = '- [ ] Review Missy\n- [ ] Reply Lin #draft') {
    const folder = tmp()
    const prompts: string[] = []
    const tools: string[][] = []
    let clock = new Date(2026, 9, 20, 8, 31).getTime()
    const deps: RoutineRunDeps = {
      folder: () => folder,
      // Never the developer's real ~/.claude.json.
      jira: () => jiraTools(folder, join(folder, 'no-claude.json')),
      runClaude: async (p, o) => { prompts.push(p); tools.push(o?.allowedTools ?? []); return answer },
      settings: () => defaultRoutineSettings(),
      mail: {
        sortInbox: async () => [],
        recent: () => [{ key: 'k', accountId: 'acc-aaaaaaaa', account: 'mei@corp.com', uidValidity: 1, uid: 1, messageId: '<m>', from: 'Lin <lin@c.com>', subject: 'UAT down?', category: 'needs-reply', summary: 'asks about UAT', approvalId: 'ap1', at: 0 }],
        unreadTotal: () => 12
      },
      agents: () => [{ agentId: 'a1', agent: 'Quinn', project: 'Cube v2', activity: 'waiting' }],
      activity: () => [{ agent: 'Missy', project: 'Shop', turns: 4, last: ['assistant: done'], commits: ['abc fix checkout'] }],
      feishu: { token: async () => ({ ok: false, error: 'signed_out' }), openId: () => null, getJson: async () => ({}) },
      now: () => clock,
      ...over
    }
    return { folder, prompts, tools, r: createRoutineRunner(deps), set: (t: number) => { clock = t } }
  }

  it('morning plan: names the skill, feeds yesterday + mail + agents, writes the Plan', async () => {
    const t = setup()
    setJournalSection(join(t.folder, 'journal'), '2026-10-19', 'Summary', 'Shipped v2.28.3')
    const rec = await t.r.run('morning-plan', { scheduled: true })
    expect(rec).toMatchObject({ id: 'morning-plan', ok: true, late: false })
    const p = t.prompts[0]
    expect(p.startsWith('Use the morning-plan skill.')).toBe(true)
    expect(p).toContain('Shipped v2.28.3')
    expect(p).toContain('12 unread')
    expect(p).toContain('[needs-reply] Lin <lin@c.com> · UAT down?')
    expect(p).toContain('Quinn · Cube v2 · waiting')
    expect(readJournalDay(join(t.folder, 'journal'), '2026-10-20').plan.map(i => [i.text, i.source])).toEqual([['Review Missy', null], ['Reply Lin', 'draft']])
    expect(t.r.lastRuns()['morning-plan']).toMatchObject({ ok: true })
  })
  it('a scheduled run long after its slot is marked late', async () => {
    const t = setup()
    t.set(new Date(2026, 9, 20, 10, 42).getTime())
    const rec = await t.r.run('morning-plan', { scheduled: true })
    expect(rec.late).toBe(true)
    expect(readJournalDay(join(t.folder, 'journal'), '2026-10-20').planLate).toBe('late · ran 10:42 · due 08:30')
  })
  it('morning plan: today\'s meetings (code) and what waits for the owner', async () => {
    const t = setup({ calendar: async () => '- 10:00–11:00 Sprint review', waiting: () => ['Gary · Claro roaming (email.decide)'] })
    await t.r.run('morning-plan')
    const day = readJournalDay(join(t.folder, 'journal'), '2026-10-20')
    expect(day.meetings).toBe('- 10:00–11:00 Sprint review')
    expect(t.prompts[0]).toContain('## Waiting for the owner (Approve)\n- Gary · Claro roaming (email.decide)')
    const none = setup({ calendar: async () => '' })
    await none.r.run('morning-plan')
    expect(readJournalDay(join(none.folder, 'journal'), '2026-10-20').meetings).toBe('No meetings today')
  })
  it('a manual run is never late', async () => {
    const t = setup()
    t.set(new Date(2026, 9, 20, 10, 42).getTime())
    expect((await t.r.run('morning-plan')).late).toBe(false)
  })
  it('no checklist in the answer → error, journal untouched', async () => {
    const t = setup({}, 'I cannot do that')
    const rec = await t.r.run('morning-plan')
    expect(rec).toMatchObject({ ok: false, error: 'morning-plan: no checklist in the answer' })
    expect(readJournalText(join(t.folder, 'journal'), '2026-10-20')).toBe('')
  })
  it('evening report writes the Summary from today’s activity', async () => {
    const t = setup({}, 'Shipped checkout\n- done: fix')
    t.set(new Date(2026, 9, 20, 19, 2).getTime())
    await t.r.run('evening-report', { scheduled: true })
    expect(t.prompts[0].startsWith('Use the evening-report skill.')).toBe(true)
    expect(t.prompts[0]).toContain('Missy · Shop · 4 turns')
    expect(t.prompts[0]).toContain('commit abc fix checkout')
    expect(readJournalDay(join(t.folder, 'journal'), '2026-10-20').summary).toBe('Shipped checkout\n- done: fix')
  })
  it('jira-check reports not connected without a Jira MCP', async () => {
    const t = setup()
    expect(await t.r.run('jira-check')).toMatchObject({ ok: false, error: 'Jira not connected' })
    expect(t.prompts).toEqual([])
  })
  it('jira-check uses the skill when .mcp.json has jira', async () => {
    const t = setup({}, 'CUBE-1 · x · review')
    writeFileSync(join(t.folder, '.mcp.json'), JSON.stringify({ mcpServers: { jira: { command: 'x' } } }))
    expect((await t.r.run('jira-check')).ok).toBe(true)
    expect(t.tools[0]).toEqual(['mcp__jira'])
    expect(readJournalDay(join(t.folder, 'journal'), '2026-10-20').jira).toBe('CUBE-1 · x · review')
  })
  it('jira-check through a discovered server gets its read tools only', async () => {
    const folder = tmp()
    writeFileSync(join(folder, 'tools-cache.json'), JSON.stringify({ at: 1, servers: { stargate: ['jira_search', 'jira_get_issue', 'jira_add_comment'] } }))
    const t = setup({ folder: () => folder, jira: () => jiraTools(folder, join(folder, 'none.json')) }, 'P4-1 · x · review')
    expect((await t.r.run('jira-check')).ok).toBe(true)
    expect(t.tools[0]).toEqual(['mcp__stargate__jira_search', 'mcp__stargate__jira_get_issue'])
  })
  it('the evening report runs without Feishu (no @mention section) and adds what Butler did', async () => {
    const t = setup({ butlerToday: () => '- Feishu: answered 3 · passed to you 1' }, 'Shipped checkout')
    t.set(new Date(2026, 9, 20, 19, 2).getTime())
    expect((await t.r.run('evening-report')).ok).toBe(true)
    const day = readJournalDay(join(t.folder, 'journal'), '2026-10-20')
    expect(day.feishu).toBe('')
    expect(day.butler).toBe('- Feishu: answered 3 · passed to you 1')
    expect(t.prompts.at(-1)).toContain('## What Butler did today\n- Feishu: answered 3 · passed to you 1')
  })
  it('the evening report carries the @mentions of the owner, summarized', async () => {
    const urls: string[] = []
    const t = setup({
      feishu: {
        token: async () => ({ ok: true, token: 'u-tok' }),
        openId: () => 'ou_me',
        getJson: async (url, tok) => {
          urls.push(url)
          expect(tok).toBe('u-tok')
          if (url.includes('/im/v1/chats')) return { code: 0, data: { items: [{ chat_id: 'oc_1', name: 'Cube' }] } }
          return { code: 0, data: { items: [
            { mentions: [{ id: 'ou_me' }], body: { content: JSON.stringify({ text: '@_user_1 UAT 好了吗' }) } },
            { mentions: [{ id: 'ou_other' }], body: { content: JSON.stringify({ text: 'not me' }) } }
          ] } }
        }
      }
    }, 'Cube: Lin asks if UAT is back')
    t.set(new Date(2026, 9, 20, 19, 0).getTime())
    expect((await t.r.run('evening-report', { scheduled: true })).ok).toBe(true)
    expect(t.prompts[0]).toContain('[Cube] @_user_1 UAT 好了吗')
    expect(t.prompts[0]).not.toContain('not me')
    expect(urls[1]).toContain('container_id=oc_1')
    expect(readJournalDay(join(t.folder, 'journal'), '2026-10-20').feishu).toBe('**19:00**\nCube: Lin asks if UAT is back')
  })
  it('feishuText reads text and post bodies', () => {
    expect(feishuText('{"text":"hi"}')).toBe('hi')
    expect(feishuText(JSON.stringify({ title: '', content: [[{ tag: 'text', text: 'a' }, { tag: 'at', user_id: 'x' }], [{ tag: 'text', text: 'b' }]] }))).toBe('a b')
  })
})

describe('agentDays', () => {
  it('counts turns and last lines from logs touched today, plus commits', () => {
    const logDir = tmp()
    const since = new Date(2026, 9, 20).getTime()
    const lines = [
      { _direction: 'stdin', type: 'user', message: { content: [{ type: 'text', text: 'fix checkout' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
      { type: 'result', subtype: 'success' },
      { type: 'result', subtype: 'success' }
    ].map(x => JSON.stringify(x)).join('\n')
    writeFileSync(join(logDir, 'chat-a1-1.jsonl'), lines)
    writeFileSync(join(logDir, 'chat-a2-1.jsonl'), lines)
    utimesSync(join(logDir, 'chat-a2-1.jsonl'), new Date(2026, 9, 18), new Date(2026, 9, 18))
    mkdirSync(join(logDir, 'sub'))
    const out = agentDays({
      logDir, since,
      agents: [{ agentId: 'a1', agent: 'Missy', project: 'Shop', activity: 'off' }, { agentId: 'a2', agent: 'Old', project: 'X', activity: 'off' }],
      cwdOf: id => (id === 'a1' ? '/w' : null),
      gitLog: () => ['abc fix']
    })
    expect(out).toEqual([{ agent: 'Missy', project: 'Shop', turns: 2, last: ['user: fix checkout', 'assistant: done'], commits: ['abc fix'] }])
    expect(readFileSync(join(logDir, 'chat-a1-1.jsonl'), 'utf8')).toBe(lines)
  })
})
