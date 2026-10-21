import { describe, it, expect } from 'vitest'
import { historyDiscussText } from '../ApprovalsList'

describe('historyDiscussText', () => {
  it('carries the outcome, their message and what went out', () => {
    const t = historyDiscussText({
      id: '1', kind: 'feishu.reply', title: 'Gary · roaming', subtitle: 'Feishu reply', draft: 'Yes, Contoso is live.',
      payload: { chatName: 'Ops', question: 'Is Contoso roaming live?' }, status: 'approved', createdAt: 1, resolvedAt: 2
    })
    expect(t).toContain('Do not send or change anything until I confirm.')
    expect(t).toContain('Outcome: Done')
    expect(t).toContain('Feishu chat: Ops')
    expect(t).toContain('--- their message ---\nIs Contoso roaming live?')
    expect(t).toContain('--- what was sent ---\nYes, Contoso is live.')
  })
  it('a failed Jira card says what was proposed and why it failed', () => {
    const t = historyDiscussText({ id: '2', kind: 'jira.fix', title: 'DEV-1 → Done', subtitle: 'Jira', draft: 'Shipped', payload: { key: 'DEV-1' }, status: 'failed', createdAt: 1, error: 'no transition' })
    expect(t).toContain('Outcome: Failed')
    expect(t).toContain('error: no transition')
    expect(t).toContain('Jira: DEV-1')
    expect(t).toContain('--- what butler proposed ---')
  })
})
