import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { normalizeJiraSettings, parseDiscovery, readJiraSettings, renderJiraMd, writeJiraSettings } from '../butlerJiraSettings'

const raw = {
  requests: { REQ: { final: 'Done', closed: ['Rejected'], analysis: ['Analysis'], designPath: ['Review', 'Design'] }, bad: { final: 'x' }, SUP: { final: '' } },
  product: { key: 'PROD', done: ['Released'] },
  dev: { key: 'DEV', lead: 'lead@x' },
  owners: [{ name: 'Bill', user: 'bill@x', labels: ['billing'] }, { name: 'Nobody', user: 'n@x' }],
  stale: { active: { 'In Review': 7 }, waitingDays: 30, deadDays: 90 },
  projectNotes: { REQ: 'requests from sales' }, labelNotes: 'billing = finance team'
}

describe('Butler settings › Jira', () => {
  it('keeps valid projects / owners only; no product project → refused', () => {
    const s = normalizeJiraSettings(raw)!
    expect(Object.keys(s.requests)).toEqual(['REQ'])
    expect(s.requests.REQ.designPath).toEqual(['Review', 'Design'])
    expect(s.owners).toEqual([{ labels: ['billing'], user: 'bill@x', name: 'Bill' }])
    expect(normalizeJiraSettings({ ...raw, product: { key: '' } })).toBeNull()
  })
  it('jira.md says the projects, flow, owners and labels; saving writes both files', () => {
    const md = renderJiraMd(normalizeJiraSettings(raw)!)
    expect(md).toContain('| REQ | request | Done (also closed: Rejected) | requests from sales |')
    expect(md).toContain('After the PROD issue exists, REQ moves through: Review → Design.')
    expect(md).toContain('DEV content is never quoted. Dev lead: lead@x.')
    expect(md).toContain('- Bill (bill@x): billing')
    expect(md).toContain('billing = finance team')
    const d = mkdtempSync(join(tmpdir(), 'hive-jset-'))
    expect(writeJiraSettings(d, raw)).not.toBeNull()
    expect(readJiraSettings(d)!.product.key).toBe('PROD')
    expect(readFileSync(join(d, 'jira.md'), 'utf8')).toContain('# Jira (Butler settings)')
    expect(writeJiraSettings(mkdtempSync(join(tmpdir(), 'hive-jset-')), { product: {} })).toBeNull()
  })
  it('a discovery draft is parsed and normalized, never saved', () => {
    const d = mkdtempSync(join(tmpdir(), 'hive-jset-'))
    expect(parseDiscovery('Here: ' + JSON.stringify(raw) + ' done')!.product.key).toBe('PROD')
    expect(parseDiscovery('no json')).toBeNull()
    expect(existsSync(join(d, 'jira-config.json'))).toBe(false)
  })
})
