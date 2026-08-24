// OverviewPage — v2.6.0 app-level dashboard across ALL projects/agents.
//
// Motivation: previously the only "dashboard" was per-project (task-group
// stats). Users regularly run 7–8 parallel agents across several projects
// and had no place to see everything at once, nor a fast way to kill idle
// sessions that were hoarding memory.
//
// Sections (top→bottom, Sentry-inspired dense-with-air spacing):
//   1) KPI row — Projects · Agents · Open sessions · Handoffs running
//   2) Working now — agents currently in status='working'
//   3) Open sessions — agents with a mounted chat pane; per-row Close button
//   4) Sleeping agents — no mounted session; per-row Open action
//   5) Projects grid — one card per project with a live agent-status breakdown
//
// This file intentionally holds all the composition logic inline (as opposed
// to splitting into 5 tiny sub-files) so the dashboard is easy to follow
// end-to-end when we iterate on the design.

import { useMemo } from 'react'
import type { Project, Agent } from '../types'
import { AvatarPreview } from './AvatarEditor'

interface OverviewPageProps {
  projects: Project[]
  agents: Agent[]
  activeTerminals: Set<string>
  activeHandoffAgentIds: Set<string>
  agentTasks: Record<string, { title?: string; summary?: string; active: boolean }>
  onOpenAgent: (agent: Agent) => void
  onCloseSession: (agentId: string) => void | Promise<void>
  /// v2.7.0: click a project card header → jump to that project's office
  /// view. Previously the whole project card was inert; only per-avatar
  /// clicks worked, which the user (correctly) flagged.
  onSwitchProject: (projectId: string) => void
}

export function OverviewPage(props: OverviewPageProps) {
  const {
    projects, agents, activeTerminals, activeHandoffAgentIds,
    agentTasks, onOpenAgent, onCloseSession, onSwitchProject,
  } = props

  // ---------- derived ----------

  const workingAgents = useMemo(
    () => agents.filter((a) => a.status === 'working'),
    [agents]
  )

  const openSessionAgents = useMemo(
    () => agents.filter((a) => activeTerminals.has(a.id)),
    [agents, activeTerminals]
  )

  const sleepingAgents = useMemo(
    () => agents.filter((a) => !activeTerminals.has(a.id)),
    [agents, activeTerminals]
  )

  const handoffRunning = activeHandoffAgentIds.size
  const projectCount = projects.length
  const activeProjectCount = useMemo(() => {
    const set = new Set<string>()
    openSessionAgents.forEach((a) => set.add(a.projectId))
    return set.size
  }, [openSessionAgents])

  return (
    // v2.8.0 fix: parent is `fixed top-0 right-0 bottom-0` (no flex context),
    // so `flex-1` did nothing and `overflow-y-auto` had no height to scroll
    // against. h-full activates the fixed parent's inherited height and
    // makes the scroll container behave.
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-[1400px] mx-auto p-8 space-y-8">
        {/* Title + subtitle */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold text-text-primary">Overview</h1>
            <p className="text-[13px] text-text-muted mt-1">
              Everything running across all your projects. Close what you no longer need.
            </p>
          </div>
          <LivePulse />
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="Projects"
            value={projectCount}
            sub={`${activeProjectCount} active`}
          />
          <KpiCard
            label="Agents"
            value={agents.length}
            sub={`${workingAgents.length} working now`}
            emphasis={workingAgents.length > 0 ? 'accent' : undefined}
          />
          <KpiCard
            label="Session panes"
            value={openSessionAgents.length}
            sub={`${sleepingAgents.length} closed`}
          />
          <KpiCard
            label="Handoffs running"
            value={handoffRunning}
            sub={handoffRunning > 0 ? 'auto /goal in flight' : 'none'}
            emphasis={handoffRunning > 0 ? 'accent' : undefined}
          />
        </div>

        {/* Working now + Open sessions */}
        <div className="grid grid-cols-2 gap-6">
          <WorkingNowSection
            workingAgents={workingAgents}
            agentTasks={agentTasks}
            projects={projects}
            activeHandoffAgentIds={activeHandoffAgentIds}
            onOpenAgent={onOpenAgent}
          />
          <OpenSessionsSection
            openSessionAgents={openSessionAgents}
            workingAgents={workingAgents}
            allAgents={agents}
            projects={projects}
            activeHandoffAgentIds={activeHandoffAgentIds}
            onOpenAgent={onOpenAgent}
            onCloseSession={onCloseSession}
          />
        </div>

        {/* Sleeping */}
        <SleepingAgentsSection
          sleepingAgents={sleepingAgents}
          projects={projects}
          onOpenAgent={onOpenAgent}
        />

        {/* Projects grid */}
        <ProjectsGrid
          projects={projects}
          agents={agents}
          activeTerminals={activeTerminals}
          onOpenAgent={onOpenAgent}
          onSwitchProject={onSwitchProject}
        />
      </div>
    </div>
  )
}

// ============================================================
// KPI card + live pulse
// ============================================================

function KpiCard({
  label, value, sub, emphasis,
}: {
  label: string
  value: number
  sub: string
  emphasis?: 'accent'
}) {
  return (
    <div className="rounded-2xl bg-bg-secondary border border-border p-5">
      <div className="text-[11px] font-heading font-semibold uppercase tracking-widest text-text-muted mb-2">
        {label}
      </div>
      <div className={`text-3xl font-heading font-bold tabular-nums ${
        emphasis === 'accent' ? 'text-accent' : 'text-text-primary'
      }`}>
        {value}
      </div>
      <div className="text-[13px] text-text-muted mt-1">{sub}</div>
    </div>
  )
}

function LivePulse() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-text-muted">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-working opacity-70" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-status-working" />
      </span>
      Live · updates every second
    </div>
  )
}

