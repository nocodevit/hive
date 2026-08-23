// @vitest-environment jsdom
//
// OverviewPage tests — covers the derived-state slicing (working vs
// open-sessions vs sleeping) and the interactive callbacks (Close session,
// Close-all-idle, Open agent). The presentational bits (SectionCard,
// StatusPill, KpiCard) are exercised indirectly via the section renders.

import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { OverviewPage } from '../OverviewPage'
import type { Agent, Project } from '../../types'

afterEach(() => cleanup())

// Stub AvatarPreview so we don't have to instantiate the real component;
// this test file only cares about the OverviewPage's own logic.
vi.mock('../AvatarEditor', () => ({
  AvatarPreview: ({ size }: { size: number }) => (
    <div data-testid="avatar" style={{ width: size, height: size }} />
  ),
}))

const makeProject = (id: string, name: string): Project => ({
  id, name, officePath: '/tmp/' + id, zones: [], group: undefined,
} as any)

const makeAgent = (over: Partial<Agent>): Agent => ({
  id: 'a-' + Math.random().toString(36).slice(2, 8),
  projectId: 'p1',
  zoneId: 'z1',
  name: 'Agent',
  role: 'coder',
  type: 'human',
  department: 'eng',
  group: 'default',
  order: 0,
  status: 'waiting',
  soul: '',
  avatar: {} as any,
  enabledSkills: [],
  preferences: {} as any,
  model: 'inherit',
  effort: 'high',
  ...over,
} as any)

const noop = () => {}

beforeEach(() => {
  ;(window as any).confirm = vi.fn(() => true)  // auto-accept confirms
})

