import { describe, it, expect } from 'vitest'
import { fromForm, toForm } from '../JiraSettings'

describe('Jira settings form', () => {
  it('round-trips without losing statuses, the design path or owners', () => {
    const s = {
      requests: { FAE: { final: '完成', closed: ['Rejected'], analysis: ['需求分析'], designPath: ['需求分析评审', '需求设计'], waitingReporter: '' }, LFCS: { final: 'Resolved', closed: ['Closed', 'Rejected'], analysis: [], designPath: [], waitingReporter: 'Under Validation' } },
      product: { key: 'P4', done: ['Released', 'Done'] }, dev: { key: 'PR', lead: 'arvin' },
      owners: [{ name: 'Bill', user: 'bill@x', labels: ['BILLS'], projects: [] }],
      keepFrom: ['dan'], parked: ['Stashed'],
      stale: { active: { 'In Review': 7, 'In Progress': 14, Blocked: 7 }, waitingDays: 30, deadDays: 90 },
      projectNotes: { FAE: 'requests' }, labelNotes: 'x', notes: 'y'
    }
    const back = fromForm(toForm(s))
    expect(back.requests).toEqual(s.requests)
    expect(back.product).toEqual(s.product)
    expect(back.dev).toEqual(s.dev)
    expect(back.owners).toEqual(s.owners)
    expect(back.stale).toEqual(s.stale)
    expect(back.projectNotes).toEqual(s.projectNotes)
  })
  it('an empty form has no product project (main refuses it)', () => {
    expect(fromForm(toForm(null)).product.key).toBe('')
  })
})
