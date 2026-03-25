import { useState, useEffect, useCallback } from 'react'
import Terminal from './components/Terminal'
import AvatarEditor, { AvatarPreview } from './components/AvatarEditor'
import CreateProjectModal from './components/CreateProjectModal'
import CreateAgentModal from './components/CreateAgentModal'
import ProjectSettingsModal from './components/ProjectSettingsModal'
import ResizeHandle from './components/ResizeHandle'
import EditTemplateModal from './components/EditTemplateModal'
import FilesPanel from './components/FilesPanel'
import OfficeView from './components/OfficeView'
import Markdown from 'react-markdown'
import type { Project, Agent, Zone, SkillInfo } from './types'
import { BUILTIN_TEMPLATES } from './types'

function StatusDot({ status }: { status: Agent['status'] }) {
  const colors = {
    working: 'bg-status-working',
    waiting: 'bg-status-waiting',
    done: 'bg-status-done'
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />
}

function ThemeToggle({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="no-drag w-7 h-7 rounded-lg flex items-center justify-center
        bg-bg-hover hover:bg-bg-active transition-colors cursor-pointer"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeTerminals, setActiveTerminals] = useState<Set<string>>(new Set())
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<any>(null)
  const [customTemplates, setCustomTemplates] = useState<any[]>([])
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [projectTab, setProjectTab] = useState<'office' | 'project' | 'settings'>('office')
  const [mainView, setMainView] = useState<'terminal' | 'editor' | 'logs'>('terminal')
  const [editorTab, setEditorTab] = useState<'basic' | 'skills' | 'settings'>('basic')
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [appPrefs, setAppPrefs] = useState({
    autoRunClaude: true, maxLogs: 100, continueSession: true,
    defaultSkillsRnD: ['review', 'qa', 'ship'] as string[],
    defaultSkillsNonRnD: ['browse'] as string[],
  })
  const [panelWidths, setPanelWidths] = useState({ projects: 200, agents: 240, files: 220 })
  const [showFiles, setShowFiles] = useState(true)
  const [agentReports, setAgentReports] = useState<Record<string, { text: string; done: boolean }[]>>({})
  const [agentTasks, setAgentTasks] = useState<Record<string, { title?: string; summary?: string; active: boolean }>>({})
  const [agentLogs, setAgentLogs] = useState<{ time: string; type: string; message: string }[]>([])
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [projectScans, setProjectScans] = useState<Record<string, {
    projectStage: string
    todos: { zone: string; type: string; category: string; text: string; done: boolean }[]
  }>>({})

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null
  const projectScan = selectedProjectId ? projectScans[selectedProjectId] || null : null
  const projectAgents = agents.filter((a) => a.projectId === selectedProjectId).sort((a, b) => (a.order || 0) - (b.order || 0))
  const departments = [...new Set(projectAgents.map((a) => a.department))]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Load data on mount — reset all agents to idle (terminals disconnected on restart)
  useEffect(() => {
    window.api.data.load().then((data) => {
      if (data.projects) setProjects(data.projects as Project[])
      if (data.agents) {
        const resetAgents = (data.agents as Agent[]).map((a) => ({ ...a, status: 'done' as const }))
        setAgents(resetAgents)
      }
      if (data.appPrefs) setAppPrefs((prev) => ({ ...prev, ...(data.appPrefs as Record<string, unknown>) }))
    })
    window.api.skills.scan().then(setAvailableSkills)
    window.api.templates.list().then(setCustomTemplates)
  }, [])

  // Save data on change
  useEffect(() => {
    if (projects.length || agents.length) {
      window.api.data.save({ projects, agents, appPrefs })
    }
  }, [projects, agents, appPrefs])

  const handleCreateProject = (project: Project) => {
    setProjects((prev) => [...prev, project])
    setSelectedProjectId(project.id)
  }

  const handleCreateAgent = (agent: Agent) => {
    setAgents((prev) => [...prev, agent])
  }

  // Scan all projects on load and when selected
  useEffect(() => {
    projects.forEach((p) => {
      window.api.project.scan(p.zones.map((z: Zone) => ({ path: z.path, type: z.type })))
        .then((scan) => setProjectScans((prev) => ({ ...prev, [p.id]: scan })))
    })
  }, [projects.length])

  // Load logs when switching to logs view
  useEffect(() => {
    if (mainView === 'logs' && selectedAgentId) {
      window.api.agent.loadLogs(selectedAgentId).then(setAgentLogs)
    }
  }, [mainView, selectedAgentId])

  // Listen for agent status + report updates from hooks
  useEffect(() => {
    const removeStatus = window.api.agent.onStatus(({ agentId, status }) => {
      if (status === 'working' || status === 'waiting' || status === 'done') {
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, status: status as Agent['status'] } : a))
        )
      }
    })
    const removeReport = window.api.agent.onReport(({ agentId, type, title, summary, items }: any) => {
      if (type === 'task_start') {
        setAgentTasks((prev) => ({ ...prev, [agentId]: { title, active: true } }))
      } else if (type === 'task_done') {
        setAgentTasks((prev) => ({ ...prev, [agentId]: { ...prev[agentId], summary, active: false } }))
      }
      if (agentId && items) {
        setAgentReports((prev) => ({ ...prev, [agentId]: items }))
      }
    })
    return () => { removeStatus(); removeReport() }
  }, [])

  const startAgent = async (agent: Agent) => {
    const project = projects.find((p) => p.id === agent.projectId)
    const zone = project?.zones.find((z: Zone) => z.id === agent.zoneId)
    if (!zone) return

    let cwd = zone.path

    // Create worktree for coding agents with git
    if (agent.type === 'coding' && zone.hasGit && !agent.worktreePath) {
      const result = await window.api.git.worktreeAdd(zone.path, agent.id, agent.name)
      if (result.ok && result.path) {
        cwd = result.path
        updateAgent(agent.id, { worktreePath: result.path, worktreeBranch: result.branch })
      }
    } else if (agent.worktreePath) {
      cwd = agent.worktreePath
    }

    // Write Claude Code native agent definition file
    const result = await window.api.agent.writeDefinition(cwd, {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      department: agent.department,
      soul: agent.soul,
      skills: agent.enabledSkills || [],
      model: agent.model || 'inherit',
      effort: agent.effort || 'high',
    })
    if (result.agentName) {
      setAgentNames((prev) => ({ ...prev, [agent.id]: result.agentName! }))
    }

    setActiveTerminals((prev) => new Set(prev).add(agent.id))
    setSelectedAgentId(agent.id)
    setMainView('terminal')
  }

  const getAgentCwd = (agent: Agent): string => {
    if (agent.worktreePath) return agent.worktreePath
    const project = projects.find((p) => p.id === agent.projectId)
    const zone = project?.zones.find((z: Zone) => z.id === agent.zoneId)
    return zone?.path || '/'
  }

  const getAgentZonePath = (agent: Agent): string => {
    const project = projects.find((p) => p.id === agent.projectId)
    const zone = project?.zones.find((z: Zone) => z.id === agent.zoneId)
    const path = zone?.path || ''
    const home = '/Users/' + path.split('/Users/')[1]?.split('/')[0]
    return path.replace(home ? `/Users/${path.split('/Users/')[1]?.split('/')[0]}` : '', '~')
  }

  const updateAgent = (id: string, updates: Partial<Agent>) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)))
  }

  const resizePanel = useCallback((panel: 'projects' | 'agents' | 'files', delta: number) => {
    setPanelWidths((prev) => ({
      ...prev,
      [panel]: Math.max(150, Math.min(400, prev[panel] + delta))
    }))
  }, [])

  const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
  const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']
  const ALL_DEPARTMENTS = ['R&D', 'Non-R&D']

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Left: Projects */}
      <div className="bg-sidebar-bg flex flex-col flex-shrink-0" style={{ width: panelWidths.projects }}>
        <div className="drag-region h-16 flex items-end px-4 pb-2 justify-between">
          <h2 className="no-drag text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            Hive v0.4.0
          </h2>
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                setSelectedProjectId(project.id)
                setSelectedAgentId(null)
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm cursor-pointer
                transition-colors flex items-center gap-2 ${
                selectedProjectId === project.id
                  ? 'bg-sidebar-active text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              {(() => {
                const scan = projectScans[project.id]
                const stageColor = !scan ? 'bg-status-done' :
                  scan.projectStage === 'active-online' || scan.projectStage === 'active' ? 'bg-status-working' :
                  scan.projectStage === 'incubating' ? 'bg-status-waiting' : 'bg-status-done'
                return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stageColor}`} />
              })()}
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="text-xs text-text-muted text-center py-6">No projects yet</p>
          )}
        </div>
        <div className="p-2 border-t border-border space-y-1">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] text-text-muted">Auto-run Claude</span>
            <button
              onClick={() => setAppPrefs((p) => ({ ...p, autoRunClaude: !p.autoRunClaude }))}
              className={`w-8 h-[18px] rounded-full cursor-pointer transition-colors relative ${
                appPrefs.autoRunClaude ? 'bg-accent' : 'bg-bg-hover'
              }`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                appPrefs.autoRunClaude ? 'left-[14px]' : 'left-[2px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] text-text-muted">Resume session</span>
            <button
              onClick={() => setAppPrefs((p) => ({ ...p, continueSession: !p.continueSession }))}
              className={`w-8 h-[18px] rounded-full cursor-pointer transition-colors relative ${
                appPrefs.continueSession ? 'bg-accent' : 'bg-bg-hover'
              }`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                appPrefs.continueSession ? 'left-[14px]' : 'left-[2px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] text-text-muted">Files panel</span>
            <button
              onClick={() => setShowFiles((p) => !p)}
              className={`w-8 h-[18px] rounded-full cursor-pointer transition-colors relative ${
                showFiles ? 'bg-accent' : 'bg-bg-hover'
              }`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                showFiles ? 'left-[14px]' : 'left-[2px]'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] text-text-muted">Max logs</span>
            <select
              value={appPrefs.maxLogs}
              onChange={(e) => setAppPrefs((p) => ({ ...p, maxLogs: Number(e.target.value) }))}
              className="text-[11px] bg-bg-hover text-text-primary rounded px-1.5 py-0.5 cursor-pointer border-none"
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowCreateProject(true)}
            className="w-full px-3 py-2 rounded-lg text-sm text-text-muted
              hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer
              flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Project
          </button>
        </div>
      </div>

      <ResizeHandle onResize={(d) => resizePanel('projects', d)} />

      {/* Middle: Agents */}
      <div className="bg-bg-secondary flex flex-col flex-shrink-0" style={{ width: panelWidths.agents }}>
        <div className="drag-region h-16 flex items-end px-4 pb-2">
          <h2 className="no-drag text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            {selectedProject ? selectedProject.name : 'Agents'}
          </h2>
        </div>
        {selectedProject ? (
          <>
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {departments.map((dept) => {
                const deptAgents = projectAgents.filter((a) => a.department === dept)
                const groups = [...new Set(deptAgents.map((a) => a.group || ''))]

                return (
                  <div key={dept}>
                    <div className="px-3 py-1.5 text-[11px] font-heading font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                      {dept}
                    </div>
                    {groups.map((grp) => {
                      const grpAgents = deptAgents.filter((a) => (a.group || '') === grp)
                      return (
                        <div key={grp || '_ungrouped'} className="space-y-0.5">
                          {grp && (
                            <div className="px-5 py-1 text-[10px] font-heading font-medium text-text-muted/70 uppercase tracking-wider">
                              {grp}
                            </div>
                          )}
                          {grpAgents.map((agent) => (
                            <div
                              key={agent.id}
                              draggable
                              onDragStart={() => setDragAgentId(agent.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (dragAgentId && dragAgentId !== agent.id) {
                                  setAgents((prev) => {
                                    const dragged = prev.find((a) => a.id === dragAgentId)
                                    const target = prev.find((a) => a.id === agent.id)
                                    if (!dragged || !target) return prev
                                    // Swap order values
                                    return prev.map((a) => {
                                      if (a.id === dragAgentId) return { ...a, order: target.order || 0, group: target.group || '' }
                                      if (a.id === agent.id) return { ...a, order: dragged.order || 0 }
                                      return a
                                    })
                                  })
                                  setDragAgentId(null)
                                }
                              }}
                              onDragEnd={() => setDragAgentId(null)}
                              className={`group w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5
                                transition-colors cursor-grab active:cursor-grabbing ${
                                dragAgentId === agent.id ? 'opacity-50' : ''
                              } ${
                                selectedAgentId === agent.id
                                  ? 'bg-accent-subtle text-accent font-medium'
                                  : 'text-text-secondary hover:bg-bg-hover'
                              }`}
                              onClick={() => {
                                setSelectedAgentId(agent.id)
                                if (!activeTerminals.has(agent.id)) startAgent(agent)
                              }}
                            >
                              <div className="w-6 h-6 flex-shrink-0 relative">
                                <AvatarPreview config={agent.avatar} size={24} />
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-secondary ${
                                  agent.status === 'working' ? 'bg-status-working' :
                                  agent.status === 'waiting' ? 'bg-status-waiting' : 'bg-status-done'
                                }`} />
                              </div>
                              <span className="truncate">{agent.name}</span>
                              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setSelectedAgentId(agent.id); setMainView('editor') }}
                                  className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-accent hover:bg-bg-active transition-colors cursor-pointer"
                                  title="Edit"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (activeTerminals.has(agent.id)) {
                                      window.api.pty.kill(agent.id)
                                      setActiveTerminals((prev) => { const next = new Set(prev); next.delete(agent.id); return next })
                                    }
                                    if (agent.worktreePath) {
                                      const zone = selectedProject?.zones.find((z: Zone) => z.id === agent.zoneId)
                                      if (zone) await window.api.git.worktreeRemove(zone.path, agent.worktreePath)
                                    }
                                    const delZone = selectedProject?.zones.find((z: Zone) => z.id === agent.zoneId)
                                    if (delZone) window.api.agent.deleteDefinition(agent.worktreePath || delZone.path, agent.id)
                                    setAgents((prev) => prev.filter((a) => a.id !== agent.id))
                                    if (selectedAgentId === agent.id) setSelectedAgentId(null)
                                  }}
                                  className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                                  title="Delete"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </div>
                              <span className="text-[10px] text-text-muted uppercase group-hover:hidden">
                                {agent.role || agent.department}
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              {projectAgents.length === 0 && (
                <p className="text-xs text-text-muted text-center py-6">
                  No agents yet. Click + to create one.
                </p>
              )}
            </div>
            <div className="p-2 border-t border-border">
              <button
                onClick={() => setShowCreateAgent(true)}
                className="w-full px-3 py-2 rounded-lg text-sm text-accent
                  hover:bg-accent-subtle transition-colors cursor-pointer
                  flex items-center gap-2 font-medium"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Agent
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-text-muted">Select a project</p>
          </div>
        )}
      </div>

      <ResizeHandle onResize={(d) => resizePanel('agents', d)} />

      {/* Right: Main Panel */}
      <div className="flex-1 flex flex-col bg-bg-primary min-w-0">
        <div className="drag-region h-16 flex items-end px-4 pb-2 justify-between">
          <div className="no-drag flex items-center gap-2">
            <h2 className="text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
              {selectedAgent ? selectedAgent.name : (selectedProject ? 'Dashboard' : 'Select an agent')}
            </h2>
            {selectedAgent && (
              <>
                <span className="text-[10px] text-text-muted font-mono px-2 py-0.5 rounded-md bg-bg-hover">
                  {getAgentZonePath(selectedAgent)}
                </span>
                {agentTasks[selectedAgent.id]?.active && agentTasks[selectedAgent.id]?.title && (
                  <span className="text-[10px] text-accent font-medium px-2 py-0.5 rounded-md bg-accent/10 truncate max-w-[250px]">
                    {agentTasks[selectedAgent.id].title}
                  </span>
                )}
                {!agentTasks[selectedAgent.id]?.active && agentTasks[selectedAgent.id]?.summary && (
                  <span className="text-[10px] text-status-working font-medium px-2 py-0.5 rounded-md bg-status-working/10 truncate max-w-[250px]">
                    {agentTasks[selectedAgent.id].summary}
                  </span>
                )}
              </>
            )}
          </div>
          {selectedAgent && (
            <div className="no-drag flex items-center gap-1">
              <button
                onClick={() => setMainView('terminal')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  mainView === 'terminal'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Terminal
              </button>
              <button
                onClick={() => setMainView('editor')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  mainView === 'editor'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setMainView('logs')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  mainView === 'logs'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Logs
              </button>
              {mainView === 'terminal' && activeTerminals.has(selectedAgent!.id) && (
                <button
                  onClick={() => {
                    const agentId = selectedAgent!.id
                    const agent = agents.find((a) => a.id === agentId)
                    window.api.pty.kill(agentId)
                    setActiveTerminals((prev) => {
                      const next = new Set(prev)
                      next.delete(agentId)
                      return next
                    })
                    // Re-create after a tick
                    setTimeout(() => {
                      if (agent) startAgent(agent)
                    }, 200)
                  }}
                  className="px-1.5 py-1 rounded-md text-text-muted hover:bg-bg-hover transition-colors cursor-pointer"
                  title="Restart terminal"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 relative">
          {!selectedAgent && !selectedProject && (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <p className="text-sm">Select a project first</p>
            </div>
          )}

          {/* Project View (Dashboard / Settings tabs) */}
          {!selectedAgent && selectedProject && (
            <div className="absolute inset-0 flex flex-col">
              {/* Project Header + Tabs in title bar area */}
              <div className="px-6 pt-2 pb-3 border-b border-border flex items-center gap-4">
                <div className="flex gap-1">
                  {([['office', 'Office'], ['project', 'Project'], ['settings', 'Settings']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setProjectTab(key)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                        projectTab === key
                          ? 'bg-accent text-text-on-purple'
                          : 'text-text-muted hover:bg-bg-hover'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <h1 className="text-sm font-heading font-semibold text-text-primary">{selectedProject.name}</h1>
                  {projectScan && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-heading font-bold uppercase tracking-wider ${
                      projectScan.projectStage === 'active-online' || projectScan.projectStage === 'active'
                        ? 'bg-status-working/20 text-status-working'
                        : projectScan.projectStage === 'incubating'
                        ? 'bg-status-waiting/20 text-status-waiting'
                        : 'bg-bg-hover text-text-muted'
                    }`}>
                      {projectScan.projectStage.replace('-', ' ')}
                    </span>
                  )}
                </div>
              </div>

              {/* Office Tab */}
              {projectTab === 'office' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Office View — fill width */}
                  <div className="w-full">
                    <OfficeView
                      agents={projectAgents}
                      onAgentClick={(id) => {
                        setSelectedAgentId(id)
                        const agent = agents.find((a) => a.id === id)
                        if (agent && !activeTerminals.has(id)) startAgent(agent)
                      }}
                    />
                  </div>

                  {/* Agent Kanban */}
                  <div className="grid grid-cols-3 gap-3">
                    {(['working', 'waiting', 'done'] as const).map((status) => {
                      const statusLabel = { working: 'Working', waiting: 'Waiting', done: 'Idle' }
                      const statusColor = { working: 'bg-status-working', waiting: 'bg-status-waiting', done: 'bg-status-done' }
                      const columnAgents = projectAgents.filter((a) => a.status === status)
                      return (
                        <div key={status} className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                          <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${statusColor[status]}`} />
                            <span className="text-sm font-heading font-bold text-text-primary">{statusLabel[status]}</span>
                            <span className="text-lg font-heading font-bold text-text-primary ml-auto">{columnAgents.length}</span>
                          </div>
                          <div className="p-2 space-y-1.5 min-h-[80px]">
                            {columnAgents.length === 0 && (
                              <p className="text-[11px] text-text-muted text-center py-4">No agents</p>
                            )}
                            {columnAgents.map((agent) => (
                              <button
                                key={agent.id}
                                onClick={() => {
                                  setSelectedAgentId(agent.id)
                                  if (!activeTerminals.has(agent.id)) startAgent(agent)
                                }}
                                className="w-full text-left p-2.5 rounded-lg bg-bg-primary hover:bg-bg-hover
                                  border border-border transition-colors cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <AvatarPreview config={agent.avatar} size={20} />
                                  <span className="text-sm font-medium text-text-primary">{agent.name}</span>
                                  <span className="text-[10px] text-text-muted uppercase ml-auto">
                                    {agent.role || agent.department}
                                  </span>
                                </div>
                                {agentTasks[agent.id] && (
                                  <div className="mt-1.5">
                                    {agentTasks[agent.id].active && agentTasks[agent.id].title && (
                                      <p className="text-[11px] text-accent truncate">{agentTasks[agent.id].title}</p>
                                    )}
                                    {!agentTasks[agent.id].active && agentTasks[agent.id].summary && (
                                      <p className="text-[11px] text-status-working truncate">{agentTasks[agent.id].summary}</p>
                                    )}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Project Tab */}
              {projectTab === 'project' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Glass Todo Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* R&D Card */}
                    <div className="glass-card p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                        </svg>
                        <h3 className="text-sm font-heading font-bold text-text-primary">R&D</h3>
                        {projectScan && (() => {
                          const rdTodos = projectScan.todos.filter((t) => t.category === 'rd' || (t.type === 'rnd' && t.category === 'other'))
                          const open = rdTodos.filter((t) => !t.done).length
                          const done = rdTodos.filter((t) => t.done).length
                          return <span className="text-[11px] text-text-muted ml-auto">{open} open{done > 0 ? ` · ${done} done` : ''}</span>
                        })()}
                      </div>
                      {projectScan && (() => {
                        const rdTodos = projectScan.todos.filter((t) => t.category === 'rd' || (t.type === 'rnd' && t.category === 'other')).filter((t) => !t.done)
                        return rdTodos.length > 0 ? (
                          <div className="space-y-1.5">
                            {rdTodos.slice(0, 8).map((t, i) => (
                              <div key={i} className="flex items-start gap-2 text-[12px]">
                                <span className="text-accent mt-0.5">{'\u25CB'}</span>
                                <span className="text-text-primary">{t.text}</span>
                              </div>
                            ))}
                            {rdTodos.length > 8 && <p className="text-[11px] text-text-muted">+{rdTodos.length - 8} more</p>}
                          </div>
                        ) : <p className="text-xs text-text-muted py-2">No open R&D todos</p>
                      })()}
                    </div>

                    {/* Admin Card */}
                    <div className="glass-card-warm p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-working)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                        </svg>
                        <h3 className="text-sm font-heading font-bold text-text-primary">Admin</h3>
                        {projectScan && (() => {
                          const adminTodos = projectScan.todos.filter((t) => t.type === 'non-rnd')
                          const open = adminTodos.filter((t) => !t.done).length
                          const done = adminTodos.filter((t) => t.done).length
                          return <span className="text-[11px] text-text-muted ml-auto">{open} open{done > 0 ? ` · ${done} done` : ''}</span>
                        })()}
                      </div>
                      {projectScan && (() => {
                        const adminTodos = projectScan.todos.filter((t) => t.type === 'non-rnd').filter((t) => !t.done)
                        const hasNonRnd = selectedProject.zones.some((z: Zone) => z.type === 'non-rnd')
                        return adminTodos.length > 0 ? (
                          <div className="space-y-1.5">
                            {adminTodos.slice(0, 8).map((t, i) => (
                              <div key={i} className="flex items-start gap-2 text-[12px]">
                                <span className="text-status-working mt-0.5">{'\u25CB'}</span>
                                <span className="text-text-primary flex-1">{t.text}</span>
                                <span className="text-[10px] text-text-muted flex-shrink-0">{t.category}</span>
                              </div>
                            ))}
                            {adminTodos.length > 8 && <p className="text-[11px] text-text-muted">+{adminTodos.length - 8} more</p>}
                          </div>
                        ) : (
                          <div className="text-center py-2">
                            <p className="text-xs text-text-muted mb-2">{hasNonRnd ? 'No open admin todos' : 'No Non-R&D zone'}</p>
                            <button onClick={() => setShowCreateAgent(true)} className="px-3 py-1.5 rounded-lg bg-accent text-text-on-purple text-xs font-medium hover:bg-accent-hover transition-colors cursor-pointer">
                              Create Business Manager
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Work Zones */}
                  <div>
                    <h3 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-3">Work Zones</h3>
                    <div className="space-y-2">
                      {selectedProject.zones.map((zone: Zone) => {
                        const zoneAgents = projectAgents.filter((a) => a.zoneId === zone.id)
                        return (
                          <div key={zone.id} className="flex items-center gap-3 p-3 rounded-xl bg-bg-secondary border border-border">
                            <span className={`w-2.5 h-2.5 rounded-full ${zone.type === 'rnd' ? 'bg-accent' : 'bg-status-working'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-text-primary">{zone.name}</p>
                              <p className="text-[11px] text-text-muted font-mono truncate">{zone.path}</p>
                            </div>
                            <span className="text-[10px] text-text-muted uppercase">{zone.type === 'rnd' ? 'R&D' : 'Docs'}</span>
                            <span className="text-[11px] text-text-muted">{zoneAgents.length} agent{zoneAgents.length !== 1 ? 's' : ''}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {projectTab === 'settings' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Project Name */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Project Name
                    </label>
                    <input
                      type="text"
                      value={selectedProject.name}
                      onChange={(e) => setProjects((prev) => prev.map((p) =>
                        p.id === selectedProject.id ? { ...p, name: e.target.value } : p
                      ))}
                      className="w-full px-3 py-2 rounded-lg bg-bg-secondary border border-border
                        text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>

                  {/* R&D Folders */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      R&D Folders
                    </label>
                    <div className="space-y-1.5">
                      {selectedProject.zones.filter((z: Zone) => z.type === 'rnd').map((zone: Zone) => (
                        <div key={zone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm">
                          <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                          <span className="font-medium text-text-primary truncate">{zone.name}</span>
                          <span className="text-[11px] text-text-muted truncate ml-auto max-w-[200px] font-mono">{zone.path}</span>
                          <button
                            onClick={() => setProjects((prev) => prev.map((p) =>
                              p.id === selectedProject.id ? { ...p, zones: p.zones.filter((z) => z.id !== zone.id) } : p
                            ))}
                            className="text-text-muted hover:text-red-400 cursor-pointer flex-shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={async () => {
                          const path = await window.api.dialog.selectFolder('Add R&D Folder')
                          if (!path) return
                          const hasGit = await window.api.fs.hasGit(path)
                          setProjects((prev) => prev.map((p) =>
                            p.id === selectedProject.id ? {
                              ...p,
                              zones: [...p.zones, { id: `zone-${Date.now()}`, name: path.split('/').pop() || '', path, type: 'rnd' as const, hasGit }]
                            } : p
                          ))
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-border border-dashed text-sm
                          text-accent hover:bg-accent-subtle transition-colors cursor-pointer
                          flex items-center justify-center gap-1.5"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add R&D Folder
                      </button>
                    </div>
                  </div>

                  {/* Non-R&D Folders */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Non-R&D Folders
                    </label>
                    <div className="space-y-1.5">
                      {selectedProject.zones.filter((z: Zone) => z.type === 'non-rnd').map((zone: Zone) => (
                        <div key={zone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm">
                          <span className="w-2 h-2 rounded-full bg-status-waiting flex-shrink-0" />
                          <span className="font-medium text-text-primary truncate">{zone.name}</span>
                          <span className="text-[11px] text-text-muted truncate ml-auto max-w-[200px] font-mono">{zone.path}</span>
                          <button
                            onClick={() => setProjects((prev) => prev.map((p) =>
                              p.id === selectedProject.id ? { ...p, zones: p.zones.filter((z) => z.id !== zone.id) } : p
                            ))}
                            className="text-text-muted hover:text-red-400 cursor-pointer flex-shrink-0"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={async () => {
                          const path = await window.api.dialog.selectFolder('Add Non-R&D Folder')
                          if (!path) return
                          setProjects((prev) => prev.map((p) =>
                            p.id === selectedProject.id ? {
                              ...p,
                              zones: [...p.zones, { id: `zone-${Date.now()}`, name: path.split('/').pop() || '', path, type: 'non-rnd' as const, hasGit: false }]
                            } : p
                          ))
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-border border-dashed text-sm
                          text-status-waiting hover:bg-bg-hover transition-colors cursor-pointer
                          flex items-center justify-center gap-1.5"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Add Non-R&D Folder
                      </button>
                    </div>
                  </div>

                  {/* Agent Templates */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                      Agent Templates
                    </label>
                    <div className="space-y-1">
                      {[...BUILTIN_TEMPLATES, ...customTemplates].map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-secondary border border-border">
                          <span className="text-xs text-text-primary flex-1">{t.name}
                            <span className="text-text-muted ml-1 text-[10px]">{t.role} · {t.category}</span>
                          </span>
                          <button onClick={() => setEditingTemplate(t)}
                            className="text-[10px] text-accent hover:text-accent-hover cursor-pointer">Edit</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Default Skills */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                      Default Skills for New Agents
                    </label>
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-bg-secondary border border-border">
                        <p className="text-[11px] text-accent font-semibold uppercase mb-2">R&D Agents</p>
                        <div className="flex flex-wrap gap-1">
                          {availableSkills.map((s) => (
                            <button key={`rnd-${s.name}`}
                              onClick={() => setAppPrefs((p) => {
                                const cur = p.defaultSkillsRnD || []
                                const next = cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name]
                                return { ...p, defaultSkillsRnD: next }
                              })}
                              className={`px-2 py-0.5 rounded-full text-[10px] cursor-pointer ${
                                (appPrefs.defaultSkillsRnD || []).includes(s.name) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'
                              }`}
                            >/{s.name}</button>
                          ))}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-bg-secondary border border-border">
                        <p className="text-[11px] text-status-working font-semibold uppercase mb-2">Non-R&D Agents</p>
                        <div className="flex flex-wrap gap-1">
                          {availableSkills.map((s) => (
                            <button key={`non-${s.name}`}
                              onClick={() => setAppPrefs((p) => {
                                const cur = p.defaultSkillsNonRnD || []
                                const next = cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name]
                                return { ...p, defaultSkillsNonRnD: next }
                              })}
                              className={`px-2 py-0.5 rounded-full text-[10px] cursor-pointer ${
                                (appPrefs.defaultSkillsNonRnD || []).includes(s.name) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'
                              }`}
                            >/{s.name}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Danger Zone */}
                  <div className="pt-4 border-t border-border">
                    <button
                      onClick={() => {
                        if (confirm('Delete this project and all its agents?')) {
                          setAgents((prev) => prev.filter((a) => a.projectId !== selectedProject.id))
                          setProjects((prev) => prev.filter((p) => p.id !== selectedProject.id))
                          setSelectedProjectId(null)
                          setSelectedAgentId(null)
                        }
                      }}
                      className="px-4 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10
                        transition-colors cursor-pointer"
                    >
                      Delete Project
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Terminal view */}
          {[...activeTerminals].map((agentId) => {
            const agent = agents.find((a) => a.id === agentId)
            if (!agent) return null
            const isVisible = mainView === 'terminal' && selectedAgentId === agentId
            return (
              <div
                key={agentId}
                className="absolute inset-0 p-1"
                style={{
                  visibility: isVisible ? 'visible' : 'hidden',
                  pointerEvents: isVisible ? 'auto' : 'none',
                  zIndex: isVisible ? 1 : 0
                }}
              >
                <Terminal
                  id={agentId}
                  agentId={agentId}
                  agentName={agent.name}
                  cwd={getAgentCwd(agent)}
                  visible={isVisible}
                  autoRunClaude={appPrefs.autoRunClaude}
                  continueSession={appPrefs.continueSession}
                  startupCommand={agent.preferences?.startupCommand}
                />
              </div>
            )
          })}

          {/* Editor view */}
          {mainView === 'editor' && selectedAgent && (
            <div className="absolute inset-0 flex flex-col">
              {/* Editor sub-tabs */}
              <div className="px-6 pt-2 pb-3 border-b border-border flex gap-1">
                {([['basic', 'Basic'], ['skills', 'Skills'], ['settings', 'Settings']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setEditorTab(key)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      editorTab === key ? 'bg-accent text-text-on-purple' : 'text-text-muted hover:bg-bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Basic tab */}
              {editorTab === 'basic' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Identity */}
                  <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-bg-primary border border-border flex items-center justify-center overflow-hidden">
                        <AvatarPreview config={selectedAgent.avatar} size={40} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={selectedAgent.name}
                          onChange={(e) => updateAgent(selectedAgent.id, { name: e.target.value })}
                          className="w-full px-3 py-1 rounded-lg bg-bg-primary border border-border text-text-primary text-sm font-semibold focus:outline-none focus:border-accent transition-colors"
                          placeholder="Name"
                        />
                        <span className="px-3 py-1 text-xs text-text-muted">{selectedAgent.role || selectedAgent.department}</span>
                      </div>
                      <StatusDot status={selectedAgent.status} />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex gap-1">
                        {ALL_DEPARTMENTS.map((dept) => (
                          <button
                            key={dept}
                            onClick={() => {
                              const newType = dept === 'R&D' ? 'coding' as const : 'non-coding' as const
                              const newRoles = dept === 'R&D' ? RND_ROLES : NON_RND_ROLES
                              updateAgent(selectedAgent.id, {
                                department: dept,
                                type: newType,
                                role: newRoles.includes(selectedAgent.role) ? selectedAgent.role : newRoles[0]
                              })
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                              selectedAgent.department === dept
                                ? 'bg-accent text-text-on-purple'
                                : 'bg-bg-primary border border-border text-text-muted'
                            }`}
                          >{dept}</button>
                        ))}
                      </div>
                      <select
                        value={selectedAgent.role || ''}
                        onChange={(e) => updateAgent(selectedAgent.id, { role: e.target.value })}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent transition-colors"
                      >
                        {(selectedAgent.department === 'R&D' || selectedAgent.type === 'coding' ? RND_ROLES : NON_RND_ROLES).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      value={selectedAgent.group || ''}
                      onChange={(e) => updateAgent(selectedAgent.id, { group: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-muted text-xs focus:outline-none focus:border-accent transition-colors mt-2"
                      placeholder="Team group (e.g. Frontend Team)"
                    />
                  </div>

                  {/* Avatar */}
                  <div className="p-4 rounded-xl bg-bg-secondary border border-border">
                    <AvatarEditor config={selectedAgent.avatar} onChange={(avatar) => updateAgent(selectedAgent.id, { avatar })} size={128} />
                  </div>

                  {/* Soul — split editor + preview */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wider">Soul</label>
                      <button
                        onClick={() => {
                          const t = {
                            id: `custom-${Date.now()}`,
                            name: `${selectedAgent.name} Template`,
                            category: 'custom' as const,
                            department: selectedAgent.department as 'R&D' | 'Non-R&D',
                            role: selectedAgent.role,
                            sections: [
                              { title: 'Full Soul', hint: 'Complete agent definition', content: selectedAgent.soul }
                            ],
                            suggestedSkills: selectedAgent.enabledSkills || [],
                            suggestedModel: selectedAgent.model || 'inherit',
                            suggestedEffort: selectedAgent.effort || 'high',
                          }
                          window.api.templates.save(t)
                        }}
                        className="text-[10px] text-accent hover:text-accent-hover cursor-pointer font-medium"
                      >
                        Save as Template
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2" style={{ height: '280px' }}>
                      <textarea
                        value={selectedAgent.soul}
                        onChange={(e) => updateAgent(selectedAgent.id, { soul: e.target.value })}
                        className="w-full h-full px-3 py-2 rounded-xl bg-bg-secondary border border-border text-text-primary text-xs font-mono leading-relaxed resize-none focus:outline-none focus:border-accent transition-colors"
                        placeholder="Write markdown..."
                      />
                      <div className="h-full px-3 py-2 rounded-xl bg-bg-secondary border border-border overflow-y-auto prose prose-sm prose-invert max-w-none
                        [&_h1]:text-sm [&_h1]:font-heading [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-2 [&_h1]:mb-1
                        [&_h2]:text-xs [&_h2]:font-heading [&_h2]:font-semibold [&_h2]:text-accent [&_h2]:mt-3 [&_h2]:mb-1
                        [&_p]:text-xs [&_p]:text-text-secondary [&_p]:my-1
                        [&_li]:text-xs [&_li]:text-text-secondary
                        [&_ul]:my-1 [&_ol]:my-1
                        [&_code]:text-[10px] [&_code]:bg-bg-primary [&_code]:px-1 [&_code]:rounded">
                        <Markdown>{selectedAgent.soul || '*No content*'}</Markdown>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Skills tab */}
              {editorTab === 'skills' && (
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                    {availableSkills.length === 0 ? (
                      <div className="p-6 text-sm text-text-muted text-center">
                        <p>No skills installed.</p>
                        <p className="text-xs mt-1 font-mono">Install GStack: git clone garrytan/gstack ~/.claude/skills/gstack</p>
                      </div>
                    ) : (
                      (() => {
                        const packs = [...new Set(availableSkills.map((s) => s.pack))]
                        return packs.map((pack) => {
                          const packSkills = availableSkills.filter((s) => s.pack === pack)
                          const enabledCount = packSkills.filter((s) => selectedAgent.enabledSkills?.includes(s.name)).length
                          return (
                            <div key={pack}>
                              <div className="flex items-center justify-between px-4 py-2.5 bg-bg-tertiary border-b border-border">
                                <div className="flex items-center gap-2">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                  </svg>
                                  <span className="text-xs font-heading font-semibold text-text-primary uppercase">{pack}</span>
                                  <span className="text-[10px] text-text-muted">{enabledCount}/{packSkills.length}</span>
                                </div>
                                <button
                                  onClick={() => {
                                    const current = selectedAgent.enabledSkills || []
                                    const allEnabled = packSkills.every((s) => current.includes(s.name))
                                    const next = allEnabled ? current.filter((s) => !packSkills.some((ps) => ps.name === s)) : [...new Set([...current, ...packSkills.map((s) => s.name)])]
                                    updateAgent(selectedAgent.id, { enabledSkills: next })
                                  }}
                                  className="text-[10px] text-accent hover:text-accent-hover cursor-pointer font-medium"
                                >
                                  {packSkills.every((s) => (selectedAgent.enabledSkills || []).includes(s.name)) ? 'Disable all' : 'Enable all'}
                                </button>
                              </div>
                              {packSkills.map((skill) => {
                                const enabled = selectedAgent.enabledSkills?.includes(skill.name) ?? false
                                const isExpanded = expandedSkill === skill.name
                                return (
                                  <div key={skill.name} className="border-b border-border last:border-0">
                                    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-bg-hover transition-colors">
                                      <button
                                        onClick={async () => {
                                          if (isExpanded) {
                                            setExpandedSkill(null)
                                            setSkillContent(null)
                                          } else {
                                            setExpandedSkill(skill.name)
                                            const content = await window.api.skills.readContent(skill.path)
                                            setSkillContent(content)
                                          }
                                        }}
                                        className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-1.5"
                                      >
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                          className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                                          <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                        <span className="text-sm font-medium text-text-primary">/{skill.name}</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          const current = selectedAgent.enabledSkills || []
                                          const next = enabled ? current.filter((s) => s !== skill.name) : [...current, skill.name]
                                          updateAgent(selectedAgent.id, { enabledSkills: next })
                                        }}
                                        className={`ml-3 w-9 h-5 rounded-full cursor-pointer transition-colors relative flex-shrink-0 ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
                                      >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                                      </button>
                                    </div>
                                    {!isExpanded && skill.description && (
                                      <p className="text-[11px] text-text-muted px-4 pb-2 pl-9">{skill.description}</p>
                                    )}
                                    {isExpanded && skillContent && (
                                      <pre className="px-4 py-3 mx-4 mb-3 rounded-lg bg-bg-primary border border-border
                                        text-[11px] text-text-muted font-mono leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                                        {skillContent}
                                      </pre>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })
                      })()
                    )}
                  </div>
                </div>
              )}

              {/* Settings tab */}
              {editorTab === 'settings' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Startup Command */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Startup Command</label>
                    <input
                      type="text"
                      value={selectedAgent.preferences?.startupCommand || ''}
                      onChange={(e) => {
                        const prefs = selectedAgent.preferences || { autoRunClaude: false, startupCommand: '' }
                        updateAgent(selectedAgent.id, { preferences: { ...prefs, startupCommand: e.target.value } })
                      }}
                      placeholder="Override default (e.g. claude --model sonnet)"
                      className="w-full px-3 py-2 rounded-lg bg-bg-secondary border border-border text-text-primary text-sm font-mono focus:outline-none focus:border-accent transition-colors"
                    />
                    <p className="text-[11px] text-text-muted mt-1.5">Leave empty to use app default</p>
                  </div>

                  {/* Work Zone */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Work Zone</label>
                    <div className="space-y-1.5">
                      {selectedProject?.zones
                        .filter((z: Zone) => selectedAgent.type === 'coding' ? z.type === 'rnd' : true)
                        .map((zone: Zone) => (
                          <button
                            key={zone.id}
                            onClick={() => updateAgent(selectedAgent.id, { zoneId: zone.id, worktreePath: undefined, worktreeBranch: undefined })}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                              selectedAgent.zoneId === zone.id
                                ? 'bg-accent-subtle border border-accent/30 text-accent'
                                : 'bg-bg-secondary border border-border text-text-secondary hover:bg-bg-hover'
                            }`}
                          >
                            <span className={`inline-block w-2 h-2 rounded-full ${zone.type === 'rnd' ? 'bg-accent' : 'bg-status-working'}`} />
                            <span className="font-medium">{zone.name}</span>
                            <span className="text-[10px] text-text-muted uppercase ml-auto">{zone.type === 'rnd' ? 'R&D' : 'Docs'}</span>
                          </button>
                        ))}
                    </div>
                    {selectedAgent.worktreePath && (
                      <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-bg-secondary border border-border">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                          <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span className="text-xs text-accent font-mono">{selectedAgent.worktreeBranch}</span>
                        <span className="text-[11px] text-text-muted font-mono truncate">{selectedAgent.worktreePath}</span>
                        <p className="text-[10px] text-text-muted ml-auto">Changing zone will reset worktree</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Logs view */}
          {mainView === 'logs' && selectedAgent && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-text-primary">
                  Work Logs — {selectedAgent.name}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.api.agent.loadLogs(selectedAgent.id).then(setAgentLogs)}
                    className="text-[11px] text-accent hover:text-accent-hover cursor-pointer"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => {
                      window.api.agent.clearLogs(selectedAgent.id).then(() => setAgentLogs([]))
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>
              </div>
              {agentLogs.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-12">No logs yet. Start the agent to begin recording.</p>
              ) : (() => {
                // Group logs into task blocks
                const reversed = [...agentLogs].reverse()
                const taskBlocks: { title?: string; summary?: string; startTime?: string; endTime?: string; statusChanges: number; logs: typeof reversed }[] = []
                let currentBlock: typeof taskBlocks[0] = { statusChanges: 0, logs: [] }

                for (const log of reversed) {
                  if (log.type === 'task_start' && currentBlock.logs.length > 0) {
                    // New task starts — push current block
                    taskBlocks.push(currentBlock)
                    currentBlock = { title: log.message, startTime: log.time, statusChanges: 0, logs: [log] }
                  } else if (log.type === 'task_start') {
                    currentBlock.title = log.message
                    currentBlock.startTime = log.time
                    currentBlock.logs.push(log)
                  } else if (log.type === 'task_done') {
                    currentBlock.summary = log.message
                    currentBlock.endTime = log.time
                    currentBlock.logs.push(log)
                    taskBlocks.push(currentBlock)
                    currentBlock = { statusChanges: 0, logs: [] }
                  } else {
                    if (log.type === 'status') currentBlock.statusChanges++
                    currentBlock.logs.push(log)
                  }
                }
                if (currentBlock.logs.length > 0) taskBlocks.push(currentBlock)

                return (
                  <div className="space-y-3">
                    {taskBlocks.map((block, bi) => (
                      <div key={bi} className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                        {/* Task header */}
                        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
                          {block.title ? (
                            <>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold uppercase">Task</span>
                              <span className="text-sm font-medium text-text-primary">{block.title}</span>
                            </>
                          ) : (
                            <span className="text-sm text-text-muted">Activity</span>
                          )}
                          {block.startTime && (
                            <span className="text-[10px] text-text-muted ml-auto font-mono">
                              {new Date(block.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </span>
                          )}
                        </div>
                        {/* Summary if done */}
                        {block.summary && (
                          <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-status-working/5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-working/20 text-status-working font-semibold uppercase">Done</span>
                            <span className="text-sm text-text-primary">{block.summary}</span>
                          </div>
                        )}
                        {/* Log entries */}
                        <div className="px-4 py-2 space-y-1">
                          {block.logs
                            .filter((l) => l.type !== 'task_start' && l.type !== 'task_done')
                            .filter((l) => l.type !== 'status' || block.logs.filter((x) => x.type !== 'status').length === 0)
                            .slice(0, 10)
                            .map((log, li) => {
                              const time = new Date(log.time)
                              const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                              return (
                                <div key={li} className="flex items-center gap-2 text-[11px]">
                                  <span className="text-text-muted font-mono w-16">{timeStr}</span>
                                  {log.type === 'status' && (
                                    <span className={log.message === 'working' ? 'text-status-working' : 'text-status-waiting'}>
                                      {log.message === 'working' ? 'Working' : 'Idle'}
                                    </span>
                                  )}
                                  {log.type === 'notification' && (
                                    <span className="text-status-waiting">{log.message}</span>
                                  )}
                                  {log.type === 'report' && (
                                    <span className="text-text-muted truncate">{log.message}</span>
                                  )}
                                </div>
                              )
                            })}
                          {block.statusChanges > 3 && (
                            <p className="text-[10px] text-text-muted">{block.statusChanges} status changes</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

        </div>
      </div>

      {/* Files Panel — shows agent's worktree/zone files */}
      {showFiles && selectedProject && selectedAgent && (() => {
        // Read worktreePath directly from latest agents state
        const latestAgent = agents.find((a) => a.id === selectedAgent.id)
        const cwd = latestAgent?.worktreePath || (() => {
          const p = projects.find((p) => p.id === (latestAgent || selectedAgent).projectId)
          const z = p?.zones.find((z: Zone) => z.id === (latestAgent || selectedAgent).zoneId)
          return z?.path || '/'
        })()
        return (
          <>
            <ResizeHandle onResize={(d) => resizePanel('files', d)} />
            <FilesPanel
              project={selectedProject}
              agentCwd={cwd}
              width={panelWidths.files}
            />
          </>
        )
      })()}

      {/* Modals */}
      <CreateProjectModal
        open={showCreateProject}
        onClose={() => setShowCreateProject(false)}
        onCreate={handleCreateProject}
      />
      {selectedProject && (
        <CreateAgentModal
          open={showCreateAgent}
          onClose={() => setShowCreateAgent(false)}
          project={selectedProject}
          availableSkills={availableSkills}
          defaultSkillsRnD={appPrefs.defaultSkillsRnD || []}
          defaultSkillsNonRnD={appPrefs.defaultSkillsNonRnD || []}
          onCreate={handleCreateAgent}
        />
      )}

      <EditTemplateModal
        open={!!editingTemplate}
        template={editingTemplate}
        agents={agents}
        availableSkills={availableSkills}
        onClose={() => setEditingTemplate(null)}
        onSave={(updated, syncAgents) => {
          // Save template
          window.api.templates.save(updated)
          // Sync agents if requested
          if (syncAgents) {
            const buildSoul = (name: string, secs: any[], traits: string[]) => {
              let s = `# Identity\nYou are ${name}.\n\n`
              for (const sec of secs) { if (sec.content.trim()) s += `## ${sec.title}\n${sec.content}\n\n` }
              if (traits.length > 0) s += `## Personality\n${traits.map((t: string) => `- ${t}`).join('\n')}\n\n`
              s += `## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
              return s
            }
            setAgents(prev => prev.map(a => {
              if (a.role === updated.role && a.department === updated.department) {
                return {
                  ...a,
                  soul: buildSoul(a.name, updated.sections, []),
                  enabledSkills: [...new Set([...a.enabledSkills, ...updated.suggestedSkills])],
                  model: updated.suggestedModel,
                  effort: updated.suggestedEffort,
                }
              }
              return a
            }))
          }
        }}
      />
    </div>
  )
}
