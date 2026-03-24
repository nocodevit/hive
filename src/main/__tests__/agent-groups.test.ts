import { describe, it, expect } from 'vitest'

interface Agent {
  id: string
  name: string
  department: string
  group: string
  order: number
}

function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => (a.order || 0) - (b.order || 0))
}

function groupAgentsByDeptAndGroup(agents: Agent[]) {
  const sorted = sortAgents(agents)
  const result: Record<string, Record<string, Agent[]>> = {}
  for (const a of sorted) {
    if (!result[a.department]) result[a.department] = {}
    const grp = a.group || ''
    if (!result[a.department][grp]) result[a.department][grp] = []
    result[a.department][grp].push(a)
  }
  return result
}

function reorderAgents(agents: Agent[], dragId: string, targetId: string): Agent[] {
  const dragged = agents.find((a) => a.id === dragId)
  const target = agents.find((a) => a.id === targetId)
  if (!dragged || !target) return agents
  return agents.map((a) => {
    if (a.id === dragId) return { ...a, order: target.order, group: target.group }
    if (a.id === targetId) return { ...a, order: dragged.order }
    return a
  })
}

describe('Agent grouping', () => {
  const agents: Agent[] = [
    { id: '1', name: 'David', department: 'R&D', group: 'Frontend', order: 1 },
    { id: '2', name: 'Daisy', department: 'R&D', group: 'Frontend', order: 2 },
    { id: '3', name: 'Alex', department: 'R&D', group: 'Backend', order: 3 },
    { id: '4', name: 'Tracy', department: 'Non-R&D', group: '', order: 4 },
  ]

  it('sorts agents by order', () => {
    const shuffled = [agents[2], agents[0], agents[3], agents[1]]
    const sorted = sortAgents(shuffled)
    expect(sorted.map((a) => a.name)).toEqual(['David', 'Daisy', 'Alex', 'Tracy'])
  })

  it('groups by department then group', () => {
    const grouped = groupAgentsByDeptAndGroup(agents)
    expect(Object.keys(grouped)).toEqual(['R&D', 'Non-R&D'])
    expect(Object.keys(grouped['R&D'])).toEqual(['Frontend', 'Backend'])
    expect(grouped['R&D']['Frontend'].map((a) => a.name)).toEqual(['David', 'Daisy'])
    expect(grouped['R&D']['Backend'].map((a) => a.name)).toEqual(['Alex'])
  })

  it('ungrouped agents use empty string key', () => {
    const grouped = groupAgentsByDeptAndGroup(agents)
    expect(grouped['Non-R&D']['']).toHaveLength(1)
    expect(grouped['Non-R&D'][''][0].name).toBe('Tracy')
  })

  it('reorder swaps order values', () => {
    const result = reorderAgents(agents, '1', '3')
    const david = result.find((a) => a.id === '1')!
    const alex = result.find((a) => a.id === '3')!
    expect(david.order).toBe(3)
    expect(alex.order).toBe(1)
  })

  it('reorder moves agent to target group', () => {
    const result = reorderAgents(agents, '1', '3')
    const david = result.find((a) => a.id === '1')!
    expect(david.group).toBe('Backend')
  })

  it('reorder with nonexistent id returns unchanged', () => {
    const result = reorderAgents(agents, 'nope', '1')
    expect(result).toEqual(agents)
  })
})
