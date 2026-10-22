import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals } from '../approvals'
import { classify, inboxText, ownerFor, readJiraConfig, runHandleJira, type Issue, type JiraConfig, inActiveSprint, sprintState } from '../handleJira'

const AT = new Date(2026, 9, 21, 9).getTime()
const ago = (d: number) => new Date(AT - d * 86_400_000).toISOString()
const cfg: JiraConfig = {
  requests: { REQ: { final: 'Done', closed: ['Rejected'], analysis: ['Analysis'] }, SUP: { final: 'Resolved', waitingReporter: 'Validation' } },
  product: { key: 'PROD', done: ['Released', 'Done'], ready: { minChars: 50 } },
  dev: { key: 'DEV', lead: 'lead@x' },
  parked: ['Stashed'],
  stale: { active: { 'In Review': 7, 'In Progress': 14 }, waitingDays: 30, deadDays: 90 },
  owners: [{ labels: ['billing'], user: 'bill@x', name: 'Bill' }, { projects: ['SUP'], user: 'sup@x', name: 'Sue' }],
  keepFrom: ['dan@x']
}
const issue = (key: string, status: string, updatedDays: number, extra: Partial<Issue['fields']> = {}): Issue =>
  ({ key, fields: { summary: `${key} title`, status: { name: status }, updated: ago(updatedDays), ...extra } })
const ACTIVE = 'com.atlassian.greenhopper.service.sprint.Sprint@6ce7722f[id=129,name=P4 2026-41 OCT26,state=ACTIVE,rapidViewId=35]'
const FUTURE = 'com.atlassian.greenhopper.service.sprint.Sprint@7a3845bb[id=130,name=P4 2026-43 NOV09,state=FUTURE,rapidViewId=35]'
const CLOSED = 'com.atlassian.greenhopper.service.sprint.Sprint@1[id=128,name=P4 2026-39,state=CLOSED,rapidViewId=35]'
const link = (key: string, status: string) => ({ type: { name: 'Defect' }, outwardIssue: { key, fields: { status: { name: status } } } })

describe('handle-jira findings', () => {
  it('one finding per ticket, the most useful', () => {
    const f = classify([
      issue('REQ-1', 'Live', 1, { issuelinks: [link('PROD-1', 'Released')] }),
      issue('REQ-2', 'Analysis', 12),
      issue('REQ-3', 'Analysis', 2),
      issue('REQ-4', 'Rejected', 400),
      issue('SUP-1', 'Validation', 40, { issuelinks: [link('PROD-1', 'Done')] }),
      issue('PROD-2', 'Open', 3, { description: 'x'.repeat(60), customfield_10105: [CLOSED, ACTIVE] }),
      issue('PROD-3', 'In Review', 3, { description: 'short', customfield_10105: [{ state: 'active' }], issuelinks: [link('DEV-1', 'Done')] }),
      issue('PROD-4', 'In Progress', 3, { description: 'short', customfield_10105: [ACTIVE], issuelinks: [link('DEV-2', 'In Progress')] }),
      issue('PROD-5', 'In Review', 20, { description: 'short', issuelinks: [link('DEV-3', 'In Progress')] }),
      issue('PROD-6', 'Open', 45, { description: 'short' }),
      issue('PROD-7', 'Open', 200, { description: 'short' }),
      issue('PROD-8', 'Stashed', 120, { description: 'short' })
    ], cfg, AT)
    expect(f.map(x => [x.key, x.kind, x.level])).toEqual([
      ['REQ-1', 'close-source', 'L2'], ['REQ-2', 'stuck-analysis', 'L1'], ['PROD-2', 'p4-no-pr', 'L1'], ['PROD-3', 'p4-pr-done', 'L0'],
      ['PROD-4', 'p4-no-version', 'L0'], ['PROD-5', 'stale-active', 'L0'], ['PROD-6', 'stale-waiting', 'L0'], ['PROD-7', 'stale-dead', 'L0'], ['PROD-8', 'stale-dead', 'L0']
    ])
    expect(f[0]).toMatchObject({ related: 'PROD-1', to: 'Done' })
    expect(f[2]).toMatchObject({ to: 'lead@x' })
  })
  it('engineering follow-up only for the sprint running now: backlog, past and future sprints are left alone', () => {
    const ready = { description: 'x'.repeat(600) }
    const f = classify([
      issue('PROD-10', 'Open', 3, { ...ready }),
      issue('PROD-11', 'Open', 3, { ...ready, customfield_10105: [FUTURE] }),
      issue('PROD-12', 'Open', 3, { ...ready, customfield_10105: [CLOSED] }),
      issue('PROD-13', 'In Review', 3, { description: 'short', customfield_10105: [FUTURE], issuelinks: [link('DEV-9', 'Done')] }),
      issue('PROD-14', 'Open', 3, { ...ready, customfield_10105: [ACTIVE] })
    ], cfg, AT)
    expect(f.map(x => [x.key, x.kind])).toEqual([['PROD-14', 'p4-no-pr']])
    expect(sprintState(ACTIVE)).toBe('ACTIVE')
    expect(inActiveSprint([CLOSED, FUTURE])).toBe(false)
  })
  it('owners by project or label; none → the owner keeps it', () => {
    expect(ownerFor({ key: 'SUP-1', fields: {} }, cfg)!.name).toBe('Sue')
    expect(ownerFor({ key: 'PROD-1', fields: { labels: ['Billing'] } }, cfg)!.name).toBe('Bill')
    expect(ownerFor({ key: 'PROD-1', fields: { labels: ['x'] } }, cfg)).toBeNull()
  })
  it('Today: grouped, capped, nothing → one line', () => {
    expect(inboxText([])).toBe('Nothing needs you in Jira today.')
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `P-${i}`, kind: 'stale-waiting' as const, level: 'L0' as const, summary: 's', detail: 'Open 40d' }))
    const t = inboxText(many, 10)
    expect(t.startsWith('**Not started (30+ days)** (12)')).toBe(true)
    expect(t).toContain('- … 2 more')
  })
  it('reads the owner\'s config; missing or partial → not configured', () => {
    const d = mkdtempSync(join(tmpdir(), 'hive-hj-'))
    expect(readJiraConfig(d)).toBeNull()
    writeFileSync(join(d, 'jira-config.json'), JSON.stringify({ requests: {} }))
    expect(readJiraConfig(d)).toBeNull()
    writeFileSync(join(d, 'jira-config.json'), JSON.stringify(cfg))
    expect(readJiraConfig(d)!.product.key).toBe('PROD')
  })
})

