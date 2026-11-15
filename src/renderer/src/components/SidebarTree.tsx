import { useState, type ReactNode, type MouseEvent, type Dispatch, type SetStateAction } from 'react'
import type { Project, Agent } from '../types'
import { AvatarPreview } from './AvatarEditor'
import { NoteTag } from '../noteTag'
import { formatTimeSince } from '../timeSince'
import type { ProjectListState } from '../projectListState'

const OPEN_KEY = 'hive.sidebar.open'
const ROLE_ICON: Record<string, string> = { manager: '👑', worker: '🔧', qa: '🛡️' }

function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {} } catch { return {} }
}
function writeOpen(v: Record<string, boolean>) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)) } catch { /* private window */ }
}

/** Open unless the owner closed it: the selected project and any project with an agent waiting on you. */
export function defaultOpen(projectAgents: Agent[], selected: boolean): boolean {
  return selected || projectAgents.some(a => a.status === 'waiting')
}

function Chevron({ open, size = 10 }: { open: boolean; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      className={`flex-shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

const Plus = ({ size = 13 }: { size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)

export interface SidebarTreeProps {
  version: string
  width: number
  themeToggle: ReactNode
  projects: Project[]
  setProjects: Dispatch<SetStateAction<Project[]>>
  agents: Agent[]
  setAgents: Dispatch<SetStateAction<Agent[]>>
  listState: ProjectListState
  selectedProjectId: string | null
  selectedAgentId: string | null
  onSelectProject: (id: string) => void
  onSelectAgent: (agent: Agent) => void
  butler: { waiting: number; pageOpen: boolean; pinned: boolean; onOpen: () => void; onClose: () => void }
  overview: { active: boolean; onToggle: () => void }
  onAddProject: () => void
  onNewAgent: (projectId: string) => void
  onSettings: () => void
  collapsedGroups: Set<string>
  setCollapsedGroups: Dispatch<SetStateAction<Set<string>>>
  onProjectMenu: (e: MouseEvent, projectId: string) => void
  onAgentMenu: (e: MouseEvent, agentId: string) => void
  onEditAgent: (agent: Agent) => void
  onDeleteAgent: (agent: Agent) => void
  onAddTeam: (projectId: string, dept: string) => void
  lastEventAt: Record<string, number>
  nowTick: number
  busyAgentIds: Set<string>
  /** Menus and prompts that belong to the sidebar (fixed-position). */
  children?: ReactNode
}

/**
 * The left sidebar: Butler and Overview on top, then the projects as a tree —
 * a project opens in place to show its agents (no separate Agents pane).
 */
export function SidebarTree(p: SidebarTreeProps) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(readOpen)
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)

  const agentsOf = (pid: string) => p.agents.filter(a => a.projectId === pid).sort((a, b) => (a.order || 0) - (b.order || 0))
  const isOpen = (pid: string) => openMap[pid] ?? defaultOpen(agentsOf(pid), pid === p.selectedProjectId)
  const setOpen = (pid: string, v: boolean) => setOpenMap(m => { const n = { ...m, [pid]: v }; writeOpen(n); return n })

  const groups = [...new Set(p.projects.map(pr => pr.group || ''))]
  groups.sort((a, b) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))

  const dropAgent = (dept: string, targetId: string | null, targetGroup: string) => {
    if (!dragAgentId || dragAgentId === targetId) return
    p.setAgents(prev => {
      const dragged = prev.find(a => a.id === dragAgentId)
      if (!dragged || dragged.department !== dept) return prev
      const deptList = prev.filter(a => a.projectId === dragged.projectId && a.department === dept).sort((a, b) => (a.order || 0) - (b.order || 0))
      const without = deptList.filter(a => a.id !== dragAgentId)
      const targetIdx = targetId ? without.findIndex(a => a.id === targetId) : -1
      const updated = { ...dragged, group: targetGroup }
      const reordered = targetIdx >= 0 ? [...without.slice(0, targetIdx), updated, ...without.slice(targetIdx)] : [...without, updated]
      const orderMap = new Map(reordered.map((a, i) => [a.id, i]))
      return prev.map(a => {
        if (!orderMap.has(a.id)) return a
        const order = orderMap.get(a.id)!
        return a.id === dragAgentId ? { ...a, group: targetGroup, order } : { ...a, order }
      })
    })
    setDragAgentId(null)
  }

  const renderAgent = (agent: Agent, dept: string, grp: string) => {
    const sel = p.selectedAgentId === agent.id
    const since = formatTimeSince(p.lastEventAt[agent.id], p.nowTick)
    const off = agent.status !== 'working' && agent.status !== 'waiting'
    return (
      <div key={agent.id} role="button" tabIndex={0} draggable aria-label={agent.name} aria-current={sel ? 'true' : undefined}
        onDragStart={() => setDragAgentId(agent.id)}
        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
        onDrop={e => { e.stopPropagation(); dropAgent(dept, agent.id, grp) }}
        onDragEnd={() => setDragAgentId(null)}
        onClick={() => p.onSelectAgent(agent)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelectAgent(agent) } }}
        onContextMenu={e => { e.preventDefault(); p.onAgentMenu(e, agent.id) }}
        className={`group/ag relative flex items-center gap-2 h-[30px] px-1.5 rounded-lg text-[13px] cursor-pointer select-none transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
          ${dragAgentId === agent.id ? 'opacity-50' : ''}
          ${sel ? 'bg-accent-subtle ring-1 ring-inset ring-accent/40' : 'hover:bg-bg-hover'}`}>
        {sel && <span aria-hidden className="absolute -left-[11px] top-[7px] bottom-[7px] w-[2px] rounded-full bg-accent" />}
        <span className={`relative w-[22px] h-[22px] rounded-md bg-sidebar-bg flex items-center justify-center flex-shrink-0 ${off && !sel ? 'opacity-60' : ''}`}>
          <AvatarPreview config={agent.avatar} size={18} loopBusy={p.busyAgentIds.has(agent.id)} selected={sel} />
          <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px] ${sel ? 'border-accent-subtle' : 'border-bg-secondary'} ${
            agent.status === 'working' ? 'bg-status-working' : agent.status === 'waiting' ? 'bg-status-waiting' : 'bg-status-done'}`} />
          {agent.taskGroupRole && <span role="img" aria-label={`Task group: ${agent.taskGroupRole}`} className="absolute -top-1.5 -right-1.5 text-[10px] leading-none">{ROLE_ICON[agent.taskGroupRole] ?? '⚖️'}</span>}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden whitespace-nowrap" title={agent.role}>
          {agent.tagColor && <span aria-hidden className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: agent.tagColor }} />}
          <span className={`truncate min-w-0 ${sel ? 'font-semibold text-text-primary' : off ? 'text-text-muted' : 'font-medium text-text-primary'}`}>{agent.name}</span>
          {agent.note && <NoteTag id={agent.id} note={agent.note} color={agent.noteColor} solid={agent.noteSolid} />}
        </span>
        <span className="flex-shrink-0 text-[11px] whitespace-nowrap group-hover/ag:invisible">
          {agent.status === 'waiting' ? <span className="font-semibold text-status-waiting">needs you</span>
            : agent.status === 'working' ? <span className="text-status-working">working</span>
            : <span className="tabular-nums text-text-muted" title="Last activity">{since}</span>}
        </span>
        <span className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover/ag:opacity-100 transition-opacity">
          <button title="Edit" aria-label={`Edit ${agent.name}`} onClick={e => { e.stopPropagation(); p.onEditAgent(agent) }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-accent hover:bg-bg-active cursor-pointer">
            <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
          <button title="Delete" onClick={e => { e.stopPropagation(); p.onDeleteAgent(agent) }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 cursor-pointer">
            <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          </button>
          <button title="More" aria-label={`More for ${agent.name}`} onClick={e => { e.stopPropagation(); p.onAgentMenu(e, agent.id) }}
            className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-active cursor-pointer">
            <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
        </span>
      </div>
    )
  }

  const renderChildren = (project: Project, list: Agent[]) => {
    const depts = [...new Set(list.map(a => a.department))]
    const sel = project.id === p.selectedProjectId
    return (
      <div role="group" aria-label={`${project.name} agents`} className="relative ml-[13px] pl-[10px] border-l border-border mt-0.5 mb-1.5 space-y-px">
        {depts.map(dept => {
          const deptAgents = list.filter(a => a.department === dept)
          const teams = [...new Set(deptAgents.map(a => a.group || ''))].sort()
          return (
            <div key={dept} className="group/dept">
              <div className={`flex items-center gap-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted ${depts.length > 1 ? 'h-6 pt-1' : 'h-0 overflow-visible'}`}>
                {depts.length > 1 && <span>{dept}</span>}
                <button onClick={() => p.onAddTeam(project.id, dept)} title="Add team"
                  className={`ml-auto normal-case tracking-normal text-[11px] font-semibold text-accent hover:text-accent-hover cursor-pointer opacity-0 group-hover/dept:opacity-100 focus:opacity-100 transition-opacity ${depts.length > 1 ? '' : 'hidden'}`}>+ Team</button>
              </div>
              {teams.map(grp => {
                const teamAgents = deptAgents.filter(a => (a.group || '') === grp)
                return (
                  <div key={grp || '_'} className={grp ? 'ml-1 pl-2 border-l border-dashed border-border my-0.5' : ''}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropAgent(dept, null, grp)}>
                    {grp && (
                      <div className="group/team flex items-center h-5 px-1 text-[11px] font-semibold text-text-muted">
                        <span className="truncate">{grp}</span>
                        <button title="Remove team"
                          onClick={() => p.setAgents(prev => prev.map(a => a.group === grp && a.department === dept && a.projectId === project.id ? { ...a, group: '' } : a))}
                          className="ml-auto text-text-muted/40 hover:text-red-400 cursor-pointer opacity-0 group-hover/team:opacity-100">
                          <svg aria-hidden width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    )}
                    {teamAgents.map(a => renderAgent(a, dept, grp))}
                  </div>
                )
              })}
              {dragAgentId && teams.some(t => t) && (
                <div className="mx-1 my-0.5 rounded-md border border-dashed border-border text-center text-[11px] text-text-muted/70 py-0.5"
                  onDragOver={e => e.preventDefault()} onDrop={() => dropAgent(dept, null, '')}>Drop here to ungroup</div>
              )}
            </div>
          )
        })}
        {sel && (
          <div className="flex items-center gap-1">
            <button onClick={() => p.onNewAgent(project.id)}
              className="flex-1 flex items-center gap-2 h-[28px] px-1.5 rounded-lg text-[12.5px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer">
              <span className="w-[22px] flex justify-center"><Plus size={12} /></span>New Agent
            </button>
            {depts.length === 1 && (
              <button onClick={() => p.onAddTeam(project.id, depts[0])} title="Add team"
                className="h-[28px] px-1.5 rounded-lg text-[11px] font-semibold text-accent hover:text-accent-hover hover:bg-bg-hover cursor-pointer">+ Team</button>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderProject = (project: Project) => {
    const list = agentsOf(project.id)
    const open = isOpen(project.id)
    const sel = project.id === p.selectedProjectId
    const waiting = list.filter(a => a.status === 'waiting').length
    const working = list.filter(a => a.status === 'working').length
    const dot = list.length === 0 ? 'border border-text-muted/50' : working ? 'bg-status-working' : waiting ? 'bg-status-waiting' : 'bg-status-done'
    return (
      <div key={project.id}>
        <div
          draggable
          onDragStart={e => e.dataTransfer.setData('projectId', project.id)}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            const draggedId = e.dataTransfer.getData('projectId')
            if (!draggedId || draggedId === project.id) return
            p.setProjects(prev => {
              const fromIdx = prev.findIndex(x => x.id === draggedId)
              const toIdx = prev.findIndex(x => x.id === project.id)
              if (fromIdx < 0 || toIdx < 0) return prev
              const next = [...prev]
              const [moved] = next.splice(fromIdx, 1)
              moved.group = project.group
              next.splice(toIdx, 0, moved)
              return next
            })
          }}
          onContextMenu={e => { e.preventDefault(); p.onProjectMenu(e, project.id) }}
          className={`group/pr relative flex items-center rounded-[9px] transition-colors ${sel && !p.selectedAgentId ? 'hive-card !rounded-[9px] !overflow-visible' : 'hover:bg-bg-hover'}`}>
          <button onClick={() => setOpen(project.id, !open)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${project.name}`}
            className="w-6 h-8 flex items-center justify-center text-text-muted hover:text-text-primary cursor-pointer flex-shrink-0">
            <Chevron open={open} />
          </button>
          <button
            onClick={() => { if (sel) setOpen(project.id, !open); else { p.onSelectProject(project.id); if (!open) setOpen(project.id, true) } }}
            className={`flex-1 min-w-0 h-8 flex items-center gap-2 pr-2 text-left text-[13px] cursor-pointer ${sel ? 'font-semibold text-text-primary' : 'font-medium text-text-primary/80 hover:text-text-primary'}`}>
            <span role="img" aria-label={list.length === 0 ? 'No agents' : working ? 'Agents working' : waiting ? 'Agents idle' : 'Agents offline'}
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
            <span className="truncate">{project.name}</span>
            <span className="ml-auto flex items-center gap-1 flex-shrink-0 group-hover/pr:invisible font-mono text-[10.5px] font-medium">
              {waiting > 0 && <span title={`${waiting} need you`} className="px-1.5 rounded-md bg-status-waiting/15 text-status-waiting">{waiting}</span>}
              {working > 0 && <span title={`${working} working`} className="px-1.5 rounded-md bg-status-working/15 text-status-working">{working}</span>}
              {!waiting && !working && <span className="text-text-muted font-normal">{list.length ? `${list.length} off` : ''}</span>}
            </span>
          </button>
          <button onClick={() => p.onNewAgent(project.id)} title={`Add agent to ${project.name}`} aria-label={`Add agent to ${project.name}`}
            className="absolute right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-accent hover:bg-bg-active cursor-pointer opacity-0 group-hover/pr:opacity-100 focus:opacity-100 transition-opacity">
            <Plus size={12} />
          </button>
        </div>
        {open && (list.length > 0 || sel) && renderChildren(project, list)}
      </div>
    )
  }

  return (
    <div className="hive-sidebar flex flex-col flex-shrink-0 pl-2.5" style={{ width: p.width }}>
      <div className="drag-region flex items-center gap-2 px-2 pt-1 pb-2.5">
        <h2 className="no-drag text-[14px] font-bold text-text-primary">
          Hive<span className="ml-1.5 text-[11px] font-medium text-text-muted">v{p.version}</span>
        </h2>
        <span className="ml-auto">{p.themeToggle}</span>
      </div>

      <div className="rounded-xl bg-bg-secondary/70 border border-border p-1 space-y-px">
        <div className={`group flex items-center gap-2 h-[34px] pl-2 pr-2 rounded-[9px] text-[13px] ${p.butler.pageOpen ? 'bg-accent-subtle text-text-primary' : 'hover:bg-bg-hover'}`}>
          <button onClick={p.butler.onOpen} aria-label="Open Butler page" className="flex-1 min-w-0 h-full flex items-center gap-2.5 text-left font-semibold cursor-pointer">
            <span aria-hidden className="w-[22px] h-[22px] rounded-md bg-bg-hover flex items-center justify-center text-[13px]">🎩</span>Butler
            {p.butler.waiting > 0 && (
              <span title={`${p.butler.waiting} waiting for you`} className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full flex items-center justify-center font-mono text-[10.5px] font-semibold bg-status-waiting/20 text-status-waiting">{p.butler.waiting}</span>
            )}
          </button>
          {p.butler.pinned ? (
            <span role="img" aria-label="Pinned" title="Pinned" className="text-[11px]">📌</span>
          ) : p.butler.pageOpen ? (
            <button aria-label="Close Butler page" onClick={p.butler.onClose} className="text-[11px] text-text-muted hover:text-text-primary cursor-pointer">✕</button>
          ) : null}
        </div>
        <button onClick={p.overview.onToggle} aria-pressed={p.overview.active} title="Overview across all projects and agents"
          className={`w-full flex items-center gap-2.5 h-[34px] px-2 rounded-[9px] text-[13px] font-semibold cursor-pointer transition-colors ${p.overview.active ? 'bg-accent text-text-on-purple' : 'hover:bg-bg-hover'}`}>
          <span aria-hidden className={`w-[22px] h-[22px] rounded-md flex items-center justify-center ${p.overview.active ? 'bg-white/20' : 'bg-bg-hover'}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
          </span>
          Overview
        </button>
      </div>

      <div className="flex items-center h-[30px] mt-3 mb-0.5 pl-2 pr-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-text-muted">
        Projects
        <button onClick={p.onAddProject} aria-label="Add Project" title="Add Project"
          className="ml-auto w-6 h-6 rounded-md flex items-center justify-center hover:bg-bg-hover hover:text-text-primary cursor-pointer"><Plus /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1">
        {groups.map(grp => {
          const grpProjects = p.projects.filter(x => (x.group || '') === grp)
          if (!grp) return grpProjects.map(renderProject)
          const collapsed = p.collapsedGroups.has(grp)
          return (
            <div key={grp} className="mt-1.5"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                const draggedId = e.dataTransfer.getData('projectId')
                if (!draggedId) return
                p.setProjects(prev => prev.map(x => x.id === draggedId ? { ...x, group: grp } : x))
              }}>
              <button aria-expanded={!collapsed}
                onClick={() => p.setCollapsedGroups(prev => { const n = new Set(prev); if (n.has(grp)) n.delete(grp); else n.add(grp); return n })}
                className="w-full h-[26px] px-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted hover:text-text-primary cursor-pointer">
                <Chevron open={!collapsed} size={9} />{grp}
                <span className="ml-auto font-mono text-[10.5px] font-normal">{grpProjects.length}</span>
              </button>
              {!collapsed && grpProjects.map(renderProject)}
            </div>
          )
        })}
        {p.listState === 'loading' && (
          <p className="text-xs text-text-muted text-center py-6 flex items-center justify-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
            Scanning projects…
          </p>
        )}
        {p.listState === 'empty' && <p className="text-xs text-text-muted text-center py-6">No projects yet</p>}
        {p.children}
      </div>

      <div className="hive-sidebar-foot pt-2 pb-2 border-t border-border/60">
        <button onClick={p.onSettings} title="App Settings" aria-label="App Settings"
          className="w-full h-8 px-2 rounded-lg flex items-center gap-2.5 text-[13px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer transition-colors">
          <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  )
}
