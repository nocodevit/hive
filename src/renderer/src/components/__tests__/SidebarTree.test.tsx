// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

vi.mock('../AvatarEditor', () => ({ AvatarPreview: () => <canvas /> }))
import { SidebarTree, type SidebarTreeProps } from '../SidebarTree'

afterEach(() => cleanup())
beforeEach(() => { try { localStorage.clear() } catch { /* */ } })

const proj = (id: string, name: string, group?: string) => ({ id, name, group, zones: [] }) as any
const ag = (id: string, name: string, projectId: string, status: 'working' | 'waiting' | 'done', department = 'R&D') =>
  ({ id, name, projectId, status, department, group: '', order: 0, role: 'Engineering', avatar: {} }) as any

function setup(over: Partial<SidebarTreeProps> = {}) {
  const props: SidebarTreeProps = {
    version: '9.9.9', width: 264, themeToggle: null,
    projects: [proj('p1', 'Hive'), proj('p2', 'Garden'), proj('p3', 'Sphere', 'Work')],
    setProjects: vi.fn(),
    agents: [ag('a1', 'Bob', 'p1', 'working'), ag('a2', 'Daisy', 'p1', 'waiting'), ag('a3', 'Gus', 'p2', 'waiting'), ag('a4', 'Atlas', 'p3', 'done')],
    setAgents: vi.fn(), listState: 'list',
    selectedProjectId: 'p1', selectedAgentId: null,
    onSelectProject: vi.fn(), onSelectAgent: vi.fn(),
    butler: { waiting: 2, pageOpen: false, pinned: false, onOpen: vi.fn(), onClose: vi.fn() },
    overview: { active: false, onToggle: vi.fn() },
    onAddProject: vi.fn(), onNewAgent: vi.fn(), onSettings: vi.fn(),
    collapsedGroups: new Set(), setCollapsedGroups: vi.fn(),
    onProjectMenu: vi.fn(), onAgentMenu: vi.fn(), onEditAgent: vi.fn(), onDeleteAgent: vi.fn(), onAddTeam: vi.fn(),
    lastEventAt: {}, nowTick: Date.now(), busyAgentIds: new Set(),
    ...over
  }
  render(<SidebarTree {...props} />)
  return props
}

describe('Sidebar tree', () => {
  it('Butler (with how many wait for you) and Overview sit above the projects', () => {
    const p = setup()
    const butler = screen.getByRole('button', { name: 'Open Butler page' })
    expect(butler.textContent).toContain('2')
    fireEvent.click(butler)
    expect(p.butler.onOpen).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Overview$/ }))
    expect(p.overview.onToggle).toHaveBeenCalled()
    expect(butler.compareDocumentPosition(screen.getByRole('button', { name: 'Collapse Hive' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the selected project and a project with an agent waiting start open; all-off starts closed', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Collapse Hive' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Collapse Garden' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expand Sphere' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Atlas' })).toBeNull()
    const hive = screen.getByRole('group', { name: 'Hive agents' })
    expect(within(hive).getByText('needs you')).toBeTruthy()
    expect(within(hive).getByText('working')).toBeTruthy()
    expect(within(hive).getByRole('button', { name: 'New Agent' })).toBeTruthy()
  })

  it('the chevron opens a project in place and remembers it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sphere' }))
    expect(screen.getByRole('button', { name: 'Atlas' })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('hive.sidebar.open')!)).toEqual({ p3: true })
    cleanup()
    setup()
    expect(screen.getByRole('button', { name: 'Atlas' })).toBeTruthy()
  })

  it('clicking an agent selects it; clicking another project selects that project', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Gus' }))
    expect(p.onSelectAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'a3' }))
    fireEvent.click(screen.getByText('Sphere'))
    expect(p.onSelectProject).toHaveBeenCalledWith('p3')
  })

  it('a project shows amber/green counts; ＋ adds an agent to that project', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add agent to Garden' }))
    expect(p.onNewAgent).toHaveBeenCalledWith('p2')
    expect(screen.getAllByTitle('1 need you')).toHaveLength(2)
    expect(screen.getByTitle('1 working')).toBeTruthy()
    expect(screen.getByText('1 off')).toBeTruthy()
  })
})
