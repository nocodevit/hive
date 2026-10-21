import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals } from '../approvals'
import { jiraFixApproval, jiraWriteServer, registerJiraActions, transitionTo } from '../butlerJira'

/** A fake FAE workflow: 需求分析 → 需求分析评审 → 需求分析通过 → 需求设计; done = 完成 from anywhere. */
function fakeJira(start: string) {
  let status = start
  const next: Record<string, string> = { '需求分析': '需求分析评审', '需求分析评审': '需求分析通过', '需求分析通过': '需求设计' }
  const log: string[] = []
  const call = async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'jira_get_transitions') {
      const ts = [{ id: '71', name: '完成', to: { name: '完成' } }]
      if (next[status]) ts.push({ id: `to-${next[status]}`, name: 'go', to: { name: next[status] } })
      return JSON.stringify({ transitions: ts })
    }
    if (tool === 'jira_transition_issue') {
      const id = String(args.transition_id)
      status = id === '71' ? '完成' : id.slice(3)
      log.push(`${status}${args.comment ? ` (${args.comment})` : ''}`)
      return '{}'
    }
    throw new Error('unexpected ' + tool)
  }
  return { call, log, status: () => status }
}

describe('Jira transitions', () => {
  it('straight to a status, the comment on that step', async () => {
    const j = fakeJira('上线发布')
    expect(await transitionTo(j.call, 'FAE-1076', '完成', 'P4-5317 released')).toEqual({ ok: true, steps: ['完成'] })
    expect(j.log).toEqual(['完成 (P4-5317 released)'])
  })
  it('through the steps Jira cannot skip; steps already passed are skipped', async () => {
    const j = fakeJira('需求分析评审')
    const r = await transitionTo(j.call, 'FAE-1', '需求设计', 'P4-9 created', ['需求分析评审', '需求分析通过'])
    expect(r).toEqual({ ok: true, steps: ['需求分析通过', '需求设计'] })
    expect(j.log).toEqual(['需求分析通过', '需求设计 (P4-9 created)'])
  })
  it('an unreachable status or a bad key is an error, nothing moved', async () => {
    const j = fakeJira('需求设计')
    expect(await transitionTo(j.call, 'FAE-1', 'Rejected', 'x')).toMatchObject({ ok: false, error: 'no transition to "Rejected" from the current status' })
    expect(await transitionTo(j.call, 'PR-1', '完成', 'x')).toMatchObject({ ok: false, error: 'bad_key' })
    expect(j.log).toEqual([])
  })
  it('an approved card runs the transition with the card text as the comment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-jira-'))
    const approvals = createApprovals({ dir })
    const j = fakeJira('上线发布')
    registerJiraActions(approvals, () => j.call)
    const card = approvals.add(jiraFixApproval({ key: 'FAE-1076', to: '完成', why: 'P4-5317 released 8/7' }, 'from Feishu · Daniel'))
    expect(card).toMatchObject({ kind: 'jira.fix', title: 'FAE-1076 → 完成', action: 'Apply' })
    expect(await approvals.approve(card.id, 'Released in sphereII-v2.0.1-alpha.1')).toEqual({ ok: true })
    expect(j.log).toEqual(['完成 (Released in sphereII-v2.0.1-alpha.1)'])
    const none = createApprovals({ dir: mkdtempSync(join(tmpdir(), 'hive-jira-')) })
    registerJiraActions(none, () => null)
    const c2 = none.add(jiraFixApproval({ key: 'FAE-1', to: '完成', why: 'x' }, ''))
    expect(await none.approve(c2.id)).toEqual({ ok: false, error: 'no Jira server with write tools (check Butler tools)' })
  })
  it('finds the owner\'s Jira server that can write, with its own headers', () => {
    const d = mkdtempSync(join(tmpdir(), 'hive-jira-'))
    const cj = join(d, 'claude.json')
    writeFileSync(cj, JSON.stringify({ mcpServers: { sg: { type: 'http', url: 'https://sg/mcp', headers: { Authorization: 'Bearer x' } } } }))
    writeFileSync(join(d, 'tools-cache.json'), JSON.stringify({ at: 1, servers: { sg: ['jira_search', 'jira_transition_issue'] } }))
    expect(jiraWriteServer(d, cj)).toEqual({ name: 'sg', server: { url: 'https://sg/mcp', headers: { Authorization: 'Bearer x' } } })
    writeFileSync(join(d, 'tools-cache.json'), JSON.stringify({ at: 1, servers: { sg: ['jira_search'] } }))
    expect(jiraWriteServer(d, cj)).toBeNull()
  })
})
