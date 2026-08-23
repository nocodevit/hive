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
}

export function OverviewPage(props: OverviewPageProps) {
  const {
    projects, agents, activeTerminals, activeHandoffAgentIds,
    agentTasks, onOpenAgent, onCloseSession,
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
    <div className="flex-1 overflow-y-auto bg-bg-primary">
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
            label="Open sessions"
            value={openSessionAgents.length}
            sub={`${sleepingAgents.length} sleeping`}
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
          {workingAgents.map((agent) => {
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
  // Sort: idle (not working) first (they're the killable candidates), then working.
  const sorted = [...openSessionAgents].sort((a, b) => {
    const aw = workingSet.has(a.id) ? 1 : 0
    const bw = workingSet.has(b.id) ? 1 : 0
    return aw - bw
  })
  return (
    <SectionCard
      title="Open sessions"
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
        <div className="space-y-2">
          {sorted.map((agent) => {
            const proj = projects.find((p) => p.id === agent.projectId)
            const isWorking = workingSet.has(agent.id)
            const inHandoff = activeHandoffAgentIds.has(agent.id)
            return (
              <div
                key={agent.id}
                className="flex items-center gap-3 p-3 rounded-xl bg-bg-primary border border-border"
              >
                <AvatarPreview config={agent.avatar} size={28} loopBusy={inHandoff} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenAgent(agent)}
                      className="text-sm font-heading font-semibold text-text-primary hover:text-accent truncate cursor-pointer"
                    >
                      {agent.name}
                    </button>
                    {proj && (
                      <span className="text-[11px] text-text-muted uppercase tracking-wider">
                        {proj.name}
                      </span>
                    )}
                  </div>
                </div>
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
        if (window.confirm(`Close ${toClose.length} idle Claude session${toClose.length > 1 ? 's' : ''}? Working sessions will be kept.`)) {
          toClose.forEach((a) => onCloseSession(a.id))
        }
      }}
      className="px-2.5 py-1 rounded-lg text-[12px] font-medium
        bg-bg-hover text-text-muted hover:bg-status-danger/15 hover:text-status-danger
        transition-colors cursor-pointer"
    >
      Close {idleCount} idle
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
  return (
    <SectionCard title="Sleeping agents" count={sleepingAgents.length}>
      {sleepingAgents.length === 0 ? (
        <EmptyState line="All agents have an active session." />
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {sleepingAgents.map((agent) => {
            const proj = projects.find((p) => p.id === agent.projectId)
            return (
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
                  {proj && (
                    <div className="text-[10px] text-text-muted uppercase tracking-wider truncate">
                      {proj.name}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ============================================================
// Projects grid
// ============================================================

function ProjectsGrid({
  projects, agents, activeTerminals, onOpenAgent,
}: {
  projects: Project[]
  agents: Agent[]
  activeTerminals: Set<string>
  onOpenAgent: (agent: Agent) => void
}) {
  return (
    <SectionCard title="Projects" count={projects.length}>
      {projects.length === 0 ? (
        <EmptyState line="No projects yet. Add one from the sidebar." />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {projects.map((p) => {
            const projAgents = agents.filter((a) => a.projectId === p.id)
            const working = projAgents.filter((a) => a.status === 'working').length
            const openCount = projAgents.filter((a) => activeTerminals.has(a.id)).length
            return (
              <div key={p.id} className="rounded-xl bg-bg-primary border border-border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-6 rounded bg-accent" />
                  <span className="text-sm font-heading font-bold text-text-primary truncate">
                    {p.name}
                  </span>
                  <span className="ml-auto text-[13px] text-text-muted tabular-nums">
                    {projAgents.length}
                  </span>
                </div>
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
  return (
    <span className="px-2 py-1 rounded-full bg-bg-hover text-text-muted text-[11px] font-semibold">
      Idle
    </span>
  )
}
