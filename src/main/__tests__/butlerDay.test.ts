import { describe, it, expect } from 'vitest'
import { butlerDayText, waitingLines } from '../butlerDay'

describe('Butler today', () => {
  const since = 1000
  it('counts today only, exact numbers', () => {
    const cases = [
      { at: 500, outcome: 'auto', category: 'chitchat-work', reasons: [] },
      { at: 1100, outcome: 'auto', category: 'product-status', reasons: [] },
      { at: 1200, outcome: 'auto', category: 'meeting', reasons: ['created: 明天 16:00'] },
      { at: 1300, outcome: 'acknowledged', category: 'acknowledgement', reasons: [] },
      { at: 1400, outcome: 'pending', category: 'product-status', reasons: [] },
      { at: 1500, outcome: 'edited', category: 'product-status', reasons: [] }
    ]
    const approvals = [
      { kind: 'email.reply', title: 'a', status: 'pending', createdAt: 1100 },
      { kind: 'jira.comment', title: 'b', status: 'approved', createdAt: 1150, resolvedAt: 1600 },
      { kind: 'email.reply', title: 'old', status: 'pending', createdAt: 10 }
    ]
    expect(butlerDayText(cases, approvals, since)).toBe([
      '- Feishu: answered 1 · meetings created 1 · 👍 1 · passed to you 2 (1 still waiting)',
      '- Email: 1 replies drafted',
      '- Jira: 1 cards for you',
      '- You approved 1 today'
    ].join('\n'))
    expect(butlerDayText([], [], since)).toBe('')
  })
  it('waiting: pending approvals, oldest first', () => {
    expect(waitingLines([
      { kind: 'jira.fix', title: 'FAE-1 → 完成', status: 'pending', createdAt: 2 },
      { kind: 'email.decide', title: 'Gary · Claro', status: 'pending', createdAt: 1 },
      { kind: 'email.reply', title: 'done', status: 'approved', createdAt: 0 }
    ])).toEqual(['Gary · Claro (email.decide)', 'FAE-1 → 完成 (jira.fix)'])
  })
})