describe('OverviewPage', () => {
  it('renders the four KPI cards with correct counts', () => {
    const projects = [makeProject('p1', 'Proj 1'), makeProject('p2', 'Proj 2')]
    const agents = [
      makeAgent({ id: 'w1', projectId: 'p1', status: 'working' }),
      makeAgent({ id: 'w2', projectId: 'p1', status: 'working' }),
      makeAgent({ id: 'i1', projectId: 'p1', status: 'waiting' }),
      makeAgent({ id: 's1', projectId: 'p2', status: 'done' }),
    ]
    render(
      <OverviewPage
        projects={projects}
        agents={agents}
        activeTerminals={new Set(['w1', 'w2', 'i1'])}   // 3 open sessions
        activeHandoffAgentIds={new Set(['w1'])}
        agentTasks={{}}
        onOpenAgent={noop}
        onCloseSession={noop}
      />
    )
    // KPI cards live in a specific grid; scope lookups to it so the
    // "Projects" section header down below doesn't collide with the KPI.
    const kpiScope = document.querySelector('.grid.grid-cols-4') as HTMLElement
    expect(kpiScope).not.toBeNull()
    const cards = kpiScope.querySelectorAll(':scope > *')
    // Cards render in order: Projects, Agents, Open sessions, Handoffs.
    expect(within(cards[0] as HTMLElement).getByText('2')).toBeInTheDocument()
    expect(within(cards[1] as HTMLElement).getByText('4')).toBeInTheDocument()
    expect(within(cards[2] as HTMLElement).getByText('3')).toBeInTheDocument()
    expect(within(cards[3] as HTMLElement).getByText('1')).toBeInTheDocument()
    // Descriptive sub-lines
    expect(screen.getByText(/2 working now/)).toBeInTheDocument()
    expect(screen.getByText(/1 sleeping/)).toBeInTheDocument()
  })

  it('lists working agents in Working now section', () => {
    const agents = [
      makeAgent({ id: 'w1', name: 'Alice', status: 'working' }),
      makeAgent({ id: 'w2', name: 'Bob', status: 'waiting' }),
    ]
    render(
      <OverviewPage
        projects={[makeProject('p1', 'P')]}
        agents={agents}
        activeTerminals={new Set()}
        activeHandoffAgentIds={new Set()}
        agentTasks={{ w1: { title: 'building X', active: true } }}
        onOpenAgent={noop}
        onCloseSession={noop}
      />
    )
    // The Working now count chip is next to the "Working now" heading.
    const workingHeader = screen.getByText('Working now').parentElement!
    expect(within(workingHeader).getByText('1')).toBeInTheDocument()
    // Current in-flight task title should surface — this text only appears
    // inside the Working now section (agentTasks doesn't render elsewhere).
    expect(screen.getByText('building X')).toBeInTheDocument()
    // Alice appears in Working now AND in the Projects grid avatar row —
    // just assert at least once (not exactly one).
    const aliceHits = screen.queryAllByText('Alice')
    expect(aliceHits.length).toBeGreaterThan(0)
  })

  it('Close session button calls onCloseSession only for idle-open agents', () => {
    const onCloseSession = vi.fn()
    const agents = [
      makeAgent({ id: 'working-1', name: 'Working One', status: 'working' }),
      makeAgent({ id: 'idle-1', name: 'Idle One', status: 'waiting' }),
      makeAgent({ id: 'idle-2', name: 'Idle Two', status: 'done' }),
    ]
    render(
      <OverviewPage
        projects={[makeProject('p1', 'P')]}
        agents={agents}
        activeTerminals={new Set(['working-1', 'idle-1', 'idle-2'])}
        activeHandoffAgentIds={new Set()}
        agentTasks={{}}
        onOpenAgent={noop}
        onCloseSession={onCloseSession}
      />
    )
    // Working agent must NOT have a Close button (only idle ones do)
    const closeButtons = screen.getAllByRole('button', { name: /^Close$/ })
    expect(closeButtons).toHaveLength(2)
    fireEvent.click(closeButtons[0])
    expect(onCloseSession).toHaveBeenCalledTimes(1)
    // Must be one of the idle ids, never the working one
    expect(onCloseSession.mock.calls[0][0]).not.toBe('working-1')
  })

  it('Close N idle button batch-closes only idle-open agents', () => {
    const onCloseSession = vi.fn()
    const agents = [
      makeAgent({ id: 'w1', status: 'working' }),
      makeAgent({ id: 'i1', status: 'waiting' }),
      makeAgent({ id: 'i2', status: 'done' }),
    ]
    render(
      <OverviewPage
        projects={[makeProject('p1', 'P')]}
        agents={agents}
        activeTerminals={new Set(['w1', 'i1', 'i2'])}
        activeHandoffAgentIds={new Set()}
        agentTasks={{}}
        onOpenAgent={noop}
        onCloseSession={onCloseSession}
      />
    )
    const batchBtn = screen.getByRole('button', { name: /Close 2 idle/ })
    fireEvent.click(batchBtn)
    expect(onCloseSession).toHaveBeenCalledTimes(2)
    const closedIds = onCloseSession.mock.calls.map((c) => c[0]).sort()
    expect(closedIds).toEqual(['i1', 'i2'])
  })

  it('Sleeping agents section shows agents without a mounted terminal', () => {
    const agents = [
      makeAgent({ id: 'open', name: 'Opened', status: 'waiting' }),
      makeAgent({ id: 'zzz', name: 'Zzz', status: 'waiting' }),
    ]
    render(
      <OverviewPage
        projects={[makeProject('p1', 'P')]}
        agents={agents}
        activeTerminals={new Set(['open'])}
        activeHandoffAgentIds={new Set()}
        agentTasks={{}}
        onOpenAgent={noop}
        onCloseSession={noop}
      />
    )
    const sleepingSection = screen.getByText('Sleeping agents').parentElement!
    expect(within(sleepingSection).getByText('1')).toBeInTheDocument()
    // Zzz appears somewhere on the page (Sleeping row + Projects grid tooltip).
    // "Opened" appears in Projects grid too but we're asserting only that
    // Zzz renders — the Sleeping count of 1 already proves the split.
    expect(screen.getAllByText('Zzz').length).toBeGreaterThan(0)
  })

  it('clicking a sleeping agent triggers onOpenAgent', () => {
    const onOpenAgent = vi.fn()
    const agent = makeAgent({ id: 'zzz', name: 'Wake Me' })
    render(
      <OverviewPage
        projects={[makeProject('p1', 'P')]}
        agents={[agent]}
        activeTerminals={new Set()}
        activeHandoffAgentIds={new Set()}
        agentTasks={{}}
        onOpenAgent={onOpenAgent}
        onCloseSession={noop}
      />
    )
    fireEvent.click(screen.getByText('Wake Me'))
    expect(onOpenAgent).toHaveBeenCalledWith(agent)
  })
})