describe('handle-jira daily run', () => {
  function fake() {
    const calls: Array<[string, Record<string, unknown>]> = []
    const mine = [
      issue('REQ-1', 'Live', 1, { issuelinks: [link('PROD-1', 'Released')] }),
      issue('REQ-2', 'Analysis', 12),
      issue('PROD-2', 'Open', 3, { description: 'x'.repeat(60), customfield_10105: [ACTIVE] })
    ]
    const newly = [issue('SUP-9', 'Open', 0), issue('SUP-10', 'Open', 0), issue('PROD-9', 'Open', 0, { labels: ['misc'] })]
    const call = async (tool: string, args: Record<string, unknown>) => {
      calls.push([tool, args])
      if (tool === 'jira_search') return JSON.stringify(String(args.jql).includes('assignee changed') ? { total: newly.length, issues: newly } : { total: mine.length, issues: mine })
      if (tool === 'jira_get_transitions') return JSON.stringify({ transitions: [{ id: '9', name: 'Close', to: { name: 'Done' } }] })
      if (tool === 'jira_get_issue') return JSON.stringify({ changelog: { histories: [{ items: [{ field: 'assignee', from: args.issue_key === 'SUP-10' ? 'dan' : 'someone' }] }] } })
      return '{}'
    }
    return { call, calls }
  }
  it('closes what shipped (L2), drafts / cards the rest (L1), lists L0; not again within a week', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-hj-'))
    const approvals = createApprovals({ dir })
    const f = fake()
    const prompts: string[] = []
    const write = async (p: string) => { prompts.push(p); return '想确认几点：1) 场景？2) 期望结果？' }
    const r = await runHandleJira({ folder: dir, call: f.call, write, approvals, now: () => AT }, cfg)
    expect(r.actions).toEqual(['REQ-1 → Done'])
    expect(f.calls.find(c => c[0] === 'jira_transition_issue')![1]).toMatchObject({ issue_key: 'REQ-1', transition_id: '9' })
    const cards = approvals.pending().map(c => [c.kind, c.title])
    expect(cards).toEqual([
      ['jira.comment', 'REQ-2 · comment'],
      ['jira.comment', 'PROD-2 · comment'],
      ['jira.assign', 'SUP-9 → Sue']
    ])
    expect(approvals.pending()[1].draft).toContain('[~lead@x]')
    expect(prompts[0]).toContain('REQ-2')
    // SUP-10 was handed over by dan (keepFrom): it stays with the owner; PROD-9 has no other owner.
    expect(r.text).toContain('**Done for you** (1)\n- REQ-1 → Done')
    expect(r.text).toContain('**Waiting for your OK (Approve)** (2)')
    // A week has not passed: nothing is done or asked again.
    const again = await runHandleJira({ folder: dir, call: f.call, write, approvals, now: () => AT + 3_600_000 }, cfg)
    expect(again.actions).toEqual([])
    expect(approvals.pending()).toHaveLength(3)
  })
})
