import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { authHeader, butlerJiraCall, createJiraConnectionStore, createJiraRestCaller, normalizeConnection, normalizeJiraUrl } from '../jiraRest'

const plain = { encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() }

function fakeFetch(reply: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; method: string; body: any; auth: string }> = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).Authorization })
    const r = reply(url, init)
    const status = r.status ?? 200
    return { ok: status < 300, status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as Response
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('jira REST', () => {
  it('normalizes the base URL from whatever was pasted', () => {
    expect(normalizeJiraUrl('https://pm.example.net/browse/P4-1')).toBe('https://pm.example.net')
    expect(normalizeJiraUrl('https://x.example.com/jira/')).toBe('https://x.example.com/jira')
    expect(normalizeJiraUrl('ftp://x')).toBeNull()
    expect(normalizeConnection({ mode: 'weird', email: 'nope' })).toEqual({ mode: 'auto', url: '', email: '' })
  })
  it('Server/DC uses a Bearer token, Cloud uses email + API token', () => {
    expect(authHeader('', 't0k')).toBe('Bearer t0k')
    expect(authHeader('me@x.com', 't0k')).toBe(`Basic ${Buffer.from('me@x.com:t0k').toString('base64')}`)
  })
  it('speaks the MCP tool names Butler uses, over REST v2', async () => {
    const { f, calls } = fakeFetch(url => ({ body: url.includes('/search') ? { total: 1, issues: [{ key: 'P4-1', fields: {} }] } : url.endsWith('/transitions') ? { transitions: [{ id: '31', to: { name: 'Done' } }] } : {} }))
    const call = createJiraRestCaller({ url: 'https://j.x', email: '' }, 'tok', f)
    expect(JSON.parse(await call('jira_search', { jql: 'project = P4', fields: 'summary', max_results: 100, start_at: 0 })).issues[0].key).toBe('P4-1')
    expect(calls[0].url).toBe('https://j.x/rest/api/2/search?jql=project+%3D+P4&maxResults=100&startAt=0&fields=summary')
    expect(calls[0].auth).toBe('Bearer tok')
    await call('jira_get_transitions', { issue_key: 'P4-1' })
    await call('jira_transition_issue', { issue_key: 'P4-1', transition_id: '31', comment: 'shipped' })
    expect(calls[2]).toMatchObject({ method: 'POST', url: 'https://j.x/rest/api/2/issue/P4-1/transitions', body: { transition: { id: '31' }, update: { comment: [{ add: { body: 'shipped' } }] } } })
    await call('jira_add_comment', { issue_key: 'P4-1', comment: 'hi' })
    expect(calls[3]).toMatchObject({ method: 'POST', url: 'https://j.x/rest/api/2/issue/P4-1/comment', body: { body: 'hi' } })
    await call('jira_update_issue', { issue_key: 'P4-1', assignee: 'arvin.liu' })
    expect(calls[4]).toMatchObject({ method: 'PUT', url: 'https://j.x/rest/api/2/issue/P4-1/assignee', body: { name: 'arvin.liu' } })
    await call('jira_get_issue', { issue_key: 'P4-1', fields: 'assignee', expand: 'changelog' })
    expect(calls[5].url).toBe('https://j.x/rest/api/2/issue/P4-1?fields=assignee&expand=changelog')
  })
  it('refuses bad keys and unknown tools; a Jira error is an error, not data', async () => {
    const { f } = fakeFetch(() => ({ status: 401, body: { errorMessages: ['nope'] } }))
    const call = createJiraRestCaller({ url: 'https://j.x', email: '' }, 'tok', f)
    await expect(call('jira_get_issue', { issue_key: 'p4-1; DROP' })).rejects.toThrow('bad issue key')
    await expect(call('jira_delete_issue', { issue_key: 'P4-1' })).rejects.toThrow('not available over Jira REST')
    await expect(call('jira_get_user_profile', {})).rejects.toThrow('Jira 401')
  })
  it('auto: Stargate first, else REST with a saved token; mcp mode never falls back', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hive-jira-conn-'))
    const store = createJiraConnectionStore(folder, plain)
    const noClaude = join(folder, 'no-claude.json')
    expect(butlerJiraCall(folder, noClaude, store)).toBeNull()
    store.save({ mode: 'auto', url: 'https://j.x' }, 'tok')
    expect(store.hasToken()).toBe(true)
    expect(butlerJiraCall(folder, noClaude, store)?.via).toBe('rest')
    store.save({ mode: 'mcp', url: 'https://j.x' })
    expect(butlerJiraCall(folder, noClaude, store)).toBeNull()
    store.save({ mode: 'rest', url: 'https://j.x' }, null)
    expect(store.hasToken()).toBe(false)
    expect(butlerJiraCall(folder, noClaude, store)).toBeNull()
  })
})