// ============================================================
// Working now
// ============================================================

function WorkingNowSection({
  workingAgents, agentTasks, projects, activeHandoffAgentIds, onOpenAgent,
}: {
  workingAgents: Agent[]
  agentTasks: Record<string, { title?: string; summary?: string; active: boolean }>
  projects: Project[]
  activeHandoffAgentIds: Set<string>
  onOpenAgent: (agent: Agent) => void
}) {
  return (
    <SectionCard title="Working now" count={workingAgents.length}>
      {workingAgents.length === 0 ? (
        <EmptyState line="No agents are running a turn right now." />
      ) : (
        <div className="space-y-2">
          {/* v2.8.3: sorted project-then-agent for stable scan order,
              matches the Loaded / Closed sections downstream. */}
          {[...workingAgents]
            .sort((a, b) => {
              const pa = projects.find((p) => p.id === a.projectId)?.name || ''
              const pb = projects.find((p) => p.id === b.projectId)?.name || ''
              const byProj = pa.localeCompare(pb)
              return byProj !== 0 ? byProj : a.name.localeCompare(b.name)
            })
            .map((agent) => {
            const proj = projects.find((p) => p.id === agent.projectId)
            const task = agentTasks[agent.id]
            const currentTitle = task?.active ? task.title : null
            return (
              <button
                key={agent.id}
                onClick={() => onOpenAgent(agent)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-bg-primary border border-border
                  hover:bg-bg-hover transition-colors cursor-pointer text-left"
              >
                <AvatarPreview
                  config={agent.avatar}
                  size={32}
                  loopBusy={activeHandoffAgentIds.has(agent.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-heading font-semibold text-text-primary truncate">
                      {agent.name}
                    </span>
                    {proj && (
                      <span className="text-[11px] text-text-muted uppercase tracking-wider">
                        {proj.name}
                      </span>
                    )}
                  </div>
                  {currentTitle && (
                    <div className="text-[13px] text-accent truncate mt-0.5">{currentTitle}</div>
                  )}
                </div>
                <StatusPill status="working" />
              </button>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ============================================================
// Open sessions (with Close button)
// ============================================================

function OpenSessionsSection({
  openSessionAgents, workingAgents, allAgents, projects, activeHandoffAgentIds, onOpenAgent, onCloseSession,
}: {
  openSessionAgents: Agent[]
  workingAgents: Agent[]
  allAgents: Agent[]
  projects: Project[]
  activeHandoffAgentIds: Set<string>
  onOpenAgent: (agent: Agent) => void
  onCloseSession: (agentId: string) => void | Promise<void>
}) {
  const workingSet = new Set(workingAgents.map((a) => a.id))
  // v2.8.3: pure alphabetical sort. Projects A-Z, agents A-Z inside
  // each project. Working state shows as a "Working" pill on the row
  // — no need to bubble those to the top and break the sort. Users
  // asked for stable, scannable, predictable order.
  const byProject = new Map<string, Agent[]>()
  for (const a of openSessionAgents) {
    if (!byProject.has(a.projectId)) byProject.set(a.projectId, [])
    byProject.get(a.projectId)!.push(a)
  }
  const projectGroups = Array.from(byProject.entries())
    .map(([pid, list]) => ({
      project: projects.find((p) => p.id === pid),
      list: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((A, B) => (A.project?.name || '').localeCompare(B.project?.name || ''))
  return (
    <SectionCard
      title="Loaded session panes"
      count={openSessionAgents.length}
      action={
        openSessionAgents.length > 1 && (
          <CloseAllIdleButton
            openAgents={openSessionAgents}
            workingSet={workingSet}
            allAgents={allAgents}
            onCloseSession={onCloseSession}
          />
        )
      }
    >
      {openSessionAgents.length === 0 ? (
        <EmptyState line="No chat sessions are open. Open an agent to start one." />
      ) : (
        <div className="space-y-4">
          {projectGroups.map(({ project, list }) => (
            <div key={project?.id || 'unknown'} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1 pb-1 border-b border-border-subtle">
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-[0.16em]">
                  {project?.name || 'Unknown project'}
                </span>
                <span className="text-[10px] font-mono tabular-nums text-text-muted/70">·</span>
                <span className="text-[10px] font-mono tabular-nums text-text-muted">
                  {list.length}
                </span>
              </div>
              {list.map((agent) => {
                const isWorking = workingSet.has(agent.id)
                const inHandoff = activeHandoffAgentIds.has(agent.id)
                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-bg-primary border border-border"
                  >
                    <AvatarPreview config={agent.avatar} size={24} loopBusy={inHandoff} />
                    <button
                      onClick={() => onOpenAgent(agent)}
                      className="flex-1 min-w-0 text-left text-sm font-heading font-semibold text-text-primary hover:text-accent truncate cursor-pointer"
                    >
                      {agent.name}
                    </button>
                    <StatusPill status={isWorking ? 'working' : 'idle'} />
                    {!isWorking && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Close ${agent.name}'s Claude session?`)) {
                            onCloseSession(agent.id)
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg text-[12px] font-medium
                          bg-bg-hover text-text-muted hover:bg-status-danger/15 hover:text-status-danger
                          transition-colors cursor-pointer"
                        title="Close this Claude session and free its memory"
                      >
                        Close
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function CloseAllIdleButton({
  openAgents, workingSet, onCloseSession, allAgents,
}: {
  openAgents: Agent[]
  workingSet: Set<string>
  onCloseSession: (agentId: string) => void | Promise<void>
  allAgents: Agent[]  // full latest list — used to re-verify status at click time
}) {
  const idleCount = openAgents.filter((a) => !workingSet.has(a.id)).length
  if (idleCount === 0) return null
  return (
    <button
      onClick={() => {
        // v2.6.0 fix: re-derive the idle set from the *current* agent list
        // at click time, not from the workingSet captured at render. Between
        // render and click a queued task can flip an agent to status='working';
        // firing onCloseSession on it would kill an in-flight Claude turn.
        const freshWorking = new Set(allAgents.filter((a) => a.status === 'working').map((a) => a.id))
        const toClose = openAgents.filter((a) => !freshWorking.has(a.id))
        if (toClose.length === 0) return
        if (window.confirm(`Close ${toClose.length} ready session pane${toClose.length > 1 ? 's' : ''}? Working sessions (currently running a turn) will be kept.`)) {
          toClose.forEach((a) => onCloseSession(a.id))
        }
      }}
      className="px-2.5 py-1 rounded-lg text-[12px] font-medium
        bg-bg-hover text-text-muted hover:bg-status-danger/15 hover:text-status-danger
        transition-colors cursor-pointer"
    >
      Close {idleCount} ready
    </button>
  )
}

// ============================================================
// Sleeping agents
// ============================================================

function SleepingAgentsSection({
  sleepingAgents, projects, onOpenAgent,
}: {
  sleepingAgents: Agent[]
  projects: Project[]
  onOpenAgent: (agent: Agent) => void
}) {
  // v2.8.2: group closed agents by project so scanning is possible
  // when a user has 5+ projects. Alphabetical project order.
  const byProject = new Map<string, Agent[]>()
  for (const a of sleepingAgents) {
    if (!byProject.has(a.projectId)) byProject.set(a.projectId, [])
    byProject.get(a.projectId)!.push(a)
  }
  const projectGroups = Array.from(byProject.entries())
    .map(([pid, list]) => ({
      project: projects.find((p) => p.id === pid),
      list: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((A, B) => (A.project?.name || '').localeCompare(B.project?.name || ''))

  return (
    <SectionCard title="Closed" count={sleepingAgents.length}>
      {sleepingAgents.length === 0 ? (
        <EmptyState line="Every agent has a session open." />
      ) : (
        <div className="space-y-4">
          {projectGroups.map(({ project, list }) => (
            <div key={project?.id || 'unknown'}>
              <div className="flex items-center gap-2 px-1 pb-2 mb-2 border-b border-border-subtle">
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-[0.16em]">
                  {project?.name || 'Unknown project'}
                </span>
                <span className="text-[10px] font-mono tabular-nums text-text-muted/70">·</span>
                <span className="text-[10px] font-mono tabular-nums text-text-muted">
                  {list.length}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {list.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => onOpenAgent(agent)}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-bg-primary border border-border
                      hover:border-accent hover:bg-bg-hover transition-colors cursor-pointer text-left"
                  >
                    <AvatarPreview config={agent.avatar} size={24} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-heading font-semibold text-text-primary truncate">
                        {agent.name}
                      </div>
                      {agent.role && (
                        <div className="text-[10px] text-text-muted uppercase tracking-wider truncate">
                          {agent.role}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ============================================================
// Projects grid
// ============================================================

function ProjectsGrid({
  projects, agents, activeTerminals, onOpenAgent, onSwitchProject,
}: {
  projects: Project[]
  agents: Agent[]
  activeTerminals: Set<string>
  onOpenAgent: (agent: Agent) => void
  onSwitchProject: (projectId: string) => void
}) {
  return (
    <SectionCard title="Projects" count={projects.length}>
      {projects.length === 0 ? (
        <EmptyState line="No projects yet. Add one from the sidebar." />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {/* v2.8.3: alphabetical for stable order across launches. */}
          {[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
            const projAgents = agents.filter((a) => a.projectId === p.id)
            const working = projAgents.filter((a) => a.status === 'working').length
            const openCount = projAgents.filter((a) => activeTerminals.has(a.id)).length
            return (
              <div key={p.id} className="rounded-xl bg-bg-primary border border-border p-4 hover:border-accent-muted transition-colors">
                <button
                  onClick={() => onSwitchProject(p.id)}
                  className="w-full flex items-center gap-2 mb-3 cursor-pointer text-left"
                  title={`Open ${p.name}`}
                >
                  <div className="w-1 h-6 rounded bg-accent" />
                  <span className="text-sm font-heading font-bold text-text-primary truncate hover:text-accent transition-colors">
                    {p.name}
                  </span>
                  <span className="ml-auto text-[13px] text-text-muted tabular-nums">
                    {projAgents.length}
                  </span>
                </button>
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span><span className="text-status-working font-semibold">{working}</span> working</span>
                  <span>·</span>
                  <span><span className="text-text-primary font-semibold">{openCount}</span> open</span>
                </div>
                {projAgents.length > 0 && (
                  <div className="flex -space-x-2 mt-3">
                    {projAgents.slice(0, 6).map((a) => (
                      <button
                        key={a.id}
                        onClick={() => onOpenAgent(a)}
                        className="ring-2 ring-bg-primary rounded-full hover:scale-110 transition-transform cursor-pointer"
                        title={a.name}
                      >
                        <AvatarPreview config={a.avatar} size={24} />
                      </button>
                    ))}
                    {projAgents.length > 6 && (
                      <div className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center
                        text-[10px] font-semibold text-text-muted ring-2 ring-bg-primary">
                        +{projAgents.length - 6}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ============================================================
// Shared small primitives
// ============================================================

function SectionCard({
  title, count, children, action,
}: {
  title: string
  count: number
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl bg-bg-secondary border border-border overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-heading font-bold text-text-primary">{title}</h2>
          <span className="text-[11px] font-semibold text-text-muted tabular-nums bg-bg-hover px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function EmptyState({ line }: { line: string }) {
  return (
    <div className="text-[13px] text-text-muted text-center py-6">{line}</div>
  )
}

function StatusPill({ status }: { status: 'working' | 'idle' }) {
  if (status === 'working') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-status-working/15 text-status-working text-[11px] font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-status-working animate-pulse" />
        Working
      </span>
    )
  }
  // v2.8.1: "Idle" → "Ready" — the session pane is loaded and Claude is
  // waiting for input, not abandoned. Idle read as "you should probably
  // close this" which caused confusion when Hive auto-mounts panes on launch.
  return (
    <span className="px-2 py-1 rounded-full bg-bg-hover text-text-muted text-[11px] font-semibold">
      Ready
    </span>
  )
}
