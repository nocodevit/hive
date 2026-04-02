import { describe, it, expect } from 'vitest'
import { findTaskGroupForAgentInData, findAgentCwd, formatHiveMessage } from '../helpers'
import type { TaskGroupData, AgentData, ProjectData } from '../helpers'

const tg: TaskGroupData = {
  id: 'tg-1', projectId: 'proj-1',
  managerId: 'a1', workerIds: ['a2', 'a3'], qaId: 'a4', criticId: 'a5',
  maxGateRetries: 3
}

describe('findTaskGroupForAgentInData', () => {
  it('finds task group for manager', () => {
    const result = findTaskGroupForAgentInData('a1', [tg])
    expect(result).not.toBeNull()
    expect(result!.projectId).toBe('proj-1')
    expect(result!.taskGroup.managerId).toBe('a1')
  })

  it('finds task group for worker', () => {
    expect(findTaskGroupForAgentInData('a2', [tg])?.taskGroup.id).toBe('tg-1')
    expect(findTaskGroupForAgentInData('a3', [tg])?.taskGroup.id).toBe('tg-1')
  })

  it('finds task group for QA', () => {
    expect(findTaskGroupForAgentInData('a4', [tg])?.taskGroup.id).toBe('tg-1')
  })

  it('finds task group for critic', () => {
    expect(findTaskGroupForAgentInData('a5', [tg])?.taskGroup.id).toBe('tg-1')
  })

  it('returns null for unknown agent', () => {
    expect(findTaskGroupForAgentInData('a99', [tg])).toBeNull()
  })

  it('returns null for empty task groups', () => {
    expect(findTaskGroupForAgentInData('a1', [])).toBeNull()
  })

  it('searches multiple task groups', () => {
    const tg2: TaskGroupData = { ...tg, id: 'tg-2', projectId: 'proj-2', managerId: 'a10', workerIds: ['a11'], qaId: 'a12', criticId: 'a13' }
    expect(findTaskGroupForAgentInData('a11', [tg, tg2])?.taskGroup.id).toBe('tg-2')
  })
})

const agents: AgentData[] = [
  { id: 'a1', projectId: 'p1', zoneId: 'z1', worktreePath: '/worktree/a1' },
  { id: 'a2', projectId: 'p1', zoneId: 'z1' },
  { id: 'a3', projectId: 'p2', zoneId: 'z2' },
]

const projects: ProjectData[] = [
  { id: 'p1', zones: [{ id: 'z1', path: '/projects/app' }] },
  { id: 'p2', zones: [{ id: 'z2', path: '/projects/docs' }] },
]

describe('findAgentCwd', () => {
  it('returns worktree path when available', () => {
    expect(findAgentCwd('a1', agents, projects)).toBe('/worktree/a1')
  })

  it('falls back to zone path when no worktree', () => {
    expect(findAgentCwd('a2', agents, projects)).toBe('/projects/app')
  })

  it('returns correct zone for different project', () => {
    expect(findAgentCwd('a3', agents, projects)).toBe('/projects/docs')
  })

  it('returns null for unknown agent', () => {
    expect(findAgentCwd('a99', agents, projects)).toBeNull()
  })

  it('returns null when project has no matching zone', () => {
    const badAgents: AgentData[] = [{ id: 'a1', projectId: 'p1', zoneId: 'z999' }]
    expect(findAgentCwd('a1', badAgents, projects)).toBeNull()
  })
})

describe('formatHiveMessage', () => {
  it('formats TASK message', () => {
    const msg = formatHiveMessage('TASK', { id: 'task-001', title: 'Fix bug' })
    expect(msg).toBe('[HIVE:TASK] {"type":"TASK","id":"task-001","title":"Fix bug"}\r')
  })

  it('formats MSG message', () => {
    const msg = formatHiveMessage('MSG', { task: 'task-001', status: 'done' })
    expect(msg).toContain('[HIVE:MSG]')
    expect(msg).toContain('"status":"done"')
    expect(msg.endsWith('\r')).toBe(true)
  })

  it('formats HUMAN message', () => {
    const msg = formatHiveMessage('HUMAN', { content: 'stop working' })
    expect(msg).toContain('[HIVE:HUMAN]')
    expect(msg).toContain('stop working')
  })

  it('uppercases type in prefix', () => {
    const msg = formatHiveMessage('batch', { n: 1 })
    expect(msg).toContain('[HIVE:BATCH]')
  })

  it('includes type in JSON payload', () => {
    const parsed = JSON.parse(formatHiveMessage('TASK', { x: 1 }).replace('[HIVE:TASK] ', '').replace('\r', ''))
    expect(parsed.type).toBe('TASK')
    expect(parsed.x).toBe(1)
  })
})
