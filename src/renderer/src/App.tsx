import { useState, useEffect } from 'react'
import Terminal from './components/Terminal'
import CreateProjectModal from './components/CreateProjectModal'
import CreateAgentModal from './components/CreateAgentModal'
import type { Project, Agent, Zone, SkillInfo } from './types'

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
  const [mainView, setMainView] = useState<'terminal' | 'editor' | 'logs'>('terminal')
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [appPrefs, setAppPrefs] = useState({ autoRunClaude: true })
  const [agentReports, setAgentReports] = useState<Record<string, { text: string; done: boolean }[]>>({})
  const [agentLogs, setAgentLogs] = useState<{ time: string; type: string; message: string }[]>([])
  const [projectScans, setProjectScans] = useState<Record<string, {
    projectStage: string
    todos: { zone: string; type: string; category: string; text: string; done: boolean }[]
  }>>({})

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null
  const projectScan = selectedProjectId ? projectScans[selectedProjectId] || null : null
  const projectAgents = agents.filter((a) => a.projectId === selectedProjectId)
  const departments = [...new Set(projectAgents.map((a) => a.department))]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Load data on mount
  useEffect(() => {
    window.api.data.load().then((data) => {
      if (data.projects) setProjects(data.projects as Project[])
      if (data.agents) setAgents(data.agents as Agent[])
      if (data.appPrefs) setAppPrefs(data.appPrefs as typeof appPrefs)
    })
    window.api.skills.scan().then(setAvailableSkills)
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
    const removeReport = window.api.agent.onReport(({ agentId, items }) => {
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

    // Link enabled skills to working directory
    if (agent.enabledSkills?.length) {
      const skillPaths = agent.enabledSkills
        .map((name) => availableSkills.find((s) => s.name === name)?.path)
        .filter(Boolean) as string[]
      if (skillPaths.length) {
        await window.api.skills.link(zone.path, skillPaths)
      }
    }

    // Setup Claude Code hooks for status reporting
    await window.api.agent.setupHooks(zone.path, agent.id)

    setActiveTerminals((prev) => new Set(prev).add(agent.id))
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, status: 'working' as const } : a))
    )
    setSelectedAgentId(agent.id)
    setMainView('terminal')
  }

  const getAgentCwd = (agent: Agent): string => {
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

  const DEPARTMENTS = ['Engineering', 'Design', 'Research', 'QA', 'Operations']

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Left: Projects */}
      <div className="w-52 bg-sidebar-bg border-r border-border flex flex-col">
        <div className="drag-region h-16 flex items-end px-4 pb-2 justify-between">
          <h2 className="no-drag text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            Projects
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

      {/* Middle: Agents */}
      <div className="w-60 bg-bg-secondary border-r border-border flex flex-col">
        <div className="drag-region h-16 flex items-end px-4 pb-2">
          <h2 className="no-drag text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            {selectedProject ? selectedProject.name : 'Agents'}
          </h2>
        </div>
        {selectedProject ? (
          <>
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
              {departments.map((dept) => (
                <div key={dept}>
                  <div className="px-3 py-1.5 text-[11px] font-heading font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                    {dept}
                  </div>
                  <div className="space-y-0.5">
                    {projectAgents
                      .filter((a) => a.department === dept)
                      .map((agent) => (
                        <div
                          key={agent.id}
                          className={`group w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5
                            transition-colors cursor-pointer ${
                            selectedAgentId === agent.id
                              ? 'bg-accent-subtle text-accent font-medium'
                              : 'text-text-secondary hover:bg-bg-hover'
                          }`}
                          onClick={() => {
                            setSelectedAgentId(agent.id)
                            if (!activeTerminals.has(agent.id)) startAgent(agent)
                          }}
                        >
                          <StatusDot status={agent.status} />
                          <span className="truncate">{agent.name}</span>
                          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedAgentId(agent.id)
                                setMainView('editor')
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center
                                text-text-muted hover:text-accent hover:bg-bg-active transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (activeTerminals.has(agent.id)) {
                                  window.api.pty.kill(agent.id)
                                  setActiveTerminals((prev) => {
                                    const next = new Set(prev)
                                    next.delete(agent.id)
                                    return next
                                  })
                                }
                                setAgents((prev) => prev.filter((a) => a.id !== agent.id))
                                if (selectedAgentId === agent.id) setSelectedAgentId(null)
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center
                                text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                              title="Delete"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                          <span className="text-[10px] text-text-muted uppercase group-hover:hidden">
                            {agent.type === 'coding' ? 'dev' : 'res'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
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

      {/* Right: Main Panel */}
      <div className="flex-1 flex flex-col bg-bg-primary">
        <div className="drag-region h-16 flex items-end px-4 pb-2 justify-between">
          <div className="no-drag flex items-center gap-2">
            <h2 className="text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
              {selectedAgent ? selectedAgent.name : (selectedProject ? 'Dashboard' : 'Select an agent')}
            </h2>
            {selectedAgent && (
              <span className="text-[10px] text-text-muted font-mono px-2 py-0.5 rounded-md bg-bg-hover truncate max-w-[300px]">
                {getAgentZonePath(selectedAgent)}
              </span>
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

          {/* Project Dashboard */}
          {!selectedAgent && selectedProject && (
            <div className="absolute inset-0 overflow-y-auto p-6 space-y-6">
              {/* Project Status Card */}
              <div className="p-5 rounded-xl bg-bg-secondary border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className="text-xl font-heading font-bold text-text-primary">{selectedProject.name}</h1>
                    <p className="text-xs text-text-muted mt-0.5 font-mono">{selectedProject.officePath}</p>
                  </div>
                  {projectScan && (
                    <span className={`px-3 py-1 rounded-full text-xs font-heading font-bold uppercase tracking-wider ${
                      projectScan.projectStage === 'active-online' ? 'bg-status-working/20 text-status-working' :
                      projectScan.projectStage === 'active' ? 'bg-status-working/20 text-status-working' :
                      projectScan.projectStage === 'incubating' ? 'bg-status-waiting/20 text-status-waiting' :
                      'bg-bg-hover text-text-muted'
                    }`}>
                      {projectScan.projectStage.replace('-', ' ')}
                    </span>
                  )}
                </div>

                {/* Todo Summary */}
                {projectScan && projectScan.todos.length > 0 && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    {/* R&D Todos */}
                    <div>
                      {(() => {
                        const rdTodos = projectScan.todos
                          .filter((t) => t.category === 'rd' || (t.type === 'rnd' && t.category === 'other'))
                          .sort((a, b) => Number(a.done) - Number(b.done))
                        const openCount = rdTodos.filter((t) => !t.done).length
                        const doneCount = rdTodos.filter((t) => t.done).length
                        return <>
                          <h4 className="text-[11px] font-heading font-semibold text-accent uppercase tracking-wider mb-2">
                            R&D ({openCount} open{doneCount > 0 ? ` · ${doneCount} done` : ''})
                          </h4>
                          <div className="space-y-1">
                            {rdTodos.filter((t) => !t.done).slice(0, 8).map((t, i) => (
                              <div key={i} className="flex items-start gap-2 text-[12px]">
                                <span className="text-text-muted">{'\u25CB'}</span>
                                <span className="text-text-primary">{t.text}</span>
                              </div>
                            ))}
                            {doneCount > 0 && (
                              <p className="text-[11px] text-text-muted mt-1">{doneCount} completed</p>
                            )}
                          </div>
                        </>
                      })()}
                    </div>

                    {/* Admin Todos */}
                    <div>
                      {(() => {
                        const adminTodos = projectScan.todos
                          .filter((t) => t.type === 'non-rnd')
                          .sort((a, b) => Number(a.done) - Number(b.done))
                        const openCount = adminTodos.filter((t) => !t.done).length
                        const doneCount = adminTodos.filter((t) => t.done).length
                        const hasNonRndZone = selectedProject.zones.some((z: Zone) => z.type === 'non-rnd')
                        return <>
                          <h4 className="text-[11px] font-heading font-semibold text-status-waiting uppercase tracking-wider mb-2">
                            Admin {adminTodos.length > 0 ? `(${openCount} open${doneCount > 0 ? ` · ${doneCount} done` : ''})` : ''}
                          </h4>
                          {adminTodos.length === 0 ? (
                            <div className="text-center py-3">
                              <p className="text-xs text-text-muted mb-2">
                                {hasNonRndZone ? 'No todos found in docs folder.' : 'No Non-R&D zone configured.'}
                              </p>
                              <button
                                onClick={() => {
                                  setShowCreateAgent(true)
                                }}
                                className="px-3 py-1.5 rounded-lg bg-accent text-text-on-purple text-xs font-medium
                                  hover:bg-accent-hover transition-colors cursor-pointer"
                              >
                                Create Business Manager
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {adminTodos.filter((t) => !t.done).slice(0, 8).map((t, i) => (
                                <div key={i} className="flex items-start gap-2 text-[12px]">
                                  <span className="text-text-muted">{'\u25CB'}</span>
                                  <span className="text-text-primary">{t.text}</span>
                                  <span className="text-[10px] text-text-muted ml-auto flex-shrink-0">{t.category}</span>
                                </div>
                              ))}
                              {doneCount > 0 && (
                                <p className="text-[11px] text-text-muted mt-1">{doneCount} completed</p>
                              )}
                            </div>
                          )}
                        </>
                      })()}
                    </div>
                  </div>
                )}

                {projectScan && projectScan.todos.length === 0 && (
                  <p className="text-xs text-text-muted mt-2">No todos found in project markdown files.</p>
                )}
              </div>

              {/* Agent Kanban */}
              <div>
                <div className="grid grid-cols-3 gap-3">
                  {(['working', 'waiting', 'done'] as const).map((status) => {
                    const statusLabel = { working: 'Working', waiting: 'Waiting', done: 'Idle' }
                    const statusColor = { working: 'bg-status-working', waiting: 'bg-status-waiting', done: 'bg-status-done' }
                    const columnAgents = projectAgents.filter((a) => a.status === status)
                    return (
                      <div key={status} className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                        <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
                          <span className={`w-2.5 h-2.5 rounded-full ${statusColor[status]}`} />
                          <span className="text-sm font-heading font-bold text-text-primary">
                            {statusLabel[status]}
                          </span>
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
                                <span className="text-sm font-medium text-text-primary">{agent.name}</span>
                                <span className="text-[10px] text-text-muted uppercase ml-auto">
                                  {agent.type === 'coding' ? 'dev' : 'res'}
                                </span>
                              </div>
                              <p className="text-[11px] text-text-muted mt-1">{agent.department}</p>
                              {agentReports[agent.id] && agentReports[agent.id].length > 0 && (
                                <div className="mt-2 pt-2 border-t border-border space-y-1">
                                  {agentReports[agent.id].slice(0, 4).map((item, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                                      <span className={item.done ? 'text-status-working' : 'text-text-muted'}>
                                        {item.done ? '\u2713' : '\u25CB'}
                                      </span>
                                      <span className={item.done ? 'text-text-muted line-through' : 'text-text-secondary'}>
                                        {item.text}
                                      </span>
                                    </div>
                                  ))}
                                  {agentReports[agent.id].length > 4 && (
                                    <p className="text-[10px] text-text-muted">+{agentReports[agent.id].length - 4} more</p>
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

              {/* Zones */}
              <div>
                <h3 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-3">
                  Work Zones
                </h3>
                <div className="space-y-2">
                  {selectedProject.zones.map((zone: Zone) => {
                    const zoneAgents = projectAgents.filter((a) => a.zoneId === zone.id)
                    return (
                      <div key={zone.id} className="flex items-center gap-3 p-3 rounded-xl bg-bg-secondary border border-border">
                        <span className={`w-2.5 h-2.5 rounded-full ${zone.type === 'rnd' ? 'bg-accent' : 'bg-status-waiting'}`} />
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
                  cwd={getAgentCwd(agent)}
                  visible={isVisible}
                  autoRunClaude={appPrefs.autoRunClaude}
                  startupCommand={agent.preferences?.startupCommand}
                />
              </div>
            )
          })}

          {/* Editor view */}
          {mainView === 'editor' && selectedAgent && (
            <div className="absolute inset-0 overflow-y-auto p-6 space-y-6">
              {/* Identity */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Identity
                </label>
                <div className="p-4 rounded-xl bg-bg-secondary border border-border space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-accent-subtle flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={selectedAgent.name}
                      onChange={(e) => updateAgent(selectedAgent.id, { name: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-bg-primary border border-border
                        text-text-primary text-sm font-semibold
                        focus:outline-none focus:border-accent transition-colors"
                    />
                    <StatusDot status={selectedAgent.status} />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={selectedAgent.department}
                      onChange={(e) => updateAgent(selectedAgent.id, { department: e.target.value })}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-bg-primary border border-border
                        text-text-primary text-sm cursor-pointer
                        focus:outline-none focus:border-accent transition-colors"
                    >
                      {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateAgent(selectedAgent.id, { type: 'coding' })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                          selectedAgent.type === 'coding'
                            ? 'bg-accent text-text-on-purple'
                            : 'bg-bg-primary border border-border text-text-muted'
                        }`}
                      >Coding</button>
                      <button
                        onClick={() => updateAgent(selectedAgent.id, { type: 'non-coding' })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                          selectedAgent.type === 'non-coding'
                            ? 'bg-accent text-text-on-purple'
                            : 'bg-bg-primary border border-border text-text-muted'
                        }`}
                      >Research</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Soul */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Soul (soul.md)
                </label>
                <textarea
                  value={selectedAgent.soul}
                  onChange={(e) => updateAgent(selectedAgent.id, { soul: e.target.value })}
                  className="w-full h-56 px-4 py-3 rounded-xl bg-bg-secondary border border-border
                    text-text-primary text-sm font-mono leading-relaxed resize-y
                    focus:outline-none focus:border-accent transition-colors"
                  placeholder="Define this agent's role, personality, and boundaries..."
                />
              </div>

              {/* Skills */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Skills
                </label>
                <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                  {availableSkills.length === 0 ? (
                    <div className="p-4 text-sm text-text-muted">
                      No skills installed. Install GStack or other skills to ~/.claude/skills/
                    </div>
                  ) : (
                    (() => {
                      const packs = [...new Set(availableSkills.map((s) => s.pack))]
                      return packs.map((pack) => {
                        const packSkills = availableSkills.filter((s) => s.pack === pack)
                        const enabledCount = packSkills.filter(
                          (s) => selectedAgent.enabledSkills?.includes(s.name)
                        ).length
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
                                  const next = allEnabled
                                    ? current.filter((s) => !packSkills.some((ps) => ps.name === s))
                                    : [...new Set([...current, ...packSkills.map((s) => s.name)])]
                                  updateAgent(selectedAgent.id, { enabledSkills: next })
                                }}
                                className="text-[10px] text-accent hover:text-accent-hover cursor-pointer font-medium"
                              >
                                {packSkills.every((s) => (selectedAgent.enabledSkills || []).includes(s.name))
                                  ? 'Disable all' : 'Enable all'}
                              </button>
                            </div>
                            {packSkills.map((skill) => {
                              const enabled = selectedAgent.enabledSkills?.includes(skill.name) ?? false
                              return (
                                <div
                                  key={skill.name}
                                  className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-bg-hover transition-colors"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-text-primary">/{skill.name}</span>
                                    </div>
                                    {skill.description && (
                                      <p className="text-[11px] text-text-muted mt-0.5 truncate">{skill.description}</p>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => {
                                      const current = selectedAgent.enabledSkills || []
                                      const next = enabled
                                        ? current.filter((s) => s !== skill.name)
                                        : [...current, skill.name]
                                      updateAgent(selectedAgent.id, { enabledSkills: next })
                                    }}
                                    className={`ml-3 w-9 h-5 rounded-full cursor-pointer transition-colors relative flex-shrink-0 ${
                                      enabled ? 'bg-accent' : 'bg-bg-hover'
                                    }`}
                                  >
                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                      enabled ? 'left-[18px]' : 'left-0.5'
                                    }`} />
                                  </button>
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

              {/* Agent Startup */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Startup Command
                </label>
                <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
                  <div className="px-4 py-3">
                    <input
                      type="text"
                      value={selectedAgent.preferences?.startupCommand || ''}
                      onChange={(e) => {
                        const prefs = selectedAgent.preferences || { autoRunClaude: false, startupCommand: '' }
                        updateAgent(selectedAgent.id, {
                          preferences: { ...prefs, startupCommand: e.target.value }
                        })
                      }}
                      placeholder="Override default (e.g. claude --model sonnet)"
                      className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border
                        text-text-primary text-sm font-mono
                        focus:outline-none focus:border-accent transition-colors"
                    />
                    <p className="text-[11px] text-text-muted mt-1.5">Leave empty to use app default (auto-run claude)</p>
                  </div>
                </div>
              </div>

              {/* Work Zone */}
              <div>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Work Zone
                </label>
                <div className="p-3 rounded-xl bg-bg-secondary border border-border text-sm">
                  {(() => {
                    const zone = selectedProject?.zones.find((z: Zone) => z.id === selectedAgent.zoneId)
                    return zone ? (
                      <div className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          zone.type === 'rnd' ? 'bg-accent' : 'bg-status-waiting'
                        }`} />
                        <span className="font-medium">{zone.name}</span>
                        <span className="text-text-muted text-xs font-mono">{zone.path}</span>
                      </div>
                    ) : <span className="text-text-muted">No zone assigned</span>
                  })()}
                </div>
              </div>
            </div>
          )}
          {/* Logs view */}
          {mainView === 'logs' && selectedAgent && (
            <div className="absolute inset-0 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-heading font-semibold text-text-primary">
                  Work Logs — {selectedAgent.name}
                </h3>
                <button
                  onClick={() => window.api.agent.loadLogs(selectedAgent.id).then(setAgentLogs)}
                  className="text-[11px] text-accent hover:text-accent-hover cursor-pointer"
                >
                  Refresh
                </button>
              </div>
              {agentLogs.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-12">No logs yet. Start the agent to begin recording.</p>
              ) : (
                <div className="space-y-1">
                  {[...agentLogs].reverse().map((log, i) => {
                    const time = new Date(log.time)
                    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    const statusColors: Record<string, string> = {
                      working: 'text-status-working',
                      waiting: 'text-status-waiting',
                      done: 'text-status-done'
                    }
                    return (
                      <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary transition-colors">
                        <div className="text-[11px] text-text-muted font-mono w-24 flex-shrink-0">
                          <span>{dateStr}</span>{' '}
                          <span>{timeStr}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {log.type === 'status' ? (
                            <span className={`text-sm font-medium ${statusColors[log.message] || 'text-text-primary'}`}>
                              {log.message === 'working' ? 'Started working' :
                               log.message === 'waiting' ? 'Waiting for input' :
                               log.message === 'done' ? 'Task completed' : log.message}
                            </span>
                          ) : (
                            <div>
                              <span className="text-sm font-medium text-text-primary">Report</span>
                              <pre className="text-[11px] text-text-muted mt-1 whitespace-pre-wrap">{log.message}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

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
          onCreate={handleCreateAgent}
        />
      )}
    </div>
  )
}
