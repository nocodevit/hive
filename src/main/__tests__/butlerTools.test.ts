import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeJsonPath, jiraTools, mcpServerNames, STARGATE_READ } from '../butlerTools'

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
  it('stargate → read-only tools; jira/atlassian → whole server; none → null', () => {
    const d = tmp()
    const cj = join(d, 'claude.json')
    writeFileSync(cj, JSON.stringify({ mcpServers: { stargate: {}, jira: {} } }))
    expect(jiraTools(d, cj)).toEqual({ server: 'stargate', read: STARGATE_READ })
    writeFileSync(cj, JSON.stringify({ mcpServers: { atlassian: {} } }))
    expect(jiraTools(d, cj)).toEqual({ server: 'atlassian', read: ['mcp__atlassian'] })
    writeFileSync(cj, '{}')
    expect(jiraTools(d, cj)).toBeNull()
  })
  it('the stargate list has no write tools', () => {
    expect(STARGATE_READ.every(t => t.startsWith('mcp__stargate__'))).toBe(true)
    expect(STARGATE_READ.some(t => /create|update|transition_issue|add_comment|delete|assign|write|append|upload|link_to|remove/.test(t))).toBe(false)
  })
  it('honours CLAUDE_CONFIG_DIR', () => {
    expect(claudeJsonPath('/h', {})).toBe('/h/.claude.json')
    expect(claudeJsonPath('/h', { CLAUDE_CONFIG_DIR: '/c' })).toBe('/c/.claude.json')
  })
})
