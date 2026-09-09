import { describe, it, expect } from 'vitest'
import { NUDGE_MESSAGE, nudgeTargets } from '../nudge'

const agents = [
  { id: 'a', projectId: 'p1' },
  { id: 'b', projectId: 'p1' },
  { id: 'c', projectId: 'p2' }, // other project
  { id: 'd', projectId: 'p1' }
]

describe('nudgeTargets', () => {
  it('returns only same-project agents with an active session', () => {
    const active = new Set(['a', 'd', 'c'])
    // b is p1 but not active; c is active but wrong project.
    expect(nudgeTargets(agents, 'p1', (id) => active.has(id))).toEqual(['a', 'd'])
  })

  it('is empty when no agent in the project is active', () => {
    expect(nudgeTargets(agents, 'p1', () => false)).toEqual([])
  })

  it('is empty for a project with no agents', () => {
    expect(nudgeTargets(agents, 'nope', () => true)).toEqual([])
  })
})

describe('NUDGE_MESSAGE', () => {
  it('is a non-empty, directive continue message', () => {
    expect(NUDGE_MESSAGE.length).toBeGreaterThan(0)
    expect(NUDGE_MESSAGE.toLowerCase()).toContain('continue')
  })
})
