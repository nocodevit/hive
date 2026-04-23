// Pure helper functions extracted from index.ts for testability

export interface AgentData {
  id: string
  projectId: string
  zoneId: string
  worktreePath?: string
  taskGroupRole?: string
}

export interface TaskGroupData {
  id: string
  projectId: string
  managerId: string
  workerIds: string[]
  qaId: string
  criticId: string
  maxGateRetries?: number
  maxQaLoops?: number
  dailyReportEnabled?: boolean
  targetBranch?: string
}

export interface ProjectData {
  id: string
  zones: { id: string; path: string }[]
}

// Find the task group that contains this agent (any role)
export function findTaskGroupForAgentInData(
  agentId: string,
  taskGroups: TaskGroupData[]
): { taskGroup: TaskGroupData; projectId: string } | null {
  for (const tg of taskGroups) {
    if (
      tg.managerId === agentId ||
      tg.qaId === agentId ||
      tg.criticId === agentId ||
      tg.workerIds?.includes(agentId)
    ) {
      return { taskGroup: tg, projectId: tg.projectId }
    }
  }
  return null
}

// Find the working directory for an agent (worktree or zone path)
export function findAgentCwd(
  agentId: string,
  agents: AgentData[],
  projects: ProjectData[]
): string | null {
  const agent = agents.find(a => a.id === agentId)
  if (!agent) return null
  if (agent.worktreePath) return agent.worktreePath
  const project = projects.find(p => p.id === agent.projectId)
  const zone = project?.zones?.find(z => z.id === agent.zoneId)
  return zone?.path || null
}

// Format a [HIVE:TYPE] message for PTY injection
export function formatHiveMessage(type: string, payload: object): string {
  const msg = JSON.stringify({ type, ...payload })
  return `[HIVE:${type.toUpperCase()}] ${msg}\r`
}
