import { describe, it, expect } from 'vitest'
import { orderSessions, sessionCounts, type SessionRow } from '../butler-sessions'

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
