import { useState, useEffect, useCallback, useRef } from 'react'
import Terminal from './components/Terminal'
import AvatarEditor, { AvatarPreview } from './components/AvatarEditor'
import Modal from './components/Modal'
import CreateProjectModal from './components/CreateProjectModal'
import CreateAgentModal from './components/CreateAgentModal'
import ProjectSettingsModal from './components/ProjectSettingsModal'
import ResizeHandle from './components/ResizeHandle'
import EditTemplateModal from './components/EditTemplateModal'
import FilesPanel from './components/FilesPanel'
import MarkdownPreviewModal from './components/MarkdownPreviewModal'
import OfficeView from './components/OfficeView'
import CreateTaskGroupModal from './components/CreateTaskGroupModal'
import AgentDeleteConfirmModal, { AgentDeleteImpact } from './components/AgentDeleteConfirmModal'
import ClaudeGate from './components/ClaudeGate'
import Markdown from 'react-markdown'
import type { Project, Agent, Zone, SkillInfo, TaskGroup, Task } from './types'
import { BUILTIN_TEMPLATES, clampChatFontSize, CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX } from './types'
import { NoteTag } from './noteTag'
import { projectListState } from './projectListState'
import { PALETTES, type Palette, PALETTE_META, loadPalette, applyPalette, STYLES, type Style, STYLE_META, loadStyle, applyStyle } from './palette'
import { OverviewPage } from './components/OverviewPage'
import { formatTimeSince } from './timeSince'
import { pickLRUToEvict } from './lru-terminals'
import { confirmDialog } from './components/ConfirmDialog'

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
  // v2.6.0: accent-palette overlay. Layered on top of light/dark theme.
  // 'neon-purple' = default (no data-palette attribute), matches historic look.
  const [palette, setPalette] = useState<Palette>(() => loadPalette())
  // v2.9.0: visual STYLE (accent | prime), orthogonal to palette.
  // Prime is a full CRT/HUD language swap; accent = shipping look.
  const [style, setStyle] = useState<Style>(() => loadStyle())
  // Claude CLI gate: null = checking, then { installed, installCommand }.
  // Block the app until claude is runnable (or the user clicks "Continue").
  const [claudeEnv, setClaudeEnv] = useState<{ installed: boolean; installCommand: string } | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  // false until the initial data.load() settles, so the sidebar shows a
  // "scanning" state instead of flashing "No projects yet" on cold open.
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeTerminals, setActiveTerminals] = useState<Set<string>>(new Set())
  // v2.15.7: last-touched timestamp per agent (Map in a ref instead of
  // useState so bumping doesn't churn re-renders). Read by pickLRUToEvict
  // when the set hits MAX_ACTIVE_TERMINALS to choose which sticky
  // HiveChat to unmount for memory reclamation.
  const lastAccessedAtRef = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (selectedAgentId) lastAccessedAtRef.current.set(selectedAgentId, Date.now())
  }, [selectedAgentId])
  // v2.1.0: agent IDs currently running a Handoff. Drives the 🥴 sticker
  // overlay on AvatarPreview. Refreshed from handoff:progress/done events +
  // a 4s poll fallback (handles cases where events were missed during a
  // renderer reload). Cheap: the poll returns a small string array.
  const [activeHandoffAgentIds, setActiveHandoffAgentIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const api = (window as any).api?.handoff
    if (!api?.activeAgentIds) return
    let cancelled = false
    const refresh = async () => {
      try {
        const ids: string[] = await api.activeAgentIds()
        if (!cancelled) setActiveHandoffAgentIds(new Set(ids))
      } catch { /* silent */ }
    }
    refresh()
    const iv = setInterval(refresh, 4000)
    const off1 = api.onProgress?.(() => refresh())
    const off2 = api.onDone?.(() => refresh())
    return () => { cancelled = true; clearInterval(iv); off1?.(); off2?.() }
  }, [])
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<any>(null)
  const [customTemplates, setCustomTemplates] = useState<any[]>([])
  const [showAppSettings, setShowAppSettings] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null)
  const [teamPrompt, setTeamPrompt] = useState<{ dept: string } | null>(null)
  const [teamNameInput, setTeamNameInput] = useState('')
  const [teamSelectedAgents, setTeamSelectedAgents] = useState<Set<string>>(new Set())
  const [isListening, setIsListening] = useState(false)
  const [speechPartial, setSpeechPartial] = useState('')
  const [projectTab, setProjectTab] = useState<'dashboard' | 'office' | 'taskgroup' | 'settings'>('dashboard')
  // v2.6.0: top-level app screen. 'projects' = the historic project-focused
  // view (sidebar + agents + chat). 'overview' = the new cross-project
  // Overview dashboard (KPI cards, working-now, idle sessions, sleeping
  // agents). Persisted so a user who lives in Overview doesn't get bounced
  // back to Projects on every app restart.
  const [mainScreen, setMainScreen] = useState<'projects' | 'overview'>(() => {
    const saved = localStorage.getItem('hive:mainScreen')
    return saved === 'overview' ? 'overview' : 'projects'
  })
  useEffect(() => { localStorage.setItem('hive:mainScreen', mainScreen) }, [mainScreen])
  const [mainView, setMainView] = useState<'terminal' | 'editor' | 'logs'>('terminal')
  const [editorTab, setEditorTab] = useState<'basic' | 'skills' | 'settings'>('basic')
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([])
  const [appPrefs, setAppPrefs] = useState({
    autoRunClaude: true, maxLogs: 100, continueSession: true,
    defaultSkillsRnD: ['review', 'qa', 'ship'] as string[],
    defaultSkillsNonRnD: ['browse'] as string[],
    // v2.8.2: chat font size is a GLOBAL preference — same value for
    // every project. v2.7.1 mistakenly put it on Project; that's now
    // the deprecated field and the app-level value wins.
    chatFontSize: 13 as number,
  })
  const [panelWidths, setPanelWidths] = useState({ projects: 200, agents: 240, files: 220 })
  const [showFiles, setShowFiles] = useState(true)
  const [agentReports, setAgentReports] = useState<Record<string, { text: string; done: boolean }[]>>({})
  const [agentTasks, setAgentTasks] = useState<Record<string, { title?: string; summary?: string; active: boolean }>>({})
  const [agentLogs, setAgentLogs] = useState<{ time: string; type: string; message: string }[]>([])
  /// v2.8.0: last-event epoch ms per agent. Written on agent:status /
  /// agent:report — every observable activity bumps it. Used by the
  /// dept-list "time-since" chip so idle agents show `2h` / `1d` and
  /// active ones show `now` / `4m`. Persisted to localStorage so a
  /// renderer restart doesn't reset every agent to "never seen".
  const [lastEventAt, setLastEventAt] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('hive:lastEventAt') || '{}') } catch { return {} }
  })
  const bumpLastEventAt = useCallback((agentId: string) => {
    setLastEventAt((prev) => {
      const next = { ...prev, [agentId]: Date.now() }
      try { localStorage.setItem('hive:lastEventAt', JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])
  /// v2.8.2: agents whose claude subprocess has actually emitted at
  /// least one status/report event THIS app launch. Distinguishes a
  /// truly-running session from a mounted-but-idle HiveChat pane
  /// (which the user might have opened just to see the Resume/New/
  /// Fork chooser — no claude spawned yet). In-memory only; resets
  /// on app open. Overview reads THIS, not activeTerminals, so "N
  /// session panes" only counts genuinely alive claude processes.
  const [liveSessionAgents, setLiveSessionAgents] = useState<Set<string>>(new Set())
  const markLiveSession = useCallback((agentId: string) => {
    setLiveSessionAgents((prev) => {
      if (prev.has(agentId)) return prev
      const next = new Set(prev)
      next.add(agentId)
      return next
    })
  }, [])
  /// v2.8.0: 30s ticker that re-renders the dept list so time-since
  /// chips (`4m` → `5m`) refresh without needing a user interaction.
  /// One state variable + one interval — cheap enough to run always.
  const [nowTick, setNowTick] = useState<number>(() => Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(iv)
  }, [])
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<string | null>(null)
  const [projectScans, setProjectScans] = useState<Record<string, {
    projectStage: string
    todos: { zone: string; type: string; category: string; text: string; done: boolean }[]
  }>>({})
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([])
  const [batchTasks, setBatchTasks] = useState<Record<string, Task[]>>({}) // projectId → tasks
  const [managerReports, setManagerReports] = useState<{ title: string; message: string; time: string }[]>([])
  const [batchProposal, setBatchProposal] = useState<any>(null)
  const [showCreateTaskGroup, setShowCreateTaskGroup] = useState(false)
  const [dispatcherLog, setDispatcherLog] = useState<{ time: string; action: string; detail: string; agentId?: string | null }[]>([])
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [autoApprove, setAutoApprove] = useState(false)
  const autoApproveRef = useRef(false)
  useEffect(() => { autoApproveRef.current = autoApprove }, [autoApprove])
  useEffect(() => {
    window.api.claude.status().then(setClaudeEnv)
  }, [])
  const [commitData, setCommitData] = useState<Record<string, Record<string, number>>>({}) // agentId → {date: count}
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; projectId: string } | null>(null)
  const [agentContextMenu, setAgentContextMenu] = useState<{ x: number; y: number; agentId: string } | null>(null)
  const [showInbox, setShowInbox] = useState(false)
  const [inboxData, setInboxData] = useState<{ agentId: string; messages: any[] }[]>([])
  const [projectGroupPrompt, setProjectGroupPrompt] = useState<{ projectId: string } | null>(null)
  const [projectGroupInput, setProjectGroupInput] = useState('')
  const [agentNotePrompt, setAgentNotePrompt] = useState<{ agentId: string; current: string } | null>(null)
  const [agentNoteInput, setAgentNoteInput] = useState('')
  // Two-step delete confirmation for the trash icon on an agent card. See
  // AgentDeleteConfirmModal.tsx for why (accidental one-click deletes lost
  // the "David" agent + its worktree in 2026-08).
  const [deleteAgentConfirming, setDeleteAgentConfirming] = useState<{
    agent: Agent; impact: AgentDeleteImpact
  } | null>(null)
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Set<string>>(new Set())
  useEffect(() => {
    const close = () => { setContextMenu(null); setAgentContextMenu(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Agents whose parent claude is in Stop state (hook flipped status →
  // 'waiting' / yellow) BUT whose subagents/ dir has a JSONL touched
  // within the last ~10s — meaning a Task tool is mid-flight and the
  // user-visible badge should read 'working' / green. Polled from main
  // every SUBAGENT_POLL_MS so we don't poll the FS on a tight loop
  // and don't introduce a chokidar watcher (overkill for this signal).
  const [subagentActiveIds, setSubagentActiveIds] = useState<Set<string>>(new Set())

  // Override badge color without mutating the underlying hook-driven
  // status — the next Stop / PreToolUse hook fires legitimately and
  // would otherwise be in a flapping race with our poller. Display-
  // only fork keeps the source of truth clean.
  const displayAgents = subagentActiveIds.size === 0
    ? agents
    : agents.map(a =>
        a.status === 'waiting' && subagentActiveIds.has(a.id)
          ? { ...a, status: 'working' as const }
          : a
      )

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null
  const selectedAgent = displayAgents.find((a) => a.id === selectedAgentId) || null
  const projectScan = selectedProjectId ? projectScans[selectedProjectId] || null : null
  const projectAgents = displayAgents.filter((a) => a.projectId === selectedProjectId).sort((a, b) => (a.order || 0) - (b.order || 0))
  const departments = [...new Set(projectAgents.map((a) => a.department))]

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // v2.6.0: apply + persist accent palette. See palette.ts for the
  // load/apply pair and why 'neon-purple' removes the attribute.
  useEffect(() => { applyPalette(palette) }, [palette])
  // v2.9.0: apply style. Prime only accepts a subset of palettes —
  // if the current one is incompatible, applyStyle returns the
  // coerced fallback and we sync React state to match.
  useEffect(() => {
    const coerced = applyStyle(style, palette)
    if (coerced !== palette) setPalette(coerced)
  }, [style, palette])

  // Lazy boot: single data.load() pulls the project/agent skeleton + task
  // groups + appPrefs (14 KB JSON, ~ms). EVERYTHING else — skills scan,
  // template list, dispatcher log, per-agent log rehydration, per-agent git
  // commit history, per-project scan (execSync git + recursive readFileSync
  // of every .md/.txt — multi-second on big trees), per-task-group task
  // list — is deferred to the view that actually needs it (see effects
  // below keyed on selectedProjectId / selectedAgentId / projectTab /
  // editorTab). On cold open this drops main-thread block from ~60s to
  // sub-second. Per-view fetches re-fire only on user navigation.
  useEffect(() => {
    window.api.data.load().then((data) => {
      if (data.projects) setProjects(data.projects as Project[])
      const loadedProjects = (data.projects || []) as Project[]
      const tgs = (data.taskGroups || []) as TaskGroup[]
      if (data.agents) {
        let resetAgents = (data.agents as Agent[]).map((a) => ({ ...a, status: 'done' as const }))
        // Restore taskGroupRole from existing task groups + rewrite definition files
        for (const tg of tgs) {
          resetAgents = resetAgents.map(a => {
            if (a.id === tg.managerId) return { ...a, taskGroupRole: 'manager' as const }
            if (a.id === tg.qaId) return { ...a, taskGroupRole: 'qa' as const }
            if (a.id === tg.criticId) return { ...a, taskGroupRole: 'critic' as const }
            if (tg.workerIds.includes(a.id)) return { ...a, taskGroupRole: 'worker' as const }
            return a
          })
          // Rewrite definition files for all task group members
          const tgAgentIds = [tg.managerId, ...tg.workerIds, tg.qaId, tg.criticId]
          for (const agId of tgAgentIds) {
            const ag = resetAgents.find(a => a.id === agId)
            if (!ag) continue
            const proj = loadedProjects.find(p => p.id === ag.projectId)
            const zone = proj?.zones?.find((z: Zone) => z.id === ag.zoneId)
            const cwd = ag.worktreePath || zone?.path
            if (!cwd) continue
            const defCfg: Record<string, any> = {
              agentId: ag.id, name: ag.name, role: ag.role, department: ag.department,
              soul: ag.soul, skills: ag.enabledSkills || [], model: ag.model || 'inherit',
              effort: ag.effort || 'high', taskGroupRole: ag.taskGroupRole,
            }
            if (ag.taskGroupRole === 'manager') {
              defCfg.todoSource = tg.todoSource
              defCfg.maxGateRetries = tg.maxGateRetries
              defCfg.taskGroupProjectId = tg.projectId
              defCfg.taskGroupWorkers = tg.workerIds.map(wid => {
                const w = resetAgents.find(a => a.id === wid)
                return { id: wid, name: w?.name || wid }
              })
              const qa = resetAgents.find(a => a.id === tg.qaId)
              defCfg.taskGroupQaId = tg.qaId
              defCfg.taskGroupQaName = qa?.name || tg.qaId
              const critic = resetAgents.find(a => a.id === tg.criticId)
              defCfg.taskGroupCriticId = tg.criticId
              defCfg.taskGroupCriticName = critic?.name || tg.criticId
              defCfg.dailyReportEnabled = tg.dailyReportEnabled
              defCfg.targetBranch = tg.targetBranch
            }
            window.api.agent.writeDefinition(cwd, defCfg)
          }
        }
        setAgents(resetAgents)
      }
      if (data.appPrefs) setAppPrefs((prev) => ({ ...prev, ...(data.appPrefs as Record<string, unknown>) }))
      if (tgs.length) setTaskGroups(tgs)
    }).finally(() => setProjectsLoaded(true))
  }, [])

  // Save data on change
  useEffect(() => {
    if (projects.length || agents.length) {
      window.api.data.save({ projects, agents, appPrefs, taskGroups })
    }
  }, [projects, agents, appPrefs, taskGroups])

  const handleCreateProject = (project: Project) => {
    setProjects((prev) => [...prev, project])
    setSelectedProjectId(project.id)
  }

  const [newAgentIds] = useState<Set<string>>(() => new Set())
  const handleCreateAgent = (agent: Agent) => {
    newAgentIds.add(agent.id)
    setAgents((prev) => [...prev, agent])
  }

  // ProjectDetail mount — only scan the project the user actually opens.
  // project.scan is the worst boot-time offender: execSync `git log` per
  // zone plus recursive readFileSync of every .md/.txt in the project
  // tree (thousands of files on big repos). Scanning every project on
  // boot froze the main thread ~60s. Re-fetch on every mount so git
  // changes / .md edits surface immediately — no session cache. Fetch is
  // scoped to ONE project's zones (≈2-3s on click), acceptable.
  useEffect(() => {
    if (!selectedProjectId) return
    const p = projects.find((x) => x.id === selectedProjectId)
    if (!p) return
    window.api.project.scan(p.zones.map((z: Zone) => ({ path: z.path, type: z.type })))
      .then((scan) => setProjectScans((prev) => ({ ...prev, [p.id]: scan })))
      .catch(() => {}) // fire-and-forget: stage badge falls back to "—"
  }, [selectedProjectId, projects])

  // AgentDetail mount — rehydrate task pill + load logs only for the
  // agent the user clicked. Boot used to walk every agent's log JSONL
  // (multi-MB on long-running agents) blocking the renderer event loop.
  // Re-fetch on every mount so freshly-written task_start / task_done
  // entries surface (real-time IPC also updates this; per-mount overwrite
  // is the source-of-truth replay from disk).
  useEffect(() => {
    if (!selectedAgentId) return
    window.api.agent.loadLogs(selectedAgentId).then((logs) => {
      if (!Array.isArray(logs)) return
      let lastStart: any = null
      let lastDone: any = null
      for (const e of logs) {
        if (!e || typeof e !== 'object') continue
        if (e.type === 'task_start') lastStart = e
        else if (e.type === 'task_done') lastDone = e
      }
      const next = lastStart && (!lastDone || new Date(lastStart.time) > new Date(lastDone.time))
        ? { title: lastStart.message, active: true }
        : lastDone ? { summary: lastDone.message, active: false } : null
      if (next) setAgentTasks((prev) => ({ ...prev, [selectedAgentId]: next }))
    }).catch(() => {})
  }, [selectedAgentId])

  // AgentDetail mount — load commit history (last 7 days) only for the
  // selected agent. Boot used to git-log every worktree which is slow on
  // remote-backed filesystems. Re-fetch on every mount so commits made
  // since the last view surface immediately — no session cache.
  useEffect(() => {
    if (!selectedAgentId) return
    const ag = agents.find((a) => a.id === selectedAgentId)
    if (!ag?.worktreePath) return
    window.api.git.commitHistory(ag.worktreePath, 7)
      .then((data) => setCommitData((prev) => ({ ...prev, [selectedAgentId]: data })))
      .catch(() => {})
  }, [selectedAgentId, agents])

  // Load logs when switching to logs view (sets the *full* log array
  // for the on-screen log viewer; the rehydration effect above only
  // sets the task pill summary).
  useEffect(() => {
    if (mainView === 'logs' && selectedAgentId) {
      window.api.agent.loadLogs(selectedAgentId).then(setAgentLogs)
    }
  }, [mainView, selectedAgentId])

  // Skills panel mount — scan ~/.claude/skills only when user opens the
  // Skills tab (or any modal that exposes skill toggles). Fires once
  // per session — Hive scan walks every skill dir + reads frontmatter.
  const [skillsScanned, setSkillsScanned] = useState(false)
  useEffect(() => {
    if (skillsScanned) return
    const needsSkills = editorTab === 'skills' || showCreateAgent || editingTemplate !== null
    if (!needsSkills) return
    setSkillsScanned(true)
    window.api.skills.scan().then(setAvailableSkills).catch(() => {})
  }, [editorTab, showCreateAgent, editingTemplate, skillsScanned])

  // Template picker mount — list custom templates only when user opens
  // the agent-creation or template-edit modal.
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  useEffect(() => {
    if (templatesLoaded) return
    if (!showCreateAgent && editingTemplate === null) return
    setTemplatesLoaded(true)
    window.api.templates.list().then(setCustomTemplates).catch(() => {})
  }, [showCreateAgent, editingTemplate, templatesLoaded])

  // Dispatcher panel mount — load persisted log only when the task-group
  // tab (which renders the dispatcher feed) is first opened.
  const [dispatcherLoaded, setDispatcherLoaded] = useState(false)
  useEffect(() => {
    if (dispatcherLoaded) return
    if (projectTab !== 'taskgroup') return
    setDispatcherLoaded(true)
    window.api.dispatcher.loadLog().then(setDispatcherLog).catch(() => {})
  }, [projectTab, dispatcherLoaded])

  // TasksView mount — fetch on-disk tasks for the selected project's
  // task group(s) only when the user opens that project. Previously
  // fired N times at boot (one per task group).
  useEffect(() => {
    if (!selectedProjectId) return
    const tgs = taskGroups.filter((tg) => tg.projectId === selectedProjectId)
    if (tgs.length === 0) return
    if (batchTasks[selectedProjectId]) return
    Promise.all(tgs.map(async (tg) => {
      try {
        const tasks = await window.api.tasks.list(tg.projectId)
        return [tg.projectId, tasks] as const
      } catch {
        return [tg.projectId, []] as const
      }
    })).then((results) => {
      setBatchTasks((prev) => {
        const next = { ...prev }
        for (const [pid, tasks] of results) next[pid] = tasks
        return next
      })
    })
  }, [selectedProjectId, taskGroups])

  // Listen for agent status + report updates from hooks
  useEffect(() => {
    const removeStatus = window.api.agent.onStatus(({ agentId, status }) => {
      if (status === 'working' || status === 'waiting' || status === 'done') {
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, status: status as Agent['status'] } : a))
        )
        bumpLastEventAt(agentId)   // v2.8.0 time-since ticker
        markLiveSession(agentId)   // v2.8.2 real "session running" signal
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
      if (agentId) {
        bumpLastEventAt(agentId)
        markLiveSession(agentId)
      }
    })
    const removeTaskUpdate = window.api.agent.onTaskUpdate(({ projectId, tasks }) => {
      setBatchTasks((prev) => ({ ...prev, [projectId]: tasks }))
    })
    const removeManagerReport = window.api.agent.onManagerReport(({ title, message }) => {
      setManagerReports((prev) => [...prev.slice(-19), { title, message, time: new Date().toISOString() }])
    })
    const removeBatchProposal = window.api.agent.onBatchProposal((data) => {
      setBatchProposal(data)
      setTaskGroups(prev => {
        const updated = prev.map(tg =>
          tg.managerId === data.agentId ? { ...tg, status: 'batch_proposed' as const } : tg
        )
        // Auto-approve if enabled
        if (autoApproveRef.current) {
          setTimeout(() => {
            window.api.agent.send(data.agentId, 'HUMAN', { batch: data.batch, action: 'approved' })
            window.api.pty.write(data.agentId, 'Y\r')
            setTaskGroups(p => p.map(tg =>
              tg.managerId === data.agentId ? { ...tg, status: 'batch_approved' as const, currentBatch: data.batch } : tg
            ))
            setBatchProposal(null)
          }, 500)
        }
        return updated
      })
    })
    const removeDispatcherLog = window.api.agent.onDispatcherLog((entry) => {
      setDispatcherLog(prev => [...prev.slice(-199), entry]) // keep last 200
    })
    return () => { removeStatus(); removeReport(); removeTaskUpdate(); removeManagerReport(); removeBatchProposal(); removeDispatcherLog() }
  }, [])

  // Subagent-activity poller — every 5s, ask main which 'waiting'
  // agents are actually running a sub-agent right now. Main checks
  // mtime on ~/.claude/projects/<slug>/<sid>/subagents/*.jsonl with
  // a 10s window (see src/main/subagent-activity.ts). Only 'waiting'
  // agents are candidates — 'working' is already green, 'done' is
  // terminal. No tight loop, no chokidar watcher.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const candidates = agents.filter(a => a.status === 'waiting')
      if (candidates.length === 0) {
        if (!cancelled) setSubagentActiveIds(prev => prev.size === 0 ? prev : new Set())
        return
      }
      const results = await Promise.all(
        candidates.map(async a => {
          try {
            const r = await window.api.agent.checkSubagentActivity(a.id)
            return r?.active ? a.id : null
          } catch { return null }
        })
      )
      if (cancelled) return
      const active = new Set(results.filter((x): x is string => !!x))
      setSubagentActiveIds(prev => {
        // Cheap equality check so identical results don't re-render
        // the whole agents grid every 5s.
        if (prev.size === active.size && [...active].every(id => prev.has(id))) {
          return prev
        }
        return active
      })
    }
    tick()  // run once on mount/state change
    const iv = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [agents])

  // Auto-cleanup stale toast notifications
  useEffect(() => {
    if (managerReports.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setManagerReports((prev) => prev.filter((r) => now - new Date(r.time).getTime() < 10000))
    }, 2000)
    return () => clearInterval(timer)
  }, [managerReports.length])

  const startAgent = async (agent: Agent) => {
    const project = projects.find((p) => p.id === agent.projectId)
    const zone = project?.zones.find((z: Zone) => z.id === agent.zoneId)
    if (!zone) return

    let cwd = zone.path

    // Create worktree for coding agents with git (re-check hasGit live)
    const hasGit = await window.api.fs.hasGit(zone.path)
    if (hasGit && !zone.hasGit) {
      // Update zone hasGit for future use
      setProjects((prev) => prev.map((p) => p.id === agent.projectId
        ? { ...p, zones: p.zones.map((z: Zone) => z.id === zone.id ? { ...z, hasGit: true } : z) }
        : p
      ))
    }
    if (agent.type === 'coding' && hasGit && !agent.worktreePath) {
      const result = await window.api.git.worktreeAdd(zone.path, agent.id, agent.name)
      if (result.ok && result.path) {
        cwd = result.path
        updateAgent(agent.id, { worktreePath: result.path, worktreeBranch: result.branch })
      }
    } else if (agent.worktreePath) {
      cwd = agent.worktreePath
    }

    // Write Claude Code native agent definition file
    // If manager, include task group worker/QA/critic info in config
    const defConfig: Record<string, any> = {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      department: agent.department,
      soul: agent.soul,
      skills: agent.enabledSkills || [],
      model: agent.model || 'inherit',
      effort: agent.effort || 'high',
      taskGroupRole: agent.taskGroupRole,
    }
    if (agent.taskGroupRole === 'manager') {
      const tg = taskGroups.find(t => t.managerId === agent.id)
      if (tg) {
        defConfig.todoSource = tg.todoSource
        defConfig.maxGateRetries = tg.maxGateRetries
        defConfig.taskGroupProjectId = tg.projectId
        defConfig.taskGroupWorkers = tg.workerIds.map(wid => {
          const w = agents.find(a => a.id === wid)
          return { id: wid, name: w?.name || wid }
        })
        const qa = agents.find(a => a.id === tg.qaId)
        defConfig.taskGroupQaId = tg.qaId
        defConfig.taskGroupQaName = qa?.name || tg.qaId
        const critic = agents.find(a => a.id === tg.criticId)
        defConfig.taskGroupCriticId = tg.criticId
        defConfig.taskGroupCriticName = critic?.name || tg.criticId
        defConfig.dailyReportEnabled = tg.dailyReportEnabled
      }
    }
    const result = await window.api.agent.writeDefinition(cwd, defConfig)
    if (result.agentName) {
      setAgentNames((prev) => ({ ...prev, [agent.id]: result.agentName! }))
    }

    // v2.15.7: LRU eviction. Before adding another sticky-mounted
    // HiveChat + xterm to the process, see if we're at the cap and
    // if so evict the oldest un-pinned one. See lru-terminals.ts for
    // the picker + why (2.2 GB / 2 day report).
    setActiveTerminals((prev) => {
      const evict = pickLRUToEvict({
        incomingId: agent.id,
        activeIds: prev,
        selectedId: selectedAgentId,
        pinnedIds: activeHandoffAgentIds,
        lastAccessed: lastAccessedAtRef.current
      })
      const next = new Set(prev)
      if (evict) {
        // Same teardown path as user-clicked close: kill the child +
        // remove from set. Renderer unmounts the Terminal/HiveChat →
        // useEffect cleanups fire → memory reclaimed.
        try { window.api.chat.stop(`chat-${evict}`) } catch { /* silent */ }
        next.delete(evict)
      }
      next.add(agent.id)
      return next
    })
    lastAccessedAtRef.current.set(agent.id, Date.now())
    setSelectedAgentId(agent.id)
    setMainView('terminal')
  }

  const getAgentCwd = (agent: Agent): string => {
    if (agent.worktreePath) return agent.worktreePath
    const project = projects.find((p) => p.id === agent.projectId)
    const zone = project?.zones.find((z: Zone) => z.id === agent.zoneId)
    return zone?.path || '/'
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

  if (claudeEnv && !claudeEnv.installed) {
    return (
      <ClaudeGate
        installCommand={claudeEnv.installCommand}
        onReady={() => setClaudeEnv({ ...claudeEnv, installed: true })}
      />
    )
  }

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Left: Projects */}
      <div className="bg-sidebar-bg flex flex-col flex-shrink-0" style={{ width: panelWidths.projects }}>
        <div className="drag-region h-16 flex items-end px-4 pb-2 justify-between">
          <h2 className="no-drag text-[13px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            Hive v{__APP_VERSION__}
          </h2>
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {(() => {
            const groups = [...new Set(projects.map(p => p.group || ''))]
            // Put ungrouped ('') first, then alphabetical
            groups.sort((a, b) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))

            const renderProject = (project: Project, idx: number) => (
              <button
                key={project.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('projectId', project.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const draggedId = e.dataTransfer.getData('projectId')
                  if (!draggedId || draggedId === project.id) return
                  // Move dragged project to same group + position
                  setProjects(prev => {
                    const fromIdx = prev.findIndex(p => p.id === draggedId)
                    const toIdx = prev.findIndex(p => p.id === project.id)
                    if (fromIdx < 0 || toIdx < 0) return prev
                    const next = [...prev]
                    const [moved] = next.splice(fromIdx, 1)
                    moved.group = project.group // adopt target's group
                    next.splice(toIdx, 0, moved)
                    return next
                  })
                }}
                onClick={() => {
                  setSelectedProjectId(project.id)
                  setSelectedAgentId(null)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, projectId: project.id })
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer
                  transition-colors flex items-center gap-2 border-l-2 ${
                  selectedProjectId === project.id
                    ? 'bg-sidebar-active text-text-primary font-medium border-accent'
                    : 'text-text-secondary border-transparent hover:bg-bg-hover hover:border-accent-muted hover:text-text-primary'
                }`}
              >
                {(() => {
                  const projectAgents = agents.filter((a) => a.projectId === project.id)
                  const hasWorking = projectAgents.some((a) => a.status === 'working')
                  const hasWaiting = projectAgents.some((a) => a.status === 'waiting')
                  if (projectAgents.length === 0) return (
                    <span className="w-4 text-center flex-shrink-0 text-text-muted/60" title="No agents">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
                        <circle cx="12" cy="12" r="9"/>
                      </svg>
                    </span>
                  )
                  if (hasWorking) return <span className="w-4 text-center text-[13px] flex-shrink-0" title="Agents working">🏃</span>
                  if (hasWaiting) return <span className="w-4 text-center text-[13px] flex-shrink-0" title="Agents idle">☕</span>
                  return <span className="w-4 text-center text-[13px] flex-shrink-0" title="Agents offline">💤</span>
                })()}
                <span className="truncate">{project.name}</span>
                {(() => {
                  const count = agents.filter((a) => a.projectId === project.id).length
                  return count > 0 ? <span className="ml-auto text-[13px] text-text-muted/50 flex-shrink-0">{count}</span> : null
                })()}
              </button>
            )

            return groups.map(grp => {
              const grpProjects = projects.filter(p => (p.group || '') === grp)
              const isCollapsed = collapsedProjectGroups.has(grp)
              if (!grp) {
                // Ungrouped projects — render flat
                return grpProjects.map((p, i) => renderProject(p, i))
              }
              return (
                <div key={grp} className="rounded-lg bg-bg-primary/30 border border-border/30 mb-1"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const draggedId = e.dataTransfer.getData('projectId')
                    if (!draggedId) return
                    setProjects(prev => prev.map(p => p.id === draggedId ? { ...p, group: grp } : p))
                  }}
                >
                  <button
                    onClick={() => setCollapsedProjectGroups(prev => {
                      const next = new Set(prev)
                      if (next.has(grp)) next.delete(grp); else next.add(grp)
                      return next
                    })}
                    className="w-full px-2.5 py-1.5 text-[11px] font-heading font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:text-text-primary"
                  >
                    <span className="text-xs">{isCollapsed ? '▸' : '▾'}</span>
                    {grp}
                    <span className="ml-auto text-[10px] font-normal">{grpProjects.length}</span>
                  </button>
                  {!isCollapsed && grpProjects.map((p, i) => renderProject(p, i))}
                </div>
              )
            })
          })()}
          {projectListState(projectsLoaded, projects.length) === 'loading' && (
            <p className="text-xs text-text-muted text-center py-6 flex items-center justify-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full border-2 border-text-muted border-t-transparent animate-spin" />
              Scanning projects…
            </p>
          )}
          {projectListState(projectsLoaded, projects.length) === 'empty' && (
            <p className="text-xs text-text-muted text-center py-6">No projects yet</p>
          )}
          {/* Project context menu */}
          {contextMenu && (
            <div
              className="fixed z-50 bg-bg-secondary border border-border rounded-lg shadow-e3 py-1 min-w-[200px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => {
                  const projAgents = agents.filter(a => a.projectId === contextMenu.projectId)
                  for (const ag of projAgents) {
                    if (!activeTerminals.has(ag.id)) startAgent(ag)
                  }
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-bg-hover cursor-pointer flex items-center gap-2"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                (Re)start All Agents
              </button>
              <button
                onClick={() => {
                  setProjectGroupPrompt({ projectId: contextMenu.projectId })
                  const proj = projects.find(p => p.id === contextMenu.projectId)
                  setProjectGroupInput(proj?.group || '')
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-bg-hover cursor-pointer flex items-center gap-2"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Move to Group…
              </button>
              <button
                onClick={() => {
                  setProjects(prev => prev.map(p => p.id === contextMenu.projectId ? { ...p, group: undefined } : p))
                  setContextMenu(null)
                }}
                className="w-full text-left px-3 py-2 text-[13px] text-text-muted hover:bg-bg-hover cursor-pointer flex items-center gap-2"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Remove from Group
              </button>
            </div>
          )}
          {/* Agent context menu */}
          {agentContextMenu && (() => {
            const ag = agents.find(a => a.id === agentContextMenu.agentId)
            if (!ag) return null
            return (
              <div
                className="fixed z-50 bg-bg-secondary border border-border rounded-lg shadow-e3 py-1 min-w-[200px]"
                style={{ left: agentContextMenu.x, top: agentContextMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setAgentNoteInput(ag.note || '')
                    setAgentNotePrompt({ agentId: ag.id, current: ag.note || '' })
                    setAgentContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-bg-hover cursor-pointer flex items-center gap-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                  {ag.note ? 'Edit note…' : 'Set note…'}
                </button>
                {ag.note && (
                  <button
                    onClick={() => {
                      updateAgent(ag.id, { note: undefined })
                      setAgentContextMenu(null)
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-red-400/80 hover:bg-bg-hover cursor-pointer flex items-center gap-2"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Clear note
                  </button>
                )}
              </div>
            )
          })()}
          {/* Agent note prompt */}
          {agentNotePrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setAgentNotePrompt(null)} />
              <div className="relative bg-bg-secondary border border-border rounded-xl shadow-e3 p-4 w-[300px]">
                <h3 className="text-sm font-heading font-semibold mb-2">Set Note</h3>
                <input
                  autoFocus
                  value={agentNoteInput}
                  onChange={(e) => setAgentNoteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateAgent(agentNotePrompt.agentId, { note: agentNoteInput.trim() || undefined })
                      setAgentNotePrompt(null)
                    }
                    if (e.key === 'Escape') setAgentNotePrompt(null)
                  }}
                  placeholder="What is this agent doing?"
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary mb-2"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      updateAgent(agentNotePrompt.agentId, { note: agentNoteInput.trim() || undefined })
                      setAgentNotePrompt(null)
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-text-on-purple cursor-pointer hover:opacity-90"
                  >Save</button>
                  <button
                    onClick={() => setAgentNotePrompt(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-hover text-text-muted cursor-pointer hover:text-text-primary"
                  >Cancel</button>
                </div>
              </div>
            </div>
          )}
          {/* Group name prompt */}
          {projectGroupPrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setProjectGroupPrompt(null)} />
              <div className="relative bg-bg-secondary border border-border rounded-xl shadow-e3 p-4 w-[280px]">
                <h3 className="text-sm font-heading font-bold mb-2">Move to Group</h3>
                <input
                  autoFocus
                  value={projectGroupInput}
                  onChange={(e) => setProjectGroupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && projectGroupInput.trim()) {
                      setProjects(prev => prev.map(p => p.id === projectGroupPrompt.projectId ? { ...p, group: projectGroupInput.trim() } : p))
                      setProjectGroupPrompt(null)
                    }
                    if (e.key === 'Escape') setProjectGroupPrompt(null)
                  }}
                  placeholder="Group name (e.g. Active, Archive)"
                  className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary mb-2"
                />
                {/* Existing groups as quick picks */}
                <div className="flex gap-1 flex-wrap">
                  {[...new Set(projects.map(p => p.group).filter(Boolean))].map(g => (
                    <button key={g} onClick={() => {
                      setProjects(prev => prev.map(p => p.id === projectGroupPrompt.projectId ? { ...p, group: g } : p))
                      setProjectGroupPrompt(null)
                    }} className="px-2 py-1 rounded text-[11px] bg-bg-hover text-text-muted hover:text-text-primary cursor-pointer">{g}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-2 border-t border-border space-y-1">
          {/* v2.6.0: Overview toggle. Highlighted (accent bg) when active
              so it reads as the currently-selected top-level view. */}
          <button
            onClick={() => setMainScreen(mainScreen === 'overview' ? 'projects' : 'overview')}
            aria-pressed={mainScreen === 'overview'}
            className={`w-full px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors
              flex items-center gap-2 ${
                mainScreen === 'overview'
                  ? 'bg-accent text-text-on-purple font-semibold'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
              }`}
            title="Overview across all projects and agents"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
            Overview
          </button>
          <div className="flex gap-1">
            <button
              onClick={() => setShowCreateProject(true)}
              className="flex-1 px-3 py-2 rounded-lg text-sm text-text-muted
                hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer
                flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Project
            </button>
            <button
              onClick={() => setShowAppSettings(true)}
              className="px-2 py-2 rounded-lg text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
              title="App Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ResizeHandle onResize={(d) => resizePanel('projects', d)} />

      {/* Middle: Agents */}
      <div className="bg-bg-secondary flex flex-col flex-shrink-0" style={{ width: panelWidths.agents }}>
        <div className="drag-region h-16 flex items-end px-4 pb-2">
          <h2 className="no-drag text-[13px] font-heading font-semibold text-text-muted uppercase tracking-widest">
            {selectedProject ? selectedProject.name : 'Agents'}
          </h2>
        </div>
        {selectedProject ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
              {departments.map((dept) => {
                const deptAgents = projectAgents.filter((a) => a.department === dept).sort((a, b) => (a.order || 0) - (b.order || 0))
                const groups = [...new Set(deptAgents.map((a) => a.group || ''))].sort()

                const handleDrop = (targetId: string, targetGroup: string) => {
                  if (!dragAgentId || dragAgentId === targetId) return
                  setAgents((prev) => {
                    const dragged = prev.find((a) => a.id === dragAgentId)
                    if (!dragged || dragged.department !== dept) return prev
                    // Build ordered list for this dept, move dragged to before target
                    const deptList = prev
                      .filter((a) => a.projectId === dragged.projectId && a.department === dept)
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                    const without = deptList.filter((a) => a.id !== dragAgentId)
                    const targetIdx = without.findIndex((a) => a.id === targetId)
                    const updated = { ...dragged, group: targetGroup }
                    const reordered = targetIdx >= 0
                      ? [...without.slice(0, targetIdx), updated, ...without.slice(targetIdx)]
                      : [...without, updated]
                    // Assign clean sequential order
                    const orderMap = new Map(reordered.map((a, i) => [a.id, i]))
                    return prev.map((a) => {
                      if (!orderMap.has(a.id)) return a
                      const newOrder = orderMap.get(a.id)!
                      if (a.id === dragAgentId) return { ...a, group: targetGroup, order: newOrder }
                      return { ...a, order: newOrder }
                    })
                  })
                  setDragAgentId(null)
                }

                return (
                  <div key={dept} className="rounded-xl bg-bg-primary/50 border border-border p-1.5 shadow-e1">
                    <div className="px-2.5 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-[0.16em] flex items-center gap-1.5">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                      {dept}
                      {/* v2.8.0: dropped the R&D-only "⟳ Rebase" action —
                          crowded the dept header against "+ Team" and the
                          same prompt is one right-click away. Rebase-on-
                          restart preference in App Settings covers the
                          scheduled case. */}
                      <button
                        onClick={() => { setTeamPrompt({ dept }); setTeamNameInput(''); setTeamSelectedAgents(new Set()) }}
                        className="ml-auto text-[13px] text-accent hover:text-accent-hover cursor-pointer"
                        title="Add team"
                      >+ Team</button>
                    </div>
                    {groups.map((grp) => {
                      const grpAgents = deptAgents.filter((a) => (a.group || '') === grp).sort((a, b) => (a.order || 0) - (b.order || 0))
                      return (
                        <div
                          key={grp || '_ungrouped'}
                          className="space-y-0.5"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            // Drop on empty group area
                            if (dragAgentId) {
                              const dragged = agents.find((a) => a.id === dragAgentId)
                              if (dragged && dragged.department === dept) {
                                setAgents((prev) => prev.map((a) => a.id === dragAgentId ? { ...a, group: grp, order: grpAgents.length } : a))
                                setDragAgentId(null)
                              }
                            }
                          }}
                        >
                          {grp && (
                            <div className="px-5 py-1 text-[13px] font-heading font-medium text-text-muted/70 uppercase tracking-wider flex items-center">
                              {grp}
                              <button
                                onClick={() => {
                                  // Remove team — move all agents to ungrouped
                                  setAgents((prev) => prev.map((a) => a.group === grp && a.department === dept ? { ...a, group: '' } : a))
                                }}
                                className="ml-auto text-text-muted/40 hover:text-red-400 cursor-pointer"
                                title="Remove team"
                              >
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </button>
                            </div>
                          )}
                          {grpAgents.map((agent) => (
                            <div
                              key={agent.id}
                              draggable
                              onDragStart={() => setDragAgentId(agent.id)}
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                              onDrop={(e) => { e.stopPropagation(); handleDrop(agent.id, grp) }}
                              onDragEnd={() => setDragAgentId(null)}
                              className={`group w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 relative
                                transition-colors cursor-grab active:cursor-grabbing border-l-2 ${
                                grp ? 'ml-2' : ''
                              } ${
                                dragAgentId === agent.id ? 'opacity-50' : ''
                              } ${
                                /* v2.8.0: status-driven left border. Selected wins
                                   over status (users need to see WHICH agent is
                                   picked). Idle rows fade to 60% opacity so the
                                   working ones dominate the eye. */
                                selectedAgentId === agent.id
                                  ? 'bg-accent-subtle text-accent font-medium border-accent'
                                  : agent.status === 'working'
                                    ? 'text-text-primary border-status-working hover:bg-bg-hover'
                                    : agent.status === 'waiting'
                                      ? 'text-text-primary border-status-waiting hover:bg-bg-hover'
                                      : 'text-text-secondary border-transparent hover:bg-bg-hover opacity-60'
                              }`}
                              onClick={() => {
                                if (agent.projectId !== selectedProjectId) setSelectedProjectId(agent.projectId)
                                setSelectedAgentId(agent.id)
                                if (!activeTerminals.has(agent.id)) startAgent(agent)
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setAgentContextMenu({ x: e.clientX, y: e.clientY, agentId: agent.id })
                              }}
                            >
                              <div className="w-6 h-6 flex-shrink-0 relative">
                                <AvatarPreview config={agent.avatar} size={24} loopBusy={activeHandoffAgentIds.has(agent.id)} selected={selectedAgentId === agent.id} />
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-secondary ${
                                  agent.status === 'working' ? 'bg-status-working' :
                                  agent.status === 'waiting' ? 'bg-status-waiting' : 'bg-status-done'
                                }`} />
                                {agent.taskGroupRole && (
                                  <span className="absolute -top-1 -right-1 text-sm leading-none drop-shadow">
                                    {agent.taskGroupRole === 'manager' ? '👑' :
                                     agent.taskGroupRole === 'worker' ? '🔧' :
                                     agent.taskGroupRole === 'qa' ? '🛡️' : '⚖️'}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                {/* v2.9.0: undo the v2.8.5 ml-auto — it was
                                    pushing the note tag OUT of the row's
                                    right edge (Playwright measured a
                                    -26.8px "gap", i.e. 26px overflow).
                                    Back to natural inline flow: tag right
                                    after name; name truncates first when
                                    space is tight, tag never spills. */}
                                <span className="flex items-center gap-1.5 min-w-0 whitespace-nowrap overflow-hidden text-[13px] font-heading font-semibold text-text-primary">
                                  {agent.tagColor && (
                                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.tagColor }} />
                                  )}
                                  <span className="truncate min-w-0 flex-shrink">{agent.name}</span>
                                  {agent.note && <NoteTag id={agent.id} note={agent.note} />}
                                </span>
                                <span className="text-[10px] font-semibold uppercase tracking-wider truncate group-hover:invisible text-text-muted flex items-center gap-1.5" title={agent.role}>
                                  <span className="truncate">{agent.role}</span>
                                  {/* v2.8.0: time-since chip. Fixed-width
                                      mono cell so a row of chips lines up.
                                      Hidden on hover to make room for
                                      per-row action icons (edit/delete). */}
                                  {(() => {
                                    const ts = formatTimeSince(lastEventAt[agent.id], nowTick)
                                    if (!ts) return null
                                    return (
                                      <span className="ml-auto font-mono tabular-nums text-[9.5px] text-text-muted/70 shrink-0" title="Last activity">
                                        {ts}
                                      </span>
                                    )
                                  })()}
                                </span>
                              </div>
                              <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2">
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
                                  onClick={(e) => {
                                    // Open the two-step confirm modal instead of
                                    // deleting immediately. Historical one-click
                                    // path lost the David agent + worktree in
                                    // 2026-08 on an accidental mis-click; see
                                    // AgentDeleteConfirmModal for the reasoning.
                                    e.stopPropagation()
                                    const zone = selectedProject?.zones.find((z: Zone) => z.id === agent.zoneId)
                                    setDeleteAgentConfirming({
                                      agent,
                                      impact: {
                                        hasActiveTerminal: activeTerminals.has(agent.id),
                                        worktreePath: agent.worktreePath,
                                        worktreeBranch: agent.worktreeBranch,
                                        definitionCwd: agent.worktreePath || zone?.path
                                      }
                                    })
                                  }}
                                  className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                                  title="Delete"
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {/* Drop zone to remove from team (ungrouped) */}
                    <div
                      className={`mx-1 mt-1 rounded-lg border border-dashed border-transparent text-center text-[13px] text-text-muted/40 transition-colors py-1 ${dragAgentId ? 'border-border !text-text-muted/70' : 'hidden'}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragAgentId) {
                          const dragged = agents.find((a) => a.id === dragAgentId)
                          if (dragged && dragged.department === dept) {
                            setAgents((prev) => prev.map((a) => a.id === dragAgentId ? { ...a, group: '' } : a))
                            setDragAgentId(null)
                          }
                        }
                      }}
                    >
                      Drop here to ungroup
                    </div>
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
            <h2 className="text-[13px] font-heading font-semibold text-text-muted uppercase tracking-widest">
              {selectedAgent ? selectedAgent.name : (selectedProject ? 'Dashboard' : 'Select an agent')}
            </h2>
            {selectedAgent && (
              <>
                {agentTasks[selectedAgent.id]?.active && agentTasks[selectedAgent.id]?.title && (
                  <span className="text-[13px] text-accent font-medium px-2 py-0.5 rounded-md bg-accent/10 truncate max-w-[250px]">
                    {agentTasks[selectedAgent.id].title}
                  </span>
                )}
                {!agentTasks[selectedAgent.id]?.active && agentTasks[selectedAgent.id]?.summary && (
                  <span className="text-[13px] text-status-working font-medium px-2 py-0.5 rounded-md bg-status-working/10 truncate max-w-[250px]">
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
                className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                  mainView === 'terminal'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setMainView('editor')}
                className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                  mainView === 'editor'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Editor
              </button>
              <button
                onClick={() => setMainView('logs')}
                className={`px-2.5 py-1 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                  mainView === 'logs'
                    ? 'bg-accent text-text-on-purple'
                    : 'text-text-muted hover:bg-bg-hover'
                }`}
              >
                Logs
              </button>
              {mainView === 'terminal' && activeTerminals.has(selectedAgent!.id) && (
                <button
                  onClick={async () => {
                    // In-place refresh: reload data + rewrite agent
                    // definition so soul/skill changes hit disk, then ask
                    // Terminal to kill+respawn its PTY without unmounting.
                    // The previous unmount-then-remount approach caused a
                    // 200ms+ white flash (activeTerminals briefly empty)
                    // and resurrected HiveChat to chooserMode=true,
                    // forcing the user to click Resume again.
                    const data = await window.api.data.load()
                    if (data.agents) setAgents(data.agents as Agent[])
                    if (data.projects) setProjects(data.projects as Project[])
                    if (data.appPrefs) setAppPrefs((prev) => ({ ...prev, ...(data.appPrefs as Record<string, unknown>) }))

                    const agentId = selectedAgent!.id
                    const agent = (data.agents as Agent[] || agents).find((a: Agent) => a.id === agentId)
                    if (!agent) return
                    const proj = (data.projects as Project[] || projects).find(p => p.id === agent.projectId)
                    const zone = proj?.zones?.find((z: Zone) => z.id === agent.zoneId)
                    const cwd = agent.worktreePath || zone?.path
                    if (cwd) {
                      const defCfg: Record<string, any> = {
                        agentId: agent.id, name: agent.name, role: agent.role,
                        department: agent.department, soul: agent.soul,
                        skills: agent.enabledSkills || [], model: agent.model || 'inherit',
                        effort: agent.effort || 'high', taskGroupRole: agent.taskGroupRole,
                      }
                      try { await window.api.agent.writeDefinition(cwd, defCfg) } catch {}
                    }
                    // Respawn the xterm PTY in place (no unmount).
                    window.dispatchEvent(new CustomEvent('hive:pty-respawn', { detail: { agentId } }))
                    // Restore the chooser pop-up that v1.7.104's in-place
                    // refresh silently removed. HiveChat listens for this
                    // event and flips chooserMode→true, so the user gets
                    // back the 4-way Resume / Compact+Resume / Start new /
                    // Fork picker instead of an unconditional `chat.compact`
                    // (which surfaced "Compact failed: no_session" after
                    // close-session, and silently no-op'd otherwise).
                    window.dispatchEvent(new CustomEvent('hive:reopen-chooser', { detail: { agentId } }))
                  }}
                  className="px-1.5 py-1 rounded-md text-text-muted hover:bg-bg-hover transition-colors cursor-pointer"
                  title="Restart terminal + reopen chat chooser"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
              {mainView === 'terminal' && activeTerminals.has(selectedAgent!.id) && (
                <button
                  onClick={async () => {
                    if (isListening) {
                      await window.api.speech.stop()
                      setIsListening(false)
                      setSpeechPartial('')
                    } else {
                      const agentId = selectedAgent!.id
                      const cleanup = window.api.speech.onTranscript((line) => {
                        if (line.startsWith('final:')) {
                          const text = line.slice(6)
                          // Broadcast as CustomEvent so whichever surface is
                          // currently visible (xterm Terminal or HiveChat)
                          // can decide to consume it. App.tsx no longer
                          // hard-writes to PTY — that broke voice input the
                          // moment the user switched to chat mode (xterm
                          // was hidden, transcripts vanished).
                          window.dispatchEvent(new CustomEvent('hive:voice-final', { detail: { agentId, text } }))
                          setSpeechPartial('')
                        } else if (line.startsWith('partial:')) {
                          setSpeechPartial(line.slice(8))
                        }
                      })
                      const result = await window.api.speech.start()
                      if (!result.ok) {
                        cleanup()
                        return
                      }
                      setIsListening(true)
                    }
                  }}
                  className={`px-1.5 py-1 rounded-md transition-colors cursor-pointer ${
                    isListening ? 'bg-red-500/20 text-red-400' : 'text-text-muted hover:bg-bg-hover'
                  }`}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        {isListening && speechPartial && (
          <div className="px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-[13px] text-red-300 font-mono truncate">
            🎙 {speechPartial}
          </div>
        )}
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
              <div className="px-6 pt-2 border-b border-border flex items-center gap-4">
                {/* v2.8.0: Linear-style underline tabs. No pill background,
                    no `bg-accent` block. Active = 2px accent underline
                    that sits flush against the container's own border. */}
                <div className="flex gap-0.5 -mb-px">
                  {([['dashboard', 'Dashboard'], ['office', 'Office'], ['taskgroup', 'Task Group'], ['settings', 'Settings']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setProjectTab(key)}
                      className={`px-3 py-2 text-xs font-medium cursor-pointer transition-colors border-b-2 ${
                        projectTab === key
                          ? 'text-text-primary border-accent'
                          : 'text-text-muted border-transparent hover:text-text-primary hover:border-border'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <h1 className="text-sm font-heading font-semibold text-text-primary">{selectedProject.name}</h1>
                  {/* Stage badge: em-dash placeholder while project.scan
                      runs (lazy fetch — see effect keyed on
                      selectedProjectId). Avoids the prior boot-time
                      freeze where we scanned every project up-front. */}
                  <span
                    data-testid="project-stage-badge"
                    className={`px-2 py-0.5 rounded-full text-[13px] font-heading font-bold uppercase tracking-wider ${
                      projectScan?.projectStage === 'active-online' || projectScan?.projectStage === 'active'
                        ? 'bg-status-working/20 text-status-working'
                        : projectScan?.projectStage === 'incubating'
                        ? 'bg-status-waiting/20 text-status-waiting'
                        : 'bg-bg-hover text-text-muted'
                    }`}
                  >
                    {projectScan ? projectScan.projectStage.replace('-', ' ') : '—'}
                  </span>
                </div>
              </div>

              {/* Office Tab */}
              {projectTab === 'office' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Office View — fill width */}
                  <div className="w-full">
                    <OfficeView
                      agents={projectAgents}
                      loopBusyAgentIds={activeHandoffAgentIds}
                      selectedAgentId={selectedAgentId}
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
                        <div key={status} className="rounded-xl bg-bg-secondary border border-border overflow-hidden shadow-e1">
                          <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
                            <span className={`w-2 h-2 rounded-full ${statusColor[status]}`} />
                            <span className="text-[11px] font-medium text-text-muted uppercase tracking-[0.16em]">{statusLabel[status]}</span>
                            <span className="ml-auto text-[13px] font-mono tabular-nums text-text-primary">{columnAgents.length}</span>
                          </div>
                          <div className="p-2 space-y-1.5 min-h-[80px]">
                            {columnAgents.length === 0 && (
                              <p className="text-[13px] text-text-muted text-center py-4">No agents</p>
                            )}
                            {columnAgents.map((agent) => (
                              <button
                                key={agent.id}
                                onClick={() => {
                                  setSelectedAgentId(agent.id)
                                  if (!activeTerminals.has(agent.id)) startAgent(agent)
                                }}
                                className="w-full text-left p-2.5 rounded-lg bg-bg-primary hover:bg-bg-hover
                                  border border-border cursor-pointer card-lift"
                              >
                                {/* v2.8.0: kanban card slimmed. Removed the
                                    role/department suffix — dept was already
                                    the project's dept-list header (redundant
                                    inside the same panel), and role rarely
                                    changed the read. Now the card is name
                                    + optional in-flight task title only. */}
                                <div className="flex items-center gap-2">
                                  <AvatarPreview config={agent.avatar} size={20} loopBusy={activeHandoffAgentIds.has(agent.id)} selected={selectedAgentId === agent.id} />
                                  <span className="text-[13px] font-medium text-text-primary truncate">{agent.name}</span>
                                  <span className="ml-auto font-mono tabular-nums text-[10px] text-text-muted/70 shrink-0" title="Last activity">
                                    {formatTimeSince(lastEventAt[agent.id], nowTick)}
                                  </span>
                                </div>
                                {agentTasks[agent.id] && (
                                  <div className="mt-1.5">
                                    {agentTasks[agent.id].active && agentTasks[agent.id].title && (
                                      <p className="text-[13px] text-accent truncate">{agentTasks[agent.id].title}</p>
                                    )}
                                    {!agentTasks[agent.id].active && agentTasks[agent.id].summary && (
                                      <p className="text-[13px] text-status-working truncate">{agentTasks[agent.id].summary}</p>
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

              {/* Dashboard Tab */}
              {projectTab === 'dashboard' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* Task Group Overview Stats */}
                  {(() => {
                    const taskGroup = taskGroups.find((tg) => tg.projectId === selectedProjectId)
                    const tasks = batchTasks[selectedProjectId!] || []
                    const totalTasks = tasks.length
                    const doneTasks = tasks.filter(t => t.status === 'done').length
                    const blockedTasks = tasks.filter(t => t.status === 'blocked').length
                    const abandonedTasks = tasks.filter(t => t.status === 'abandoned').length
                    const inProgressTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'assigned').length
                    const batchNums = [...new Set(tasks.map(t => t.batch || 1))]
                    const maxBatch = batchNums.length > 0 ? Math.max(...batchNums) : 0
                    const latestTask = tasks.length > 0 ? tasks[tasks.length - 1]?.id : '—'
                    const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

                    return (
                      <div className="space-y-4">
                        {/* 4 metric cards */}
                        <div className="grid grid-cols-4 gap-3">
                          <div className="glass-card p-4">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Total Tasks</div>
                            <div className="text-2xl font-heading font-bold">{totalTasks}</div>
                            <div className="text-[11px] text-text-muted mt-1">Latest: {latestTask}</div>
                          </div>
                          <div className="glass-card p-4">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Completed</div>
                            <div className="text-2xl font-heading font-bold text-status-working">{doneTasks}</div>
                            <div className="text-[11px] text-text-muted mt-1">{pct}% done</div>
                          </div>
                          <div className="glass-card p-4">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Batches</div>
                            <div className="text-2xl font-heading font-bold">{maxBatch}</div>
                            <div className="text-[11px] text-text-muted mt-1">{inProgressTasks} in progress</div>
                          </div>
                          <div className="glass-card p-4">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">Blocked</div>
                            <div className="text-2xl font-heading font-bold text-red-400">{blockedTasks}</div>
                            <div className="text-[11px] text-text-muted mt-1">{abandonedTasks} abandoned</div>
                          </div>
                        </div>

                        {/* Task Group quick stats bar */}
                        {taskGroup && totalTasks > 0 && (
                          <div className="glass-card p-4">
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-heading font-bold">Task Group</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-heading font-bold uppercase tracking-wider ${
                                  taskGroup.status === 'executing' ? 'bg-status-working/20 text-status-working' :
                                  taskGroup.status === 'awaiting_merge' ? 'bg-accent/20 text-accent' :
                                  'bg-bg-hover text-text-muted'
                                }`}>{taskGroup.status.replace('_', ' ')}</span>
                              </div>
                              <button onClick={() => setProjectTab('taskgroup')} className="text-[11px] text-accent hover:underline cursor-pointer">→ Task Group</button>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] text-text-muted font-mono">{doneTasks}/{totalTasks}</span>
                            </div>
                          </div>
                        )}
                        {!taskGroup && (
                          <div className="glass-card p-4">
                            <span className="text-sm font-heading font-bold">Task Group</span>
                            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-heading font-bold uppercase tracking-wider bg-bg-hover text-text-muted">inactive</span>
                            <button onClick={() => setProjectTab('taskgroup')} className="block text-[11px] text-accent hover:underline mt-1 cursor-pointer">+ Create Task Group</button>
                          </div>
                        )}

                        {/* 7-Day Commit Density */}
                        {projectAgents.some(a => commitData[a.id] && Object.keys(commitData[a.id]).length > 0) && (
                          <div className="glass-card overflow-hidden">
                            <div className="px-4 py-2 border-b border-border flex justify-between items-center">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">7-Day Commit Density</span>
                              <span className="text-[11px] font-mono text-text-secondary">
                                {(() => {
                                  let total = 0
                                  for (const ag of projectAgents) {
                                    const d = commitData[ag.id] || {}
                                    total += Object.values(d).reduce((s, n) => s + n, 0)
                                  }
                                  return `${total} commits`
                                })()}
                              </span>
                            </div>
                            <div className="px-4 py-3">
                              {(() => {
                                const days: string[] = []
                                for (let i = 6; i >= 0; i--) {
                                  const d = new Date(); d.setDate(d.getDate() - i)
                                  days.push(d.toISOString().slice(0, 10))
                                }
                                const agentColors: Record<string, string> = {}
                                const roleColors = { manager: '#F59E0B', worker: '#3B82F6', qa: '#10B981', critic: '#8B5CF6' }
                                const defaultColors = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#f472b6', '#22d3ee']
                                let colorIdx = 0
                                for (const ag of projectAgents) {
                                  agentColors[ag.id] = ag.taskGroupRole ? roleColors[ag.taskGroupRole] || defaultColors[colorIdx++ % 6] : defaultColors[colorIdx++ % 6]
                                }
                                const maxDay = Math.max(1, ...days.map(day => {
                                  let sum = 0
                                  for (const ag of projectAgents) sum += (commitData[ag.id] || {})[day] || 0
                                  return sum
                                }))
                                return (
                                  <>
                                    <div className="flex items-end gap-1 overflow-hidden" style={{ height: '60px' }}>
                                      {days.map(day => (
                                        <div key={day} className="flex-1 flex flex-col items-center gap-0.5">
                                          <div className="w-full flex flex-col-reverse gap-px" style={{ height: `${60}px` }}>
                                            {projectAgents.map(ag => {
                                              const count = (commitData[ag.id] || {})[day] || 0
                                              if (count === 0) return null
                                              const h = Math.max(2, (count / maxDay) * 48)
                                              return <div key={ag.id} style={{ height: `${h}px`, background: agentColors[ag.id], borderRadius: '2px' }} title={`${ag.name}: ${count}`} />
                                            })}
                                          </div>
                                          <span className="text-[9px] font-mono text-text-muted">{parseInt(day.slice(8))}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="flex gap-3 mt-2 flex-wrap">
                                      {projectAgents.filter(ag => Object.values(commitData[ag.id] || {}).some(n => n > 0)).map(ag => (
                                        <span key={ag.id} className="flex items-center gap-1 text-[10px] text-text-muted">
                                          <span className="w-2 h-2 rounded-sm" style={{ background: agentColors[ag.id] }} />
                                          {ag.name}
                                        </span>
                                      ))}
                                    </div>
                                  </>
                                )
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Agent Work Time (from logs) */}
                        {projectAgents.length > 0 && (
                          <div className="glass-card overflow-hidden">
                            <div className="px-4 py-2 border-b border-border">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Agent Activity (this session)</span>
                            </div>
                            <div className="px-4 py-2">
                              {projectAgents.map(ag => {
                                const emoji = ag.taskGroupRole === 'manager' ? '👑' : ag.taskGroupRole === 'worker' ? '🔧' : ag.taskGroupRole === 'qa' ? '🛡️' : ag.taskGroupRole === 'critic' ? '⚖️' : '👤'
                                const color = ag.taskGroupRole === 'manager' ? 'text-amber-400' : ag.taskGroupRole === 'worker' ? 'text-blue-400' : ag.taskGroupRole === 'qa' ? 'text-emerald-400' : ag.taskGroupRole === 'critic' ? 'text-purple-400' : 'text-text-secondary'
                                const barColor = ag.taskGroupRole === 'manager' ? 'bg-amber-400' : ag.taskGroupRole === 'worker' ? 'bg-blue-400' : ag.taskGroupRole === 'qa' ? 'bg-emerald-400' : ag.taskGroupRole === 'critic' ? 'bg-purple-400' : 'bg-accent'
                                const agTasks = tasks.filter(t => t.owner === ag.id)
                                const agDone = agTasks.filter(t => t.status === 'done').length
                                return (
                                  <div key={ag.id} className="grid grid-cols-[20px_1fr_80px_48px] gap-2 items-center py-1.5 text-[12px]">
                                    <span className="text-center">{emoji}</span>
                                    <span className={`font-medium truncate ${color}`}>{ag.name}</span>
                                    <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${totalTasks > 0 ? (agDone / Math.max(...projectAgents.map(a => tasks.filter(t => t.owner === a.id && t.status === 'done').length), 1)) * 100 : 0}%` }} />
                                    </div>
                                    <span className="text-right font-mono text-[11px] text-text-muted">{agDone} done</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  {/* Unified Todo List — em-dash placeholder while
                      lazy project.scan IPC is in flight. */}
                  {!projectScan && (
                    <div className="glass-card p-5 text-center" data-testid="todos-loading">
                      <span className="text-2xl font-heading font-bold text-text-muted">—</span>
                      <span className="text-[11px] text-text-muted ml-1">todos</span>
                    </div>
                  )}
                  {projectScan && (() => {
                    const allTodos = projectScan.todos
                    const openTodos = allTodos.filter((t) => !t.done)
                    const doneTodos = allTodos.filter((t) => t.done)
                    const total = allTodos.length
                    const doneCount = doneTodos.length
                    const pctDone = total > 0 ? Math.round((doneCount / total) * 100) : 0
                    const displayed = [...openTodos.slice(0, 10), ...doneTodos.slice(0, 2)]
                    const remaining = total - displayed.length
                    const zoneTag = (t: any) => {
                      if (t.type === 'non-rnd') return { label: 'Admin', cls: 'bg-status-working/10 text-status-working' }
                      if (t.category === 'rd') return { label: 'R&D', cls: 'bg-accent/10 text-accent' }
                      return { label: t.category || 'R&D', cls: 'bg-accent/10 text-accent' }
                    }
                    return total > 0 ? (
                      <div className="glass-card overflow-hidden">
                        <div className="flex items-center gap-4 px-5 py-3 border-b border-border">
                          <div>
                            <span className="text-2xl font-heading font-bold text-text-primary">{total}</span>
                            <span className="text-[11px] text-text-muted ml-1">todos</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between mb-1">
                              <span className="text-[11px] text-text-muted">{doneCount} done · {openTodos.length} open</span>
                              <span className="text-[11px] text-text-muted font-mono">{pctDone}%</span>
                            </div>
                            <div className="h-1 bg-bg-hover rounded-full overflow-hidden">
                              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pctDone}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-[24px_1fr_56px_48px] gap-2 px-5 py-1.5 text-[11px] font-heading font-bold uppercase tracking-wider text-text-muted border-b border-border/50">
                          <span className="text-right">#</span>
                          <span>Task</span>
                          <span className="text-center">Zone</span>
                          <span className="text-right">Status</span>
                        </div>
                        <div>
                          {displayed.map((t, i) => {
                            const zt = zoneTag(t)
                            return (
                              <div key={i} className="grid grid-cols-[24px_1fr_56px_48px] gap-2 items-center px-5 py-1.5 hover:bg-bg-hover/50 transition-colors">
                                <span className="text-[11px] text-text-muted text-right font-mono">{i + 1}</span>
                                <span className={`text-[13px] truncate ${t.done ? 'text-text-muted line-through' : 'text-text-primary'}`}>{t.text}</span>
                                <span className={`text-[11px] font-bold uppercase tracking-wide text-center px-1.5 py-0.5 rounded ${zt.cls}`}>{zt.label}</span>
                                <span className={`text-[11px] text-right font-mono ${t.done ? 'text-status-done' : 'text-text-muted'}`}>{t.done ? 'done' : 'open'}</span>
                              </div>
                            )
                          })}
                          {remaining > 0 && (
                            <div className="px-5 py-2 text-[11px] text-text-muted">+{remaining} more</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="glass-card p-5 text-center">
                        <p className="text-xs text-text-muted">No todos found in project markdown files</p>
                      </div>
                    )
                  })()}

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
                              <p className="text-[13px] text-text-muted font-mono truncate">{zone.path}</p>
                            </div>
                            <span className="text-[13px] text-text-muted uppercase">{zone.type === 'rnd' ? 'R&D' : 'Docs'}</span>
                            <span className="text-[13px] text-text-muted">{zoneAgents.length} agent{zoneAgents.length !== 1 ? 's' : ''}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Task Group Tab */}
              {projectTab === 'taskgroup' && (
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {(() => {
                    const taskGroup = taskGroups.find((tg) => tg.projectId === selectedProjectId)
                    if (!taskGroup) {
                      return (
                        <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4 py-20">
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          <p className="text-sm font-medium">No active Task Group</p>
                          <p className="text-xs text-text-muted/60 text-center max-w-xs">
                            Assign Manager, Workers, QA, and Critic roles to run batch-driven task execution.
                          </p>
                          <button
                            onClick={() => setShowCreateTaskGroup(true)}
                            className="px-4 py-2 rounded-lg bg-accent text-text-on-purple text-sm font-medium hover:bg-accent-hover transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            Create Task Group
                          </button>
                        </div>
                      )
                    }
                    // Active task group
                    return (
                      <div className="space-y-4">
                        {/* Agent Roster — vertical list */}
                        <div className="glass-card overflow-hidden">
                          <div className="grid grid-cols-[36px_1fr_80px_100px] gap-2 px-4 py-2 text-[11px] font-heading font-bold uppercase tracking-wider text-text-muted border-b border-border">
                            <span></span>
                            <span>Agent</span>
                            <span className="text-center">Dept</span>
                            <span className="text-center">Role</span>
                          </div>
                          {[
                            { id: taskGroup.managerId, role: 'manager', icon: '👑', color: '#F59E0B', bgColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.2)' },
                            ...taskGroup.workerIds.map((id: string) => ({ id, role: 'worker', icon: '🔧', color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)' })),
                            { id: taskGroup.qaId, role: 'qa', icon: '🛡️', color: '#10B981', bgColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' },
                            { id: taskGroup.criticId, role: 'critic', icon: '⚖️', color: '#8B5CF6', bgColor: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.2)' },
                          ].map(({ id, role, icon, color, bgColor, borderColor }) => {
                            const agent = agents.find(a => a.id === id)
                            if (!agent) return null
                            const dept = agent.department === 'rnd' ? 'R&D' : agent.department === 'non-rnd' ? 'Non-R&D' : agent.department || ''
                            const jobLabel = agent.role ? `${dept} · ${agent.role}` : dept
                            return (
                              <div key={id} className="grid grid-cols-[36px_1fr_80px_100px] gap-2 items-center px-4 py-2.5 hover:bg-bg-hover transition-colors">
                                <span className="w-9 h-9 flex items-center justify-center rounded-lg text-lg" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>{icon}</span>
                                <div className="min-w-0">
                                  <div className="text-[13px] font-heading font-semibold text-text-primary truncate">{agent.name}</div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">{agent.role || role}</div>
                                </div>
                                <span className="text-[11px] text-text-muted text-center font-mono">{jobLabel}</span>
                                <span className="text-[13px] text-center px-2 py-1 rounded-md flex items-center justify-center gap-1" style={{ background: bgColor, border: `1px solid ${borderColor}` }}>
                                  <span className="text-base">{icon}</span>
                                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{role}</span>
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        {/* Auto-approve indicator */}
                        {autoApprove && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-status-working/10 border border-status-working/20">
                            <span className="text-[11px] text-status-working font-medium">Auto-approve ON</span>
                            <button onClick={() => setAutoApprove(false)} className="text-[11px] text-text-muted hover:text-red-400 cursor-pointer ml-auto">Stop</button>
                          </div>
                        )}

                        {/* Batch Proposal Card — above batch list */}
                        {batchProposal && taskGroup.status === 'batch_proposed' && !autoApprove && (
                          <div className="glass-card border-accent/30 p-4">
                            <h4 className="text-xs font-heading font-bold text-accent mb-2">Batch Proposal</h4>
                            {(batchProposal.tasks || []).map((t: any, i: number) => (
                              <div key={i} className="text-xs text-text-primary py-0.5">
                                {i + 1}. {t.title} <span className="text-text-muted/50">({t.scope})</span>
                              </div>
                            ))}
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => {
                                  window.api.agent.send(taskGroup.managerId, 'HUMAN', { batch: batchProposal.batch, action: 'approved' })
                                  window.api.pty.write(taskGroup.managerId, 'Y\r')
                                  setTaskGroups(prev => prev.map(tg => tg.id === taskGroup.id ? { ...tg, status: 'batch_approved' as const, currentBatch: batchProposal.batch } : tg))
                                  setBatchProposal(null)
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs bg-accent text-text-on-purple hover:bg-accent-hover cursor-pointer"
                              >Approve</button>
                              <button
                                onClick={() => {
                                  setAutoApprove(true)
                                  window.api.agent.send(taskGroup.managerId, 'HUMAN', { batch: batchProposal.batch, action: 'approved' })
                                  window.api.pty.write(taskGroup.managerId, 'Y\r')
                                  setTaskGroups(prev => prev.map(tg => tg.id === taskGroup.id ? { ...tg, status: 'batch_approved' as const, currentBatch: batchProposal.batch } : tg))
                                  setBatchProposal(null)
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs bg-status-working/20 text-status-working hover:bg-status-working/30 cursor-pointer"
                              >Always Approve</button>
                              <button
                                onClick={() => {
                                  window.api.agent.send(taskGroup.managerId, 'HUMAN', { batch: batchProposal.batch, action: 'rejected' })
                                  setBatchProposal(null)
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-text-muted hover:text-red-400 cursor-pointer"
                              >Reject</button>
                            </div>
                          </div>
                        )}

                        {/* Batches — current expanded, historical collapsed */}
                        {(() => {
                          const allTasks = batchTasks[taskGroup.projectId] || []
                          if (allTasks.length === 0) return (
                            <div className="glass-card p-4">
                              <p className="text-xs text-text-muted">No tasks yet. Use /manager-whip-start to begin.</p>
                            </div>
                          )
                          // Find current batch = batch with most recent task activity
                          const byBatch = new Map<number, typeof allTasks>()
                          allTasks.forEach(t => {
                            const b = t.batch || 1
                            if (!byBatch.has(b)) byBatch.set(b, [])
                            byBatch.get(b)!.push(t)
                          })
                          let currentBatchNum = 1
                          let latestTime = 0
                          for (const [bNum, bTasks] of byBatch) {
                            const t = Math.max(...bTasks.map(t => t.assignedAt ? new Date(t.assignedAt).getTime() : 0))
                            if (t > latestTime) { latestTime = t; currentBatchNum = bNum }
                          }
                          const bTasks = byBatch.get(currentBatchNum) || []
                          const done = bTasks.filter(t => t.status === 'done').length
                          const blocked = bTasks.filter(t => t.status === 'blocked').length
                          const abandoned = bTasks.filter(t => t.status === 'abandoned').length
                          return (
                            <div className="glass-card">
                              <div className="flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-sm font-heading font-bold text-text-primary">Current Batch</h3>
                                  {(() => {
                                    const dates = bTasks.map(t => t.assignedAt).filter(Boolean).sort().reverse()
                                    if (!dates.length) return null
                                    const start = new Date(dates[0]!).toLocaleDateString([], { month: 'short', day: 'numeric' })
                                    return <span className="text-[11px] text-text-muted font-mono">{start}</span>
                                    })()}
                                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-heading font-bold uppercase tracking-wider ${
                                    taskGroup.status === 'executing' ? 'bg-status-working/20 text-status-working' :
                                    taskGroup.status === 'awaiting_merge' ? 'bg-accent/20 text-accent' :
                                    'bg-bg-hover text-text-muted'
                                  }`}>{taskGroup.status.replace('_', ' ')}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="w-24 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                                    <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${bTasks.length ? ((done + abandoned) / bTasks.length) * 100 : 0}%` }} />
                                  </div>
                                  <span className="text-[12px] text-text-muted font-mono">
                                    {done}/{bTasks.length}
                                    {blocked > 0 && ` · ${blocked} blocked`}
                                    {abandoned > 0 && ` · ${abandoned} abandoned`}
                                  </span>
                                </div>
                              </div>
                              <div className="pb-2">
                                <div className="grid grid-cols-[100px_72px_1fr_80px] gap-2 px-4 py-1.5 text-[11px] font-heading font-bold uppercase tracking-wider text-text-muted border-b border-border/50">
                                  <span>Worker</span>
                                  <span>Task</span>
                                  <span>Summary</span>
                                  <span className="text-right">Result</span>
                                </div>
                                {[...bTasks].reverse().map((t) => {
                                  const workerName = t.owner ? (agents.find(a => a.id === t.owner)?.name || t.owner) : '—'
                                  const statusIcon = t.status === 'done' ? '✅' : t.status === 'blocked' ? '❌' : t.status === 'abandoned' ? '🚫' : t.status === 'in_progress' ? '🔄' : t.status === 'assigned' ? '📋' : '⏳'
                                  return (
                                    <div key={t.id} className={`grid grid-cols-[100px_72px_1fr_80px] gap-2 items-center px-4 py-1.5 text-[12px] hover:bg-bg-hover/30 transition-colors ${t.status === 'abandoned' ? 'opacity-50' : ''}`}
                                      title={t.status === 'abandoned' ? `Abandoned: ${t.abandoned_reason || ''}` : t.status === 'blocked' ? `Blocked: ${t.blocked_reason || ''}` : t.note ? `Note: ${t.note}` : ''}>
                                      <span className="text-text-secondary truncate">{t.owner ? '🔧 ' : ''}{workerName}</span>
                                      <span className="font-mono text-[11px] text-text-muted">{t.id}</span>
                                      <span className={`truncate ${t.status === 'abandoned' ? 'text-text-muted line-through' : 'text-text-primary'}`}>{t.title}{t.note ? ' 📌' : ''}</span>
                                      <span className="text-right text-[11px]">{statusIcon} {t.status}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}


                        {/* Merge Card */}
                        {taskGroup.status === 'awaiting_merge' && (
                          <div className="glass-card border-accent/30 p-4">
                            <h4 className="text-xs font-heading font-bold text-accent mb-2">Ready to Merge</h4>
                            <div className="flex items-center gap-3 text-xs text-text-muted mb-3">
                              <span>QA: ✅</span>
                              <span>Critic: ✅</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  window.api.agent.send(taskGroup.managerId, 'HUMAN', { action: 'merged', next: true })
                                  setTaskGroups(prev => prev.map(tg => tg.id === taskGroup.id ? { ...tg, status: 'idle' as const } : tg))
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs bg-accent text-text-on-purple hover:bg-accent-hover cursor-pointer"
                              >Merge & Next Batch</button>
                              <button
                                onClick={() => {
                                  window.api.agent.send(taskGroup.managerId, 'HUMAN', { action: 'rejected', feedback: 'Needs changes' })
                                  setTaskGroups(prev => prev.map(tg => tg.id === taskGroup.id ? { ...tg, status: 'executing' as const } : tg))
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-text-muted hover:text-red-400 cursor-pointer"
                              >Reject</button>
                            </div>
                          </div>
                        )}

                        {/* Manager Reports */}
                        {managerReports.length > 0 && (
                          <div>
                            <h4 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Manager Reports</h4>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {managerReports.slice(-5).map((r, i) => (
                                <div key={i} className="text-[13px] text-text-muted py-0.5">
                                  <span className="text-text-muted/40 font-mono">{new Date(r.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  {' '}{r.message}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Activity Log */}
                        {(() => {
                          const sysActions = ['gate', 'auto-assign', 'stuck', 'dispatch']
                          const roleEmoji = (agId: string | null) => {
                            if (!agId) return '⚡'
                            const ag = agents.find(a => a.id === agId)
                            if (!ag) return '⚡'
                            const r = ag.taskGroupRole
                            return r === 'manager' ? '👑' : r === 'worker' ? '🔧' : r === 'qa' ? '🛡️' : r === 'critic' ? '⚖️' : '⚡'
                          }
                          const roleName = (agId: string | null) => {
                            if (!agId) return null
                            const ag = agents.find(a => a.id === agId)
                            return ag?.name || null
                          }
                          const roleColor = (agId: string | null) => {
                            if (!agId) return 'text-text-muted'
                            const ag = agents.find(a => a.id === agId)
                            const r = ag?.taskGroupRole
                            return r === 'manager' ? 'text-amber-400' : r === 'worker' ? 'text-blue-400' : r === 'qa' ? 'text-emerald-400' : r === 'critic' ? 'text-purple-400' : 'text-text-muted'
                          }
                          const isSys = (e: any) => !e.agentId || sysActions.includes(e.action)
                          const actionColor = (action: string, detail: string) => {
                            if (action === 'task-abandon' || detail.includes('🚫')) return 'text-amber-400'
                            if (action === 'task-blocked' || detail.includes('❌') || detail.includes('FAIL')) return 'text-red-400'
                            if (action === 'task-done' || detail.includes('✅') || detail.includes('PASSED')) return 'text-emerald-400'
                            if (action === 'task-create' || action === 'batch-propose') return 'text-accent'
                            if (action === 'task-assign' || action === 'auto-assign') return 'text-blue-400'
                            if (action === 'stuck' || action === 'limit') return 'text-amber-400'
                            return 'text-text-muted'
                          }
                          return (
                            <div className="glass-card overflow-hidden">
                              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                                <h4 className="text-[13px] font-heading font-bold">Activity Log</h4>
                                <div className="flex gap-1">
                                  <button onClick={() => { window.api.dispatcher.clearLog(); setDispatcherLog([]) }} className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-red-400 hover:bg-bg-hover transition-colors cursor-pointer">Clear</button>
                                  <button onClick={() => {
                                    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
                                    window.api.dispatcher.clearLog(cutoff).then(setDispatcherLog)
                                  }} className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer">&gt;3d</button>
                                  <button onClick={() => {
                                    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
                                    window.api.dispatcher.clearLog(cutoff).then(setDispatcherLog)
                                  }} className="px-2 py-1 rounded text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer">&gt;10d</button>
                                </div>
                              </div>
                              <div className="grid grid-cols-[20px_90px_56px_64px_80px_1fr] gap-1.5 px-4 py-1.5 text-[10px] font-heading font-bold uppercase tracking-wider text-text-muted border-b border-border/50">
                                <span></span>
                                <span>Who</span>
                                <span>Time</span>
                                <span>Task</span>
                                <span>Action</span>
                                <span>Content</span>
                              </div>
                              <div className="max-h-[400px] overflow-y-auto">
                                {dispatcherLog.length === 0 && (
                                  <div className="px-4 py-6 text-center text-[12px] text-text-muted">No activity yet</div>
                                )}
                                {dispatcherLog.map((entry, i) => {
                                  const sys = isSys(entry)
                                  const d = new Date(entry.time)
                                  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                  const datePrefix = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
                                  const name = roleName(entry.agentId) || 'system'
                                  return (
                                    <div key={i} className={`grid grid-cols-[20px_90px_56px_64px_80px_1fr] gap-1.5 items-center px-4 py-1.5 text-[12px] hover:bg-bg-hover/30 transition-colors border-b border-border/30 ${sys ? 'opacity-50 hover:opacity-80' : ''}`}>
                                      <span className="text-[14px] text-center">{roleEmoji(entry.agentId)}</span>
                                      <span className={`font-medium truncate ${roleColor(entry.agentId)}`}>{name}</span>
                                      <span className="text-text-muted/50 font-mono text-[10px]" title={`${datePrefix} ${timeStr}`}>{timeStr}</span>
                                      <span className="font-mono text-[10px] text-text-muted">{(entry.detail.match(/task-\d+/) || [''])[0]}</span>
                                      <span className={`font-mono text-[10px] font-bold uppercase tracking-wide ${actionColor(entry.action, entry.detail)}`}>{entry.action.replace('task-', '')}</span>
                                      <span className="text-text-primary truncate">{entry.detail}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}

                        {/* Controls */}
                        <div className="flex gap-2 items-center flex-wrap">
                          <button
                            onClick={() => {
                              window.api.inbox.list(taskGroup.projectId).then(setInboxData)
                              setShowInbox(true)
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                          >📬 Inbox</button>
                          <button
                            onClick={() => {
                              setTaskGroups(prev => prev.map(tg =>
                                tg.id === taskGroup.id ? { ...tg, dailyReportEnabled: !tg.dailyReportEnabled } : tg
                              ))
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                              taskGroup.dailyReportEnabled
                                ? 'bg-accent/10 border-accent/30 text-accent'
                                : 'bg-bg-secondary border-border text-text-muted hover:text-text-primary hover:bg-bg-hover'
                            }`}
                          >
                            📋 Daily Report {taskGroup.dailyReportEnabled ? 'ON' : 'OFF'}
                          </button>
                          <button
                            onClick={() => {
                              setBatchTasks(prev => {
                                const next = { ...prev }
                                delete next[taskGroup.projectId]
                                return next
                              })
                              window.api.dispatcher.clearLog()
                              setDispatcherLog([])
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                          >🧹 Clear History</button>
                          <button
                            disabled
                            title="Pause coming in v0.10.0"
                            className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-text-muted opacity-50 cursor-not-allowed"
                          >
                            ⏸ Pause
                          </button>
                          <button
                            onClick={() => {
                              // Dissolve task group
                              setAgents(prev => prev.map(a => {
                                if (a.taskGroupRole) {
                                  const { taskGroupRole, ...rest } = a
                                  return rest as Agent
                                }
                                return a
                              }))
                              setTaskGroups(prev => prev.filter(tg => tg.id !== taskGroup.id))
                              setBatchProposal(null)
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-red-400/70 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
                          >
                            🗑 Dissolve
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Inbox Modal */}
              {showInbox && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowInbox(false)} />
                  <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-e3 w-[600px] max-h-[70vh] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                      <h2 className="font-heading font-semibold text-sm">📬 Message Inbox</h2>
                      <button onClick={() => setShowInbox(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover cursor-pointer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {inboxData.length === 0 && <p className="text-text-muted text-sm text-center py-8">No inbox messages</p>}
                      {inboxData.map(({ agentId, messages }) => {
                        const ag = agents.find(a => a.id === agentId)
                        const name = ag?.name || agentId
                        const emoji = ag?.taskGroupRole === 'manager' ? '👑' : ag?.taskGroupRole === 'worker' ? '🔧' : ag?.taskGroupRole === 'qa' ? '🛡️' : ag?.taskGroupRole === 'critic' ? '⚖️' : '👤'
                        if (messages.length === 0) return null
                        return (
                          <div key={agentId}>
                            <div className="text-[12px] font-semibold text-text-secondary mb-1">{emoji} {name} ({messages.length} messages)</div>
                            <div className="space-y-1 max-h-[200px] overflow-y-auto">
                              {[...messages].reverse().map((msg, i) => (
                                <div key={i} className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border border-border/30 ${msg._read ? 'bg-bg-primary/30 text-text-muted' : 'bg-accent/5 text-text-primary'}`}>
                                  <span className="text-text-muted/50">{new Date(msg.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                  {' '}<span className={`font-bold ${msg._read ? 'text-text-muted' : 'text-accent'}`}>[{msg.type}]</span>
                                  {' '}{msg.message || msg.summary || msg.title || msg.status || JSON.stringify(msg).slice(0, 120)}
                                </div>
                              ))}
                            </div>
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
                          <span className="text-[13px] text-text-muted truncate ml-auto max-w-[200px] font-mono">{zone.path}</span>
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
                          <span className="text-[13px] text-text-muted truncate ml-auto max-w-[200px] font-mono">{zone.path}</span>
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
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Delete this project?',
                          message: `Deleting "${selectedProject.name}" removes it and all its agents from Hive. Files on disk are untouched.`,
                          confirmLabel: 'Delete project',
                          cancelLabel: 'Keep'
                        })
                        if (!ok) return
                        setAgents((prev) => prev.filter((a) => a.projectId !== selectedProject.id))
                        setProjects((prev) => prev.filter((p) => p.id !== selectedProject.id))
                        setSelectedProjectId(null)
                        setSelectedAgentId(null)
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
                className="absolute inset-0"
                style={{
                  background: '#201F26',
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
                  continueSession={appPrefs.continueSession && !!agent.worktreePath && !newAgentIds.has(agent.id)}
                  startupCommand={agent.preferences?.startupCommand}
                  rebaseOnStart={appPrefs.rebaseOnRestart !== false && agent.type === 'coding' && !!agent.worktreePath && !newAgentIds.has(agent.id)}
                  onCloseTerminal={() => setActiveTerminals(prev => { const next = new Set(prev); next.delete(agentId); return next })}
                  chatFontSize={appPrefs.chatFontSize}
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
                        <AvatarPreview config={selectedAgent.avatar} size={40} loopBusy={activeHandoffAgentIds.has(selectedAgent.id)} selected />
                      </div>
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={selectedAgent.name}
                          onChange={(e) => updateAgent(selectedAgent.id, { name: e.target.value })}
                          className="w-full px-3 py-1 rounded-lg bg-bg-primary border border-border text-text-primary text-sm font-semibold focus:outline-none focus:border-accent transition-colors"
                          placeholder="Name"
                        />
                        <div className="flex items-center gap-1.5 px-3">
                          <span className="text-[13px] text-text-muted">Tag:</span>
                          {['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'].map((c) => (
                            <button
                              key={c || 'none'}
                              onClick={() => updateAgent(selectedAgent.id, { tagColor: c || undefined })}
                              className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform ${selectedAgent.tagColor === c || (!selectedAgent.tagColor && !c) ? 'border-text-primary scale-125' : 'border-transparent'}`}
                              style={{ background: c || 'var(--bg-hover)' }}
                              title={c || 'No tag'}
                            />
                          ))}
                        </div>
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
                        className="text-[13px] text-accent hover:text-accent-hover cursor-pointer font-medium"
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
                        [&_code]:text-[13px] [&_code]:bg-bg-primary [&_code]:px-1 [&_code]:rounded">
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
                                  <span className="text-[13px] text-text-muted">{enabledCount}/{packSkills.length}</span>
                                </div>
                                <button
                                  onClick={() => {
                                    const current = selectedAgent.enabledSkills || []
                                    const allEnabled = packSkills.every((s) => current.includes(s.name))
                                    const next = allEnabled ? current.filter((s) => !packSkills.some((ps) => ps.name === s)) : [...new Set([...current, ...packSkills.map((s) => s.name)])]
                                    updateAgent(selectedAgent.id, { enabledSkills: next })
                                  }}
                                  className="text-[13px] text-accent hover:text-accent-hover cursor-pointer font-medium"
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
                                      <p className="text-[13px] text-text-muted px-4 pb-2 pl-9">{skill.description}</p>
                                    )}
                                    {isExpanded && skillContent && (
                                      <pre className="px-4 py-3 mx-4 mb-3 rounded-lg bg-bg-primary border border-border
                                        text-[13px] text-text-muted font-mono leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
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
                    <p className="text-[13px] text-text-muted mt-1.5">Leave empty to use app default</p>
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
                            <span className="text-[13px] text-text-muted uppercase ml-auto">{zone.type === 'rnd' ? 'R&D' : 'Docs'}</span>
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
                        <span className="text-[13px] text-text-muted font-mono truncate">{selectedAgent.worktreePath}</span>
                        <p className="text-[13px] text-text-muted ml-auto">Changing zone will reset worktree</p>
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
                    className="text-[13px] text-accent hover:text-accent-hover cursor-pointer"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => {
                      window.api.agent.clearLogs(selectedAgent.id).then(() => setAgentLogs([]))
                    }}
                    className="text-[13px] text-red-400 hover:text-red-300 cursor-pointer"
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
                              <span className="text-[13px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold uppercase">Task</span>
                              <span className="text-sm font-medium text-text-primary">{block.title}</span>
                            </>
                          ) : (
                            <span className="text-sm text-text-muted">Activity</span>
                          )}
                          {block.startTime && (
                            <span className="text-[13px] text-text-muted ml-auto font-mono">
                              {new Date(block.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                            </span>
                          )}
                        </div>
                        {/* Summary if done */}
                        {block.summary && (
                          <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-status-working/5">
                            <span className="text-[13px] px-1.5 py-0.5 rounded bg-status-working/20 text-status-working font-semibold uppercase">Done</span>
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
                                <div key={li} className="flex items-center gap-2 text-[13px]">
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
                            <p className="text-[13px] text-text-muted">{block.statusChanges} status changes</p>
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
              onOpenFile={setPreviewFilePath}
            />
          </>
        )
      })()}

      {/* Modals */}
      <CreateProjectModal
        open={showCreateProject}
        onClose={() => setShowCreateProject(false)}
        onCreate={handleCreateProject}
        gitTokens={{ github: appPrefs.githubToken, gitlab: appPrefs.gitlabToken }}
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

      {selectedProject && (
        <CreateTaskGroupModal
          open={showCreateTaskGroup}
          onClose={() => setShowCreateTaskGroup(false)}
          projectId={selectedProject.id}
          agents={projectAgents}
          onSubmit={(tg) => {
            setTaskGroups((prev) => [...prev, tg])
            // Set taskGroupRole on agents and rewrite their definition files
            const updatedAgents = agents.map((a) => {
              if (a.id === tg.managerId) return { ...a, taskGroupRole: 'manager' as const }
              if (a.id === tg.qaId) return { ...a, taskGroupRole: 'qa' as const }
              if (a.id === tg.criticId) return { ...a, taskGroupRole: 'critic' as const }
              if (tg.workerIds.includes(a.id)) return { ...a, taskGroupRole: 'worker' as const }
              return a
            })
            setAgents(updatedAgents)
            // Rewrite agent definition files with soul addendum for all task group members
            const tgAgentIds = [tg.managerId, ...tg.workerIds, tg.qaId, tg.criticId]
            for (const agId of tgAgentIds) {
              const ag = updatedAgents.find(a => a.id === agId)
              if (!ag) continue
              const proj = projects.find(p => p.id === ag.projectId)
              const zone = proj?.zones?.find((z: Zone) => z.id === ag.zoneId)
              const cwd = ag.worktreePath || zone?.path
              if (!cwd) continue
              const defCfg: Record<string, any> = {
                agentId: ag.id, name: ag.name, role: ag.role, department: ag.department,
                soul: ag.soul, skills: ag.enabledSkills || [], model: ag.model || 'inherit',
                effort: ag.effort || 'high', taskGroupRole: ag.taskGroupRole,
              }
              if (ag.taskGroupRole === 'manager') {
                defCfg.todoSource = tg.todoSource
                defCfg.maxGateRetries = tg.maxGateRetries
                defCfg.taskGroupProjectId = tg.projectId
                defCfg.taskGroupWorkers = tg.workerIds.map(wid => {
                  const w = updatedAgents.find(a => a.id === wid)
                  return { id: wid, name: w?.name || wid }
                })
                const qa = updatedAgents.find(a => a.id === tg.qaId)
                defCfg.taskGroupQaId = tg.qaId
                defCfg.taskGroupQaName = qa?.name || tg.qaId
                const critic = updatedAgents.find(a => a.id === tg.criticId)
                defCfg.taskGroupCriticId = tg.criticId
                defCfg.taskGroupCriticName = critic?.name || tg.criticId
                defCfg.dailyReportEnabled = tg.dailyReportEnabled
              }
              window.api.agent.writeDefinition(cwd, defCfg)
            }
            // Auto-create target branch (staging) if it doesn't exist
            if (tg.targetBranch) {
              const proj = projects.find(p => p.id === tg.projectId)
              const rndZone = proj?.zones?.find((z: Zone) => z.type === 'rnd')
              if (rndZone?.path) {
                window.api.git.createTargetBranch(rndZone.path, tg.targetBranch)
              }
            }
          }}
        />
      )}

      {/* v2.6.0: Overview screen — absolute overlay covering everything to
          the right of the projects sidebar. Keeps the sidebar accessible
          so users can switch back to a project view with one click. */}
      {mainScreen === 'overview' && (
        <div
          className="fixed top-0 right-0 bottom-0 z-30 bg-bg-primary"
          // v2.9.3: no-drag on the whole Overview overlay — click hits
          // any interactive element (esp. the close X) on the FIRST
          // press, not the 2nd/3rd after macOS auto-focuses the window.
          style={{ left: panelWidths.projects, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <OverviewPage
            projects={projects}
            agents={displayAgents}
            /* v2.9.2: use activeTerminals (immediate) not liveSessionAgents
               (waits for first status/report hook — 3-10s lag after
               user clicks Resume). User: "生成了 missy 新 session 但
               overview 里却没有". Signal fired the moment startAgent()
               runs, matches user mental model. Startup auto-mount still
               counted, but user can Close from Overview if unwanted. */
            activeTerminals={activeTerminals}
            activeHandoffAgentIds={activeHandoffAgentIds}
            agentTasks={agentTasks}
            onOpenAgent={(agent) => {
              setSelectedProjectId(agent.projectId)
              setSelectedAgentId(agent.id)
              setMainScreen('projects')
              if (!activeTerminals.has(agent.id)) startAgent(agent)
            }}
            onCloseSession={async (agentId) => {
              try {
                await (window as any).api?.chat?.stop?.(agentId)
              } catch { /* silent — chat.stop already logs on the main side */ }
              setActiveTerminals((prev) => {
                const next = new Set(prev)
                next.delete(agentId)
                return next
              })
              // v2.8.2: also drop from the "live session" set so Overview
              // stops counting it. Real session is gone; the set matches.
              setLiveSessionAgents((prev) => {
                if (!prev.has(agentId)) return prev
                const next = new Set(prev)
                next.delete(agentId)
                return next
              })
            }}
            onSwitchProject={(projectId) => {
              setSelectedProjectId(projectId)
              setSelectedAgentId(null)
              setProjectTab('office')
              setMainScreen('projects')
            }}
            onClose={() => setMainScreen('projects')}
          />
        </div>
      )}

      {/* App Settings Modal */}
      {showAppSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAppSettings(false)} />
          <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-e3 w-[680px] max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-heading font-semibold text-base text-text-primary">App Settings</h2>
              <button onClick={() => setShowAppSettings(false)}
                aria-label="Close"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover transition-colors cursor-pointer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-5 max-h-[70vh] overflow-y-auto">
            {/* v2.9.0: STYLE picker (Accent | Prime). Prime is a full
                visual-language swap (mono font, glow, scanlines, hex
                avatars). Available palettes reconcile automatically —
                Prime narrows to purple + blue, pink stays Accent-only. */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Visual style</label>
              <div className="grid grid-cols-2 gap-2.5">
                {STYLES.map((id) => {
                  const meta = STYLE_META[id]
                  const selected = style === id
                  return (
                    <button
                      key={id}
                      onClick={() => setStyle(id)}
                      className={`text-left p-3 rounded-xl border-2 transition-colors cursor-pointer
                        ${selected
                          ? 'border-accent bg-accent-subtle'
                          : 'border-border bg-bg-primary hover:border-accent-muted'}`}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-sm font-heading font-semibold ${
                          id === 'prime' ? 'font-mono tracking-widest uppercase' : ''
                        } text-text-primary`}>
                          {meta.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted leading-relaxed">{meta.tagline}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* v2.6.0: accent-palette picker. Three swatches, click to apply
                instantly (no confirmation — reversible). Live-preview
                because the CSS vars update immediately on data-palette
                attribute change. */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Theme palette</label>
              <div className="grid grid-cols-3 gap-2.5">
                {PALETTES.map((id) => {
                  const meta = PALETTE_META[id]
                  const selected = palette === id
                  // v2.9.0: fade + disable palettes incompatible with the
                  // current Style (Prime has no pink).
                  const compatible = STYLE_META[style].compatiblePalettes.includes(id)
                  return (
                    <button
                      key={id}
                      onClick={() => compatible && setPalette(id)}
                      disabled={!compatible}
                      className={`text-left p-3 rounded-xl border-2 transition-colors cursor-pointer
                        ${selected
                          ? 'border-accent bg-accent-subtle'
                          : compatible
                            ? 'border-border bg-bg-primary hover:border-accent-muted'
                            : 'border-border bg-bg-primary opacity-40 cursor-not-allowed'}`}
                      aria-pressed={selected}
                      title={compatible ? meta.tagline : `Not available in ${STYLE_META[style].name} style`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-4 h-4 rounded-full ring-2 ring-white/10"
                          style={{ backgroundColor: meta.swatch }}
                        />
                        <span className="text-sm font-heading font-semibold text-text-primary">
                          {meta.name}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {compatible ? meta.tagline : `Accent only`}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Toggles */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">General</label>
              <div className="space-y-2 rounded-xl bg-bg-secondary border border-border overflow-hidden">
                {[
                  { label: 'Auto-run Claude', key: 'autoRunClaude' as const, value: appPrefs.autoRunClaude },
                  { label: 'Resume session (-c)', key: 'continueSession' as const, value: appPrefs.continueSession },
                  { label: 'Rebase on restart', key: 'rebaseOnRestart' as const, value: appPrefs.rebaseOnRestart !== false },
                ].map(({ label, key, value }) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
                    <span className="text-sm text-text-primary">{label}</span>
                    <button onClick={() => setAppPrefs((p) => ({ ...p, [key]: !value }))}
                      className={`w-9 h-5 rounded-full cursor-pointer transition-colors relative ${value ? 'bg-accent' : 'bg-bg-hover'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                  <span className="text-sm text-text-primary">Files panel</span>
                  <button onClick={() => setShowFiles((p) => !p)}
                    className={`w-9 h-5 rounded-full cursor-pointer transition-colors relative ${showFiles ? 'bg-accent' : 'bg-bg-hover'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showFiles ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                  <span className="text-sm text-text-primary">Max logs</span>
                  <select value={appPrefs.maxLogs} onChange={(e) => setAppPrefs((p) => ({ ...p, maxLogs: Number(e.target.value) }))}
                    className="text-sm bg-bg-hover text-text-primary rounded px-2 py-1 cursor-pointer border-none">
                    {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {/* v2.8.2: chat font size — global preference. Applies to
                    every project's chat pane. Was previously per-project
                    (v2.7.1) — user asked for global. */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-text-primary">Chat font size</span>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-text-muted font-mono tabular-nums">{CHAT_FONT_SIZE_MIN}</span>
                    <input
                      type="range"
                      min={CHAT_FONT_SIZE_MIN}
                      max={CHAT_FONT_SIZE_MAX}
                      step={1}
                      value={appPrefs.chatFontSize}
                      onChange={(e) => setAppPrefs((p) => ({ ...p, chatFontSize: clampChatFontSize(Number(e.target.value)) }))}
                      className="accent-accent cursor-pointer w-32"
                      aria-label="Chat font size (global)"
                    />
                    <span className="text-[10px] text-text-muted font-mono tabular-nums">{CHAT_FONT_SIZE_MAX}</span>
                    <span
                      className="text-sm font-heading font-semibold text-text-primary tabular-nums w-6 text-right"
                      style={{ fontSize: appPrefs.chatFontSize }}
                      title="Preview at selected size"
                    >{appPrefs.chatFontSize}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Storage — Claude Code logs cleanup */}
            <ClaudeLogsCleanup />

            {/* Git Tokens */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Git Tokens</label>
              <div className="space-y-2 rounded-xl bg-bg-secondary border border-border overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-text-primary">GitHub</span>
                    <span className="text-[13px] text-text-muted">{appPrefs.githubToken ? 'configured' : 'not set'}</span>
                  </div>
                  <input
                    type="password"
                    value={appPrefs.githubToken || ''}
                    onChange={(e) => setAppPrefs((p) => ({ ...p, githubToken: e.target.value }))}
                    placeholder="ghp_..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] font-mono placeholder:text-text-muted/40 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="px-4 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-text-primary">GitLab</span>
                    <span className="text-[13px] text-text-muted">{appPrefs.gitlabToken ? 'configured' : 'not set'}</span>
                  </div>
                  <input
                    type="password"
                    value={appPrefs.gitlabToken || ''}
                    onChange={(e) => setAppPrefs((p) => ({ ...p, gitlabToken: e.target.value }))}
                    placeholder="glpat-..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] font-mono placeholder:text-text-muted/40 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Default Skills */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Default Skills</label>
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-bg-secondary border border-border">
                  <p className="text-[13px] text-accent font-semibold uppercase mb-2">R&D Agents</p>
                  <div className="flex flex-wrap gap-1">
                    {availableSkills.map((s) => (
                      <button key={`rnd-${s.name}`}
                        onClick={() => setAppPrefs((p) => {
                          const cur = p.defaultSkillsRnD || []
                          return { ...p, defaultSkillsRnD: cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name] }
                        })}
                        className={`px-2 py-0.5 rounded-full text-[13px] cursor-pointer ${(appPrefs.defaultSkillsRnD || []).includes(s.name) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'}`}
                      >/{s.name}</button>
                    ))}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-bg-secondary border border-border">
                  <p className="text-[13px] text-status-working font-semibold uppercase mb-2">Non-R&D Agents</p>
                  <div className="flex flex-wrap gap-1">
                    {availableSkills.map((s) => (
                      <button key={`non-${s.name}`}
                        onClick={() => setAppPrefs((p) => {
                          const cur = p.defaultSkillsNonRnD || []
                          return { ...p, defaultSkillsNonRnD: cur.includes(s.name) ? cur.filter((x) => x !== s.name) : [...cur, s.name] }
                        })}
                        className={`px-2 py-0.5 rounded-full text-[13px] cursor-pointer ${(appPrefs.defaultSkillsNonRnD || []).includes(s.name) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'}`}
                      >/{s.name}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Templates */}
            <div>
              <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Agent Templates</label>
              <div className="space-y-1.5">
                {[...BUILTIN_TEMPLATES, ...customTemplates].map((t: any) => {
                  const inheritCount = agents.filter(a => a.role === t.role && a.department === t.department).length
                  const inheritNames = agents.filter(a => a.role === t.role && a.department === t.department).map(a => a.name)
                  return (
                    <div key={t.id} className="px-4 py-3 rounded-xl bg-bg-primary border border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{t.name}</span>
                        <span className="text-[13px] text-text-muted">{t.role} · {t.category}</span>
                        {inheritCount > 0 && (
                          <span className="ml-auto px-2 py-0.5 rounded-full bg-accent/15 text-accent text-[13px] font-semibold">
                            {inheritCount} agent{inheritCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {inheritCount === 0 && (
                          <span className="ml-auto text-[13px] text-text-muted">No agents</span>
                        )}
                        <button onClick={() => { setShowAppSettings(false); setEditingTemplate(t) }}
                          className="text-[13px] text-accent hover:text-accent-hover cursor-pointer font-medium">Edit</button>
                      </div>
                      {inheritCount > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {inheritNames.map(name => (
                            <span key={name} className="px-2 py-0.5 rounded-md bg-bg-secondary text-[13px] text-text-muted">{name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div></div></div>
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

      {/* Team name prompt */}
      {teamPrompt && (() => {
        const ungroupedAgents = agents.filter((a) => a.department === teamPrompt.dept && !a.group && a.projectId === selectedProject?.id)
        const canCreate = teamNameInput.trim() && teamSelectedAgents.size > 0
        const handleCreateTeam = () => {
          if (!canCreate) return
          setAgents((prev) => prev.map((a) => teamSelectedAgents.has(a.id) ? { ...a, group: teamNameInput.trim() } : a))
          setTeamPrompt(null)
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setTeamPrompt(null)} />
            <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-e3 w-[360px] p-5">
              <h3 className="text-sm font-heading font-semibold text-text-primary mb-3">New Team in {teamPrompt.dept}</h3>
              <input
                autoFocus
                type="text"
                value={teamNameInput}
                onChange={(e) => setTeamNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam() }}
                placeholder="Team name..."
                className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border text-text-primary text-sm placeholder:text-text-muted/50 focus:outline-none focus:border-accent mb-3"
              />
              {ungroupedAgents.length > 0 ? (
                <>
                  <label className="block text-[13px] text-text-muted uppercase tracking-wider font-semibold mb-2">Select agents to add</label>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {ungroupedAgents.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-hover cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={teamSelectedAgents.has(a.id)}
                          onChange={() => setTeamSelectedAgents((prev) => {
                            const next = new Set(prev)
                            if (next.has(a.id)) next.delete(a.id)
                            else next.add(a.id)
                            return next
                          })}
                          className="accent-[var(--accent)]"
                        />
                        <div className="w-5 h-5 flex-shrink-0"><AvatarPreview config={a.avatar} size={20} loopBusy={activeHandoffAgentIds.has(a.id)} selected={selectedAgentId === a.id} /></div>
                        <span className="text-sm text-text-primary">{a.name}</span>
                        <span className="text-[13px] text-text-muted ml-auto">{a.role}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-text-muted italic py-2">No ungrouped agents in {teamPrompt.dept}.</p>
              )}
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => setTeamPrompt(null)} className="px-3 py-1.5 rounded-lg text-[13px] text-text-muted hover:bg-bg-hover cursor-pointer">Cancel</button>
                <button
                  onClick={handleCreateTeam}
                  disabled={!canCreate}
                  className="px-3 py-1.5 rounded-lg text-[13px] bg-accent text-text-on-purple font-medium hover:bg-accent-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >Create Team ({teamSelectedAgents.size})</button>
              </div>
            </div>
          </div>
        )
      })()}

      <MarkdownPreviewModal filePath={previewFilePath} onClose={() => setPreviewFilePath(null)} />

      {deleteAgentConfirming && (
        <AgentDeleteConfirmModal
          agentName={deleteAgentConfirming.agent.name}
          impact={deleteAgentConfirming.impact}
          onCancel={() => setDeleteAgentConfirming(null)}
          onConfirm={async () => {
            const { agent, impact } = deleteAgentConfirming
            // Same destructive path the trash icon used to run in one shot.
            // Kept inline (not extracted) because it touches many pieces of
            // App state (activeTerminals, agents, selectedAgentId) and
            // multiple window.api namespaces; extracting them would just
            // move the same logic behind a longer signature.
            setDeleteAgentConfirming(null)
            if (impact.hasActiveTerminal) {
              window.api.pty.kill(agent.id)
              setActiveTerminals((prev) => { const next = new Set(prev); next.delete(agent.id); return next })
            }
            if (impact.worktreePath) {
              const zone = selectedProject?.zones.find((z: Zone) => z.id === agent.zoneId)
              if (zone) await window.api.git.worktreeRemove(zone.path, impact.worktreePath)
            }
            if (impact.definitionCwd) window.api.agent.deleteDefinition(impact.definitionCwd, agent.id)
            setAgents((prev) => prev.filter((a) => a.id !== agent.id))
            if (selectedAgentId === agent.id) setSelectedAgentId(null)
          }}
        />
      )}

      {/* Notification Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {managerReports.slice(-3).map((r, i) => {
          const age = Date.now() - new Date(r.time).getTime()
          if (age > 10000) return null // auto-dismiss after 10s
          return (
            <div key={i} className="pointer-events-auto bg-bg-secondary border border-border rounded-xl shadow-e2 p-3 max-w-xs animate-slide-in">
              <div className="flex items-start gap-2">
                <span className="text-sm" style={{ color: '#F59E0B' }}>♛</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary">{r.title}</p>
                  <p className="text-[13px] text-text-muted truncate">{r.message}</p>
                </div>
                <button
                  onClick={() => setManagerReports(prev => prev.filter((_, j) => j !== prev.length - 3 + i))}
                  className="text-text-muted/40 hover:text-text-muted cursor-pointer"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Storage cleanup widget for ~/.claude/projects. Lives inside the App
 * Settings modal. Shows current size + a retention slider, lets the
 * user dry-run a sweep before committing. Only files older than the
 * retention window are touched; subagent JSONLs (sidechain transcripts,
 * filtered out of Claude's /resume picker anyway) are eligible too.
 */
function ClaudeLogsCleanup() {
  const [retentionDays, setRetentionDays] = useState(15)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof window.api.storage.claudeLogStats>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [lastResult, setLastResult] = useState<Awaited<ReturnType<typeof window.api.storage.cleanClaudeLogs>> | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const s = await window.api.storage.claudeLogStats(retentionDays)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [retentionDays])

  const fmtMB = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

  const onDelete = async () => {
    setLoading(true)
    try {
      const r = await window.api.storage.cleanClaudeLogs(retentionDays, false)
      setLastResult(r)
      setConfirming(false)
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Storage · Claude Logs</label>
      <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-text-primary">~/.claude/projects</span>
            <span className="text-[13px] text-text-muted font-mono">
              {stats ? `${stats.totalFiles} files · ${fmtMB(stats.totalBytes)}` : '…'}
            </span>
          </div>
          {stats && (
            <div className="text-[11px] text-text-muted/80 font-mono">
              {stats.mainFiles} main session{stats.mainFiles === 1 ? '' : 's'} ({fmtMB(stats.mainBytes)})
              {' · '}
              {stats.subagentFiles} subagent transcript{stats.subagentFiles === 1 ? '' : 's'} ({fmtMB(stats.subagentBytes)})
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-primary">Keep modified within last</span>
            <span className="text-[13px] text-accent font-mono font-semibold">{retentionDays} days</span>
          </div>
          <input
            type="range" min={1} max={90} value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full accent-accent cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-text-muted/60 font-mono mt-1">
            <span>1d</span><span>15d</span><span>30d</span><span>60d</span><span>90d</span>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-text-primary">Will delete (older than {retentionDays}d)</span>
            <span className="text-[13px] text-status-warning font-mono font-semibold">
              {stats ? `${stats.staleFiles} files · ${fmtMB(stats.staleBytes)}` : '…'}
            </span>
          </div>
          {stats && stats.staleFiles > 0 && (
            <div className="text-[11px] text-text-muted/80 font-mono mt-1">
              {stats.staleMainFiles} main + {stats.staleSubagentFiles} subagent
            </div>
          )}
        </div>
        {lastResult && (
          <div className="px-4 py-2.5 border-b border-border bg-status-working/5">
            <div className="text-[12px] text-status-working font-mono">
              ✓ deleted {lastResult.deletedFiles} file{lastResult.deletedFiles === 1 ? '' : 's'} · {fmtMB(lastResult.deletedBytes)}
              {lastResult.removedDirs > 0 && ` · pruned ${lastResult.removedDirs} empty dir${lastResult.removedDirs === 1 ? '' : 's'}`}
              {lastResult.errors.length > 0 && ` · ${lastResult.errors.length} error${lastResult.errors.length === 1 ? '' : 's'}`}
            </div>
          </div>
        )}
        <div className="px-4 py-3 flex gap-2 items-center">
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-[13px] font-mono rounded-lg bg-bg-hover text-text-primary hover:bg-bg-hover/80 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
          >Refresh</button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={loading || !stats || stats.staleFiles === 0}
              className="ml-auto px-3 py-1.5 text-[13px] font-mono rounded-lg bg-status-error/10 border border-status-error/40 text-status-error hover:bg-status-error/20 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >Delete {stats?.staleFiles ?? 0} files</button>
          ) : (
            <>
              <button
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="ml-auto px-3 py-1.5 text-[13px] font-mono rounded-lg bg-bg-hover text-text-primary hover:bg-bg-hover/80 cursor-pointer transition-colors"
              >Cancel</button>
              <button
                onClick={onDelete}
                disabled={loading}
                className="px-3 py-1.5 text-[13px] font-mono rounded-lg bg-status-error text-white hover:bg-status-error/90 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
              >{loading ? 'Deleting…' : 'Confirm delete'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
