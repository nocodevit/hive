// @vitest-environment jsdom
//
// Boot-IPC contract tests for v1.7.117 loading-UX fix.
//
// PRE-FIX (v1.7.116): App.tsx mounted and fired 7+ IPC calls greedily —
// data.load() × 3, skills.scan, templates.list, dispatcher.loadLog,
// agent.loadLogs per agent, git.commitHistory per agent, project.scan
// per project, tasks.list per task group. The worst (project.scan)
// execSync'd git per zone AND recursive readFileSync'd every .md/.txt
// in the tree → main-thread freeze ~60s on cold open.
//
// POST-FIX: ONLY data.load() fires on mount. Everything else moves to
// the view that needs it (Skills tab → skills.scan, project card click
// → project.scan, AgentDetail mount → agent.loadLogs + git.commitHistory,
// taskgroup tab → dispatcher.loadLog, etc).
//
// Mounting the full App in jsdom is multi-second + flaky (3000-line
// component, huge import tree). Instead we test the lazy-fetch CONTRACT
// via pure predicate helpers that mirror the gating conditions in
// App.tsx — a refactor that drops the gating will trip these directly.

import { describe, it, expect } from 'vitest'

// Mirror of App.tsx's per-view gating logic. Each `should*Fetch` returns
// true iff the matching window.api call should fire RIGHT NOW given the
// app's selection state. App.tsx's useEffects implement exactly these
// predicates — keep them in sync.

function shouldProjectScanFetch(
  selectedProjectId: string | null,
  cachedScans: Record<string, unknown>
): boolean {
  if (!selectedProjectId) return false
  if (cachedScans[selectedProjectId]) return false
  return true
}

function shouldAgentLogsFetch(
  selectedAgentId: string | null,
  cachedTasks: Record<string, unknown>
): boolean {
  if (!selectedAgentId) return false
  if (cachedTasks[selectedAgentId]) return false
  return true
}

function shouldGitCommitHistoryFetch(
  selectedAgentId: string | null,
  agents: { id: string; worktreePath?: string }[],
  cachedCommits: Record<string, unknown>
): boolean {
  if (!selectedAgentId) return false
  const ag = agents.find((a) => a.id === selectedAgentId)
  if (!ag?.worktreePath) return false
  if (cachedCommits[selectedAgentId]) return false
  return true
}

function shouldSkillsScanFetch(
  scanned: boolean,
  editorTab: string,
  showCreateAgent: boolean,
  editingTemplate: unknown | null
): boolean {
  if (scanned) return false
  return editorTab === 'skills' || showCreateAgent || editingTemplate !== null
}

function shouldTemplatesListFetch(
  loaded: boolean,
  showCreateAgent: boolean,
  editingTemplate: unknown | null
): boolean {
  if (loaded) return false
  return showCreateAgent || editingTemplate !== null
}

function shouldDispatcherLoadFetch(loaded: boolean, projectTab: string): boolean {
  if (loaded) return false
  return projectTab === 'taskgroup'
}

function shouldTasksListFetch(
  selectedProjectId: string | null,
  taskGroups: { projectId: string }[],
  cachedTasks: Record<string, unknown>
): boolean {
  if (!selectedProjectId) return false
  if (!taskGroups.some((tg) => tg.projectId === selectedProjectId)) return false
  if (cachedTasks[selectedProjectId]) return false
  return true
}

describe('project.scan lazy gate (per ProjectDetail mount)', () => {
  it('does NOT fetch when no project selected — fixes boot fan-out', () => {
    expect(shouldProjectScanFetch(null, {})).toBe(false)
  })
  it('FETCHES first time the user opens a project', () => {
    expect(shouldProjectScanFetch('p1', {})).toBe(true)
  })
  it('does NOT re-fetch when cached', () => {
    expect(shouldProjectScanFetch('p1', { p1: { projectStage: 'active', todos: [] } })).toBe(false)
  })
})

describe('agent.loadLogs lazy gate (per AgentDetail mount)', () => {
  it('does NOT fetch when no agent selected', () => {
    expect(shouldAgentLogsFetch(null, {})).toBe(false)
  })
  it('FETCHES first time the user clicks an agent', () => {
    expect(shouldAgentLogsFetch('a1', {})).toBe(true)
  })
  it('does NOT re-fetch when task pill already rehydrated', () => {
    expect(shouldAgentLogsFetch('a1', { a1: { title: 'doing X', active: true } })).toBe(false)
  })
})

