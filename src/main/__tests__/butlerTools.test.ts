import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { allowFromTools, claudeJsonPath, discoverTools, discoveredWrites, httpServers, isReadTool, jiraTools, mcpServerNames, readToolCache } from '../butlerTools'

const tmp = () => mkdtempSync(join(tmpdir(), 'hive-butler-tools-'))

describe('butler tools', () => {
  it('finds MCP servers in ~/.claude.json (top level + the Butler project) and <butler>/.mcp.json', () => {
    const d = tmp()
    const folder = join(d, 'butler')
    const cj = join(d, 'claude.json')
    writeFileSync(cj, JSON.stringify({ mcpServers: { stargate: {} }, projects: { [folder]: { mcpServers: { local1: {} } }, '/other': { mcpServers: { nope: {} } } } }))
    expect(mcpServerNames(folder, cj)).toEqual(['stargate', 'local1'])
    expect(mcpServerNames(folder, join(d, 'missing.json'))).toEqual([])
  })
  it('discovered jira server → its read tools; jira/atlassian config → whole server; none → null', () => {
    const d = tmp()
    const cj = join(d, 'claude.json')
    writeFileSync(join(d, 'tools-cache.json'), JSON.stringify({ at: 1, servers: { stargate: ['jira_search', 'jira_add_comment', 'kg_rag_search'] } }))
    expect(jiraTools(d, cj)).toEqual({ server: 'stargate', read: ['mcp__stargate__jira_search', 'mcp__stargate__kg_rag_search'] })
    const e = tmp()
    writeFileSync(cj, JSON.stringify({ mcpServers: { atlassian: {} } }))
    expect(jiraTools(e, cj)).toEqual({ server: 'atlassian', read: ['mcp__atlassian'] })
    writeFileSync(cj, '{}')
    expect(jiraTools(e, cj)).toBeNull()
  })
  it('read vs write by the first verb in the name, whole words', () => {
    for (const t of ['jira_search', 'jira_get_link_types', 'jira_get_transitions', 'eagle_list_assets', 'kg_relation_path', 'kg_impact_analysis', 'jira_batch_get_changelogs', 'getBuildChangeSets', 'mno_matrix', 'feishu_lookup_user']) expect(isReadTool(t)).toBe(true)
    for (const t of ['jira_add_comment', 'jira_transition_issue', 'jira_delete_issue', 'feishu_write_markdown', 'gitlab_approve_mr', 'triggerBuild', 'kg_rag_ingest', 'sr_submit_release', 'mystery_tool']) expect(isReadTool(t)).toBe(false)
  })
  it('allow-list per server: its reads + the Jira writes handle-jira uses', () => {
    expect(allowFromTools('sg', ['jira_search', 'jira_add_comment', 'jira_delete_issue', 'gitlab_approve_mr'])).toEqual(['mcp__sg__jira_search', 'mcp__sg__jira_add_comment'])
  })
  it('discovers HTTP servers with the owner\'s own headers; a failing one keeps its last list', async () => {
    const d = tmp()
    const cj = join(d, 'claude.json')
    writeFileSync(cj, JSON.stringify({ mcpServers: { sg: { type: 'http', url: 'https://sg/mcp', headers: { Authorization: 'Bearer x' } }, local: { command: 'node' }, down: { type: 'http', url: 'https://down/mcp' } } }))
    expect(Object.keys(httpServers(cj))).toEqual(['sg', 'down'])
    writeFileSync(join(d, 'tools-cache.json'), JSON.stringify({ at: 1, servers: { down: ['jira_search'] } }))
    const seen: Array<Record<string, string>> = []
    const c = await discoverTools(d, cj, async s => { seen.push(s.headers); if (s.url.includes('down')) throw new Error('offline'); return ['jira_search', 'jira_add_comment'] }, 5)
    expect(c).toEqual({ at: 5, servers: { sg: ['jira_search', 'jira_add_comment'], down: ['jira_search'] } })
    expect(seen[0]).toEqual({ Authorization: 'Bearer x' })
    expect(readToolCache(d).servers.sg).toEqual(['jira_search', 'jira_add_comment'])
    expect(discoveredWrites(d)).toEqual(['mcp__sg__jira_add_comment'])
    const off = join(d, 'butler-not-created')
    await discoverTools(off, cj, async () => ['jira_search'])
    expect(existsSync(off)).toBe(false)
  })
  it('honours CLAUDE_CONFIG_DIR', () => {
    expect(claudeJsonPath('/h', {})).toBe('/h/.claude.json')
    expect(claudeJsonPath('/h', { CLAUDE_CONFIG_DIR: '/c' })).toBe('/c/.claude.json')
  })
})
