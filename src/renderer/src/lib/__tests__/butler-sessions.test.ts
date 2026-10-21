import { describe, it, expect } from 'vitest'
import { orderSessions, sessionCounts, sinceLabel, type SessionRow } from '../butler-sessions'

const row = (agent: string, project: string, activity: SessionRow['activity']): SessionRow =>
  ({ agentId: `${project}/${agent}`, agent, projectId: project, project, activity })

describe('orderSessions', () => {
  it('waiting first, then working, then off; by project then name inside each', () => {
    const out = orderSessions([
      row('Bolt', 'sphere2', 'off'), row('Missy', 'Cube', 'working'), row('Quinn', 'Cube', 'waiting'),
      row('Ada', 'Hive', 'working'), row('Zed', 'Cube', 'waiting')
    ])
    expect(out.map(r => r.agent)).toEqual(['Quinn', 'Zed', 'Missy', 'Ada', 'Bolt'])
  })
  it('newest chat activity first inside each status', () => {
    const out = orderSessions([
      { ...row('Old', 'Cube', 'off'), updatedAt: 100 }, { ...row('New', 'Zed', 'off'), updatedAt: 900 },
      row('Never', 'Alpha', 'off'), { ...row('Q', 'Cube', 'waiting'), updatedAt: 1 }
    ])
    expect(out.map(r => r.agent)).toEqual(['Q', 'New', 'Old', 'Never'])
  })
  it('since labels', () => {
    const now = 10 * 86400000
    expect(sinceLabel(0, now)).toBe('')
    expect(sinceLabel(now - 20000, now)).toBe('now')
    expect(sinceLabel(now - 5 * 60000, now)).toBe('5m')
    expect(sinceLabel(now - 3 * 3600000, now)).toBe('3h')
    expect(sinceLabel(now - 2 * 86400000, now)).toBe('2d')
  })
  it('does not mutate its input', () => {
    const input = [row('B', 'p', 'off'), row('A', 'p', 'waiting')]
    orderSessions(input)
    expect(input.map(r => r.agent)).toEqual(['B', 'A'])
  })
})

describe('sessionCounts', () => {
  it('counts each activity', () => {
    expect(sessionCounts([row('a', 'p', 'off'), row('b', 'p', 'off'), row('c', 'p', 'waiting')]))
      .toEqual({ working: 0, waiting: 1, off: 2 })
  })
  it('all zero when empty', () => {
    expect(sessionCounts([])).toEqual({ working: 0, waiting: 0, off: 0 })
  })
})