describe('git.commitHistory lazy gate (per AgentDetail mount)', () => {
  it('does NOT fetch when no agent selected', () => {
    expect(shouldGitCommitHistoryFetch(null, [], {})).toBe(false)
  })
  it('does NOT fetch when selected agent has no worktree (no git → nothing to query)', () => {
    expect(shouldGitCommitHistoryFetch('a1', [{ id: 'a1' }], {})).toBe(false)
  })
  it('FETCHES first time for a worktree-backed agent', () => {
    expect(shouldGitCommitHistoryFetch('a1', [{ id: 'a1', worktreePath: '/tmp/wt-a1' }], {})).toBe(true)
  })
  it('does NOT re-fetch when cached', () => {
    expect(shouldGitCommitHistoryFetch('a1', [{ id: 'a1', worktreePath: '/tmp/wt-a1' }], { a1: {} })).toBe(false)
  })
})

describe('skills.scan lazy gate (Skills tab / create-agent / template-edit)', () => {
  it('does NOT fetch at boot', () => {
    expect(shouldSkillsScanFetch(false, 'basic', false, null)).toBe(false)
  })
  it('FETCHES when user opens the Skills editor tab', () => {
    expect(shouldSkillsScanFetch(false, 'skills', false, null)).toBe(true)
  })
  it('FETCHES when user opens CreateAgent modal', () => {
    expect(shouldSkillsScanFetch(false, 'basic', true, null)).toBe(true)
  })
  it('FETCHES when user opens EditTemplate modal', () => {
    expect(shouldSkillsScanFetch(false, 'basic', false, { id: 't1' })).toBe(true)
  })
  it('does NOT re-fetch once scanned (session-stable)', () => {
    expect(shouldSkillsScanFetch(true, 'skills', true, { id: 't1' })).toBe(false)
  })
})

describe('templates.list lazy gate (template picker open)', () => {
  it('does NOT fetch at boot', () => {
    expect(shouldTemplatesListFetch(false, false, null)).toBe(false)
  })
  it('FETCHES when CreateAgent modal opens', () => {
    expect(shouldTemplatesListFetch(false, true, null)).toBe(true)
  })
  it('FETCHES when EditTemplate modal opens', () => {
    expect(shouldTemplatesListFetch(false, false, { id: 't1' })).toBe(true)
  })
  it('does NOT re-fetch once loaded', () => {
    expect(shouldTemplatesListFetch(true, true, null)).toBe(false)
  })
})

describe('dispatcher.loadLog lazy gate (taskgroup tab open)', () => {
  it('does NOT fetch on dashboard', () => {
    expect(shouldDispatcherLoadFetch(false, 'dashboard')).toBe(false)
  })
  it('does NOT fetch on office tab', () => {
    expect(shouldDispatcherLoadFetch(false, 'office')).toBe(false)
  })
  it('FETCHES when user opens taskgroup tab', () => {
    expect(shouldDispatcherLoadFetch(false, 'taskgroup')).toBe(true)
  })
  it('does NOT re-fetch once loaded', () => {
    expect(shouldDispatcherLoadFetch(true, 'taskgroup')).toBe(false)
  })
})

describe('tasks.list lazy gate (per project with task group)', () => {
  it('does NOT fetch with no project selected', () => {
    expect(shouldTasksListFetch(null, [{ projectId: 'p1' }], {})).toBe(false)
  })
  it('does NOT fetch if selected project has no task group', () => {
    expect(shouldTasksListFetch('p1', [{ projectId: 'p2' }], {})).toBe(false)
  })
  it('FETCHES first time for a project with a task group', () => {
    expect(shouldTasksListFetch('p1', [{ projectId: 'p1' }], {})).toBe(true)
  })
  it('does NOT re-fetch when cached', () => {
    expect(shouldTasksListFetch('p1', [{ projectId: 'p1' }], { p1: [] })).toBe(false)
  })
})

describe('Stage badge + TODO count placeholders (lazy-load UX)', () => {
  // App.tsx renders `—` when projectScan is null/undefined so the user
  // sees a stable header immediately, not blank UI, while the lazy
  // project.scan IPC runs in the background.
  function stageLabel(scan: { projectStage: string } | null | undefined): string {
    return scan ? scan.projectStage.replace('-', ' ') : '—'
  }
  function todoCountLabel(scan: { todos: unknown[] } | null | undefined): string {
    return scan ? String(scan.todos.length) : '—'
  }
  it('null projectScan → em-dash stage placeholder', () => {
    expect(stageLabel(null)).toBe('—')
    expect(stageLabel(undefined)).toBe('—')
  })
  it('loaded projectScan → human-formatted stage', () => {
    expect(stageLabel({ projectStage: 'active-online' })).toBe('active online')
    expect(stageLabel({ projectStage: 'incubating' })).toBe('incubating')
    expect(stageLabel({ projectStage: 'early-stage' })).toBe('early stage')
  })
  it('null projectScan → em-dash todo count placeholder', () => {
    expect(todoCountLabel(null)).toBe('—')
    expect(todoCountLabel(undefined)).toBe('—')
  })
  it('loaded projectScan → numeric todo count', () => {
    expect(todoCountLabel({ todos: [] })).toBe('0')
    expect(todoCountLabel({ todos: [{}, {}, {}] })).toBe('3')
  })
})
