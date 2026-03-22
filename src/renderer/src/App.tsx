import { useState, useEffect } from 'react'
import Terminal from './components/Terminal'
import AvatarEditor, { AvatarPreview } from './components/AvatarEditor'
import CreateProjectModal from './components/CreateProjectModal'
import CreateAgentModal from './components/CreateAgentModal'
import ProjectSettingsModal from './components/ProjectSettingsModal'
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
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [projectTab, setProjectTab] = useState<'dashboard' | 'settings'>('dashboard')
  const [mainView, setMainView] = useState<'terminal' | 'editor' | 'logs'>('terminal')
  const [editorTab, setEditorTab] = useState<'basic' | 'skills' | 'settings'>('basic')
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [appPrefs, setAppPrefs] = useState({ autoRunClaude: true, maxLogs: 100 })
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

  // Load data on mount — reset all agents to idle (terminals disconnected on restart)
  useEffect(() => {
    window.api.data.load().then((data) => {
      if (data.projects) setProjects(data.projects as Project[])
      if (data.agents) {
        const resetAgents = (data.agents as Agent[]).map((a) => ({ ...a, status: 'done' as const }))
        setAgents(resetAgents)
      }
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
    window.api.agent.writeSoul(agent.id, agent.soul)
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

    // Link enabled skills to working directory
    if (agent.enabledSkills?.length) {
      const skillPaths = agent.enabledSkills
        .map((name) => availableSkills.find((s) => s.name === name)?.path)
        .filter(Boolean) as string[]
      if (skillPaths.length) {
        await window.api.skills.link(cwd, skillPaths)
      }
    }

    // Setup Claude Code hooks for status reporting
    await window.api.agent.setupHooks(cwd, agent.id)

    setActiveTerminals((prev) => new Set(prev).add(agent.id))
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, status: 'working' as const } : a))
    )
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

  const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
  const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']
  const ALL_DEPARTMENTS = ['R&D', 'Non-R&D']

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
                              onClick={async (e) => {
                                e.stopPropagation()
                                if (activeTerminals.has(agent.id)) {
                                  window.api.pty.kill(agent.id)
                                  setActiveTerminals((prev) => {
                                    const next = new Set(prev)
                                    next.delete(agent.id)
                                    return next
                                  })
                                }
                                // Clean up worktree
                                if (agent.worktreePath) {
                                  const zone = selectedProject?.zones.find((z: Zone) => z.id === agent.zoneId)
                                  if (zone) await window.api.git.worktreeRemove(zone.path, agent.worktreePath)
                                }
                                window.api.agent.deleteSoul(agent.id)
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
                            {agent.role || agent.department}
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

          {/* Project View (Dashboard / Settings tabs) */}
          {!selectedAgent && selectedProject && (
            <div className="absolute inset-0 flex flex-col">
              {/* Project Header + Tabs in title bar area */}
              <div className="px-6 pt-2 pb-3 border-b border-border flex items-center gap-4">
                <div className="flex gap-1">
                  {([['dashboard', 'Project'], ['settings', 'Settings']] as const).map(([key, label]) => (
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

              {/* Dashboard Tab */}
              {projectTab === 'dashboard' && (
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
                          return (
                            <span className="text-[11px] text-text-muted ml-auto">
                              {open} open{done > 0 ? ` · ${done} done` : ''}
                            </span>
                          )
                        })()}
                      </div>
                      {projectScan && (() => {
                        const rdTodos = projectScan.todos
                          .filter((t) => t.category === 'rd' || (t.type === 'rnd' && t.category === 'other'))
                          .filter((t) => !t.done)
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
                        ) : (
                          <p className="text-xs text-text-muted py-2">No open R&D todos</p>
                        )
                      })()}
                    </div>

                    {/* Admin Card */}
                    <div className="glass-card-warm p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-waiting)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                        </svg>
                        <h3 className="text-sm font-heading font-bold text-text-primary">Admin</h3>
                        {projectScan && (() => {
                          const adminTodos = projectScan.todos.filter((t) => t.type === 'non-rnd')
                          const open = adminTodos.filter((t) => !t.done).length
                          const done = adminTodos.filter((t) => t.done).length
                          return (
                            <span className="text-[11px] text-text-muted ml-auto">
                              {open} open{done > 0 ? ` · ${done} done` : ''}
                            </span>
                          )
                        })()}
                      </div>
                      {projectScan && (() => {
                        const adminTodos = projectScan.todos.filter((t) => t.type === 'non-rnd').filter((t) => !t.done)
                        const hasNonRnd = selectedProject.zones.some((z: Zone) => z.type === 'non-rnd')
                        return adminTodos.length > 0 ? (
                          <div className="space-y-1.5">
                            {adminTodos.slice(0, 8).map((t, i) => (
                              <div key={i} className="flex items-start gap-2 text-[12px]">
                                <span className="text-status-waiting mt-0.5">{'\u25CB'}</span>
                                <span className="text-text-primary flex-1">{t.text}</span>
                                <span className="text-[10px] text-text-muted flex-shrink-0">{t.category}</span>
                              </div>
                            ))}
                            {adminTodos.length > 8 && <p className="text-[11px] text-text-muted">+{adminTodos.length - 8} more</p>}
                          </div>
                        ) : (
                          <div className="text-center py-2">
                            <p className="text-xs text-text-muted mb-2">{hasNonRnd ? 'No open admin todos' : 'No Non-R&D zone'}</p>
                            <button
                              onClick={() => setShowCreateAgent(true)}
                              className="px-3 py-1.5 rounded-lg bg-accent text-text-on-purple text-xs font-medium
                                hover:bg-accent-hover transition-colors cursor-pointer"
                            >
                              Create Business Manager
                            </button>
                          </div>
                        )
                      })()}
                    </div>
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
                                {agentReports[agent.id] && agentReports[agent.id].length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-border space-y-1">
                                    {agentReports[agent.id].slice(0, 3).map((item, i) => (
                                      <div key={i} className="flex items-start gap-1.5 text-[11px]">
                                        <span className={item.done ? 'text-status-working' : 'text-text-muted'}>
                                          {item.done ? '\u2713' : '\u25CB'}
                                        </span>
                                        <span className={item.done ? 'text-text-muted line-through' : 'text-text-secondary'}>
                                          {item.text}
                                        </span>
                                      </div>
                                    ))}
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
                  </div>

                  {/* Avatar */}
                  <div className="p-4 rounded-xl bg-bg-secondary border border-border">
                    <AvatarEditor config={selectedAgent.avatar} onChange={(avatar) => updateAgent(selectedAgent.id, { avatar })} size={128} />
                  </div>

                  {/* Soul */}
                  <div>
                    <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Soul</label>
                    <textarea
                      value={selectedAgent.soul}
                      onChange={(e) => { updateAgent(selectedAgent.id, { soul: e.target.value }); window.api.agent.writeSoul(selectedAgent.id, e.target.value) }}
                      className="w-full h-56 px-4 py-3 rounded-xl bg-bg-secondary border border-border text-text-primary text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-accent transition-colors"
                      placeholder="Define this agent's role, personality, and boundaries..."
                    />
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
                                return (
                                  <div key={skill.name} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <span className="text-sm font-medium text-text-primary">/{skill.name}</span>
                                      {skill.description && <p className="text-[11px] text-text-muted mt-0.5">{skill.description}</p>}
                                    </div>
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
                    <div className="p-3 rounded-xl bg-bg-secondary border border-border text-sm space-y-2">
                      {(() => {
                        const zone = selectedProject?.zones.find((z: Zone) => z.id === selectedAgent.zoneId)
                        return zone ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-2 h-2 rounded-full ${zone.type === 'rnd' ? 'bg-accent' : 'bg-status-waiting'}`} />
                              <span className="font-medium">{zone.name}</span>
                              <span className="text-text-muted text-xs font-mono">{zone.path}</span>
                            </div>
                            {selectedAgent.worktreePath && (
                              <div className="flex items-center gap-2 pt-1 border-t border-border">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                                  <path d="M18 9a9 9 0 0 1-9 9" />
                                </svg>
                                <span className="text-xs text-accent font-mono">{selectedAgent.worktreeBranch}</span>
                                <span className="text-[11px] text-text-muted font-mono truncate">{selectedAgent.worktreePath}</span>
                              </div>
                            )}
                          </>
                        ) : <span className="text-text-muted">No zone assigned</span>
                      })()}
                    </div>
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
                              {log.message === 'working' ? 'Working' :
                               log.message === 'waiting' ? 'Idle' :
                               log.message === 'done' ? 'Done' : log.message}
                            </span>
                          ) : log.type === 'task_start' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold uppercase">Start</span>
                              <span className="text-sm text-text-primary">{log.message}</span>
                            </div>
                          ) : log.type === 'task_done' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-working/20 text-status-working font-semibold uppercase">Done</span>
                              <span className="text-sm text-text-primary">{log.message}</span>
                            </div>
                          ) : log.type === 'notification' ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-waiting/20 text-status-waiting font-semibold uppercase">Note</span>
                              <span className="text-sm text-text-primary">{log.message}</span>
                            </div>
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
