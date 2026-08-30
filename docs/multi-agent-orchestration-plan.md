# Multi-Agent Orchestration Plan

**Date:** 2026-04-02
**Revision:** v5 — final, all details locked
**Status:** Approved for implementation
**Estimated effort:** ~15-18 hours continuous, 3-4 sessions

---

## 1. Summary

Hive gains a **batch-driven multi-agent orchestration system**. A Manager agent reads `todo.md` (contract format with machine-verifiable `verify` checklists), proposes batches of independent tasks, and assigns them to Worker agents after human approval. Workers execute in isolated worktrees, self-test, and push. An automated Gate (Hive main process, zero token cost) validates each push against the contract. After all batch tasks pass, a QA agent runs integration tests and produces a mandatory test report. A Critic agent (delivery agent) rebases, independently re-verifies, performs adversarial PR review, creates the PR, and pushes. Human merges via Hive UI.

### Key Design Principles

| Principle | Source |
|---|---|
| Agents are stateless per task (`/clear` between tasks) | Anthropic 16-agent C compiler |
| Quality from harness, not agent judgment | Anthropic 16-agent + Sprint Contract |
| All communication through Hive (PTY injection) | Original design |
| Batch = zero internal dependencies | Original design |
| Contract verify = machine-verifiable acceptance | Sprint Contract pattern |
| Human controls batch rhythm (v1) | Original design |

### Storage

All orchestration data in global `~/.hive/`, accessible from any worktree:

```
~/.hive/
  data.json                          ← projects + agents + TaskGroup (existing)
  logs/{agentId}.json                ← worklog (existing)
  souls/{agentId}.md                 ← soul backup (existing)
  comms/{projectId}/
    tasks/
      task-001.json                  ← task files (new)
      task-002.json
    reports/
      batch-1-qa.md                  ← QA test reports (new)
```

**Not in project repo.** Workers are in different worktrees; `~/.hive/` is the only shared absolute path. Agents never touch these files directly — always via `hive-report.sh` → HTTP → Hive main process.

**todo.md** lives in the project repo. Manager reads it from the configured path (default: `docs/todo.md`).

---

## 2. Roles & Workflow

### Roles

| Role | Count | Badge | Color | Responsibility |
|---|---|---|---|---|
| **Human** | 1 | — | — | Writes todo.md, approves batches, merges PRs, intervenes anytime |
| **Manager** | 1 | ♛ crown | #F59E0B gold | Reads todo.md → batches → assigns → monitors → triggers QA/Critic → reports |
| **Worker** | 1–N | ⚒ hammer | #3B82F6 blue | Receives task → codes → build/test → commit/push → Gate → lessons → /clear |
| **QA** | 1 | 🛡 shield | #10B981 green | Integration test → coverage → contract verify → produces test report |
| **Critic** | 1 | 👁 eye | #8B5CF6 purple | Rebase → gate → require report → adversarial review → create PR → push |

### Task Group

```typescript
interface TaskGroup {
  id: string
  projectId: string
  status: 'idle' | 'batch_proposed' | 'batch_approved' | 'executing'
         | 'qa' | 'critic' | 'awaiting_merge'
  managerId: string
  workerIds: string[]
  qaId: string
  criticId: string
  currentBatch: number
  todoSource: string        // relative path, default 'docs/todo.md'
  maxGateRetries: number    // default 3
}

// Added to existing Agent interface
interface Agent {
  // ... all existing fields unchanged
  taskGroupRole?: 'manager' | 'worker' | 'qa' | 'critic'
}
```

One task group per project. Minimum 4 agents. Created via UI or during `/manager-whip-start`.

### Batch Lifecycle

```
Phase 1: PROPOSE
  Manager reads todo.md → groups by dependency → proposes batch
  → hive-report.sh batch-propose → Hive UI shows proposal
  → Human approves / edits / rejects

Phase 2: EXECUTE (parallel)
  Manager assigns tasks → Workers execute in worktrees
  → Worker: code → build/test → commit → push → Gate auto-runs
  → Gate pass → task-done (writes worklog + updates task) → lessons → /clear → ready
  → Gate fail → worker gets failure detail → fix → re-push (max N retries)
  → N failures → task-blocked → notify manager

Phase 3: QA
  Manager merges worker branches → integration branch
  → QA: full test suite + coverage + all contract verify[]
  → QA produces test report: .hive/comms/{projectId}/reports/batch-N-qa.md
  → QA fail → Manager creates fix tasks → mini-batch → re-QA

Phase 4: CRITIC (delivery)
  → Critic: rebase → independent gate → require test report
  → adversarial review (uses /review skill) → create PR → push
  → Issues found → fix tasks → re-QA → re-Critic

Phase 5: MERGE
  Manager reports to human (macOS notification + Telegram + Hive UI)
  → Human reviews in Hive UI → [Merge & Next Batch] or [Reject]
  → gh pr merge --squash --delete-branch → back to Phase 1
```

### Worker Stateless Protocol

```
task done → gate pass
→ hive-report.sh task-done TASK_ID "summary"    ← writes worklog AND updates task status
→ wait for manager ack [HIVE:MSG] {"ack":"task-001"}
→ append to .claude/lessons.md (max 5 lines: gotchas, learnings)
→ hive-report.sh ready
→ /clear
→ [fresh context, soul preserved from file]
→ [HIVE:TASK] arrives = first message in clean context
```

What survives `/clear`:
- ✅ Soul (from agent definition file)
- ✅ Worklog (in `~/.hive/logs/`)
- ✅ Lessons (`.claude/lessons.md` in worktree)
- ✅ Code (in git)
- ✅ Task history (in `~/.hive/comms/` task JSONs)
- ❌ Conversation context (wiped — intentional)

### Blocked Flow

```
Worker: can't fix after 3 attempts
→ hive-report.sh task-blocked TASK_ID "reason"
→ HTTP POST /task-blocked
→ Hive main process:
    ① Update task JSON: status=blocked, blocked_reason="..."
    ② PTY inject Manager: [HIVE:MSG] {"task":"task-001","status":"blocked","reason":"..."}
    ③ Check: any batch task blocked? → update TaskGroup status indicator
    ④ Trigger notifications (all 3 channels)

Manager receives [HIVE:MSG]:
→ Decide: reassign to different worker? Or escalate?
→ hive-report.sh report-human "task-001 blocked: [reason]. Reassigning to worker-b / Need human input."

Hive receives report-human:
→ macOS: osascript display notification "..." with title "Hive" sound name "Glass"
→ Telegram: echo '...' | ~/.claude/hooks/notify-telegram.sh
→ UI: win.webContents.send('manager:report', data) → toast notification
```

---

## 3. Development Plan

### Existing components to reuse

| Component | Location | How |
|---|---|---|
| PTY write | `ipcMain.handle('pty:write')`, index.ts:250 | sendToAgent() wraps it |
| HTTP server | index.ts:61-109, port 17710 | Extend with new routes |
| hive-report.sh | utils.ts:154-181 | Extend with new commands |
| Agent definition | index.ts:112-175 | Inject role soul addendum |
| Worktree | index.ts git:worktreeAdd | Workers already use worktrees |
| Todo parser | utils.ts:17-84, parseTodoLine | Extend for contract metadata |
| Agent types | types.ts:21-41 | Add taskGroupRole |
| Status hooks | utils.ts:140-151 | Reuse working/waiting detection |
| Work logs | index.ts:33-49, appendLog | Reuse, link to task ID |
| Agent sidebar | App.tsx:410-460 | Add role badge overlay |
| Project tabs | App.tsx:684-890 | Restructure 3→4 tabs |
| Notification TODO | index.ts:92-96 | Implement macOS + Telegram |

### New components to build

| Component | Files | Complexity |
|---|---|---|
| TaskGroup type + persistence | types.ts, index.ts data handlers | Low |
| Contract parser | utils.ts | Low |
| Task file CRUD | new: main/tasks.ts | Medium |
| hive-report.sh extensions | utils.ts | Low |
| HTTP endpoints (8 new) | index.ts | Medium |
| sendToAgent() + IPC | index.ts, preload | Low |
| Gate runner | new: main/gate.ts | Medium |
| Soul addenda | new: main/souls.ts | Low |
| Manager skill | new: .claude/skills/manager-whip-start/ | Low |
| Dashboard tab (new) | App.tsx | Medium |
| Task Group tab + modal | App.tsx or new component | Medium |
| Role badges | App.tsx sidebar | Low |
| Notification impl | index.ts | Low |

---

## 4. Execution Steps

### Phase 0: Data Model + Contract Parser (~30 min)

```
0.1  types.ts: Add TaskGroup interface, TaskStatus type, Agent.taskGroupRole
0.2  utils.ts: Extend parseTodoLine → parseTodoContract:
     Parse sub-lines after `- [ ]`: depends, scope, verify[], acceptance
     Return: { text, done, depends: string[], scope: string, verify: string[], acceptance: string }
0.3  Tests: extend todo-parse.test.ts
     - Contract with all metadata fields
     - Contract with missing fields (defaults: depends=[], scope='.', verify=[], acceptance='')
     - Contract with multiple verify items
     - Malformed sub-lines (skip gracefully)
     - Mixed: some items with metadata, some without
0.4  data.json: TaskGroup added to save/load (empty array default for migration)
0.5  Build + test: npm run build && npm test — all green before proceeding
```

### Phase 1: Task File System (~45 min)

```
1.1  Create src/main/tasks.ts:
     const COMMS_DIR = join(app.getPath('home'), '.hive', 'comms')
     
     createTask(projectId, task): write task-NNN.json, auto-increment ID
     readTask(projectId, taskId): parse and return
     updateTask(projectId, taskId, updates): merge fields + write
     listTasks(projectId): read all, return array
     deleteTask(projectId, taskId): remove file
     
1.2  Task status: 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked'
1.3  fs.watch on comms dir → win.webContents.send('task:update', { projectId, tasks })
1.4  Tests: new tasks.test.ts
     - createTask writes valid JSON
     - readTask returns correct data
     - updateTask merges without losing fields
     - listTasks returns all tasks sorted by ID
     - Status transitions: pending → assigned → in_progress → done
     - Status transitions: in_progress → blocked
     - Auto-increment IDs: task-001, task-002, ...
     - Handles missing comms directory (auto-create)
1.5  Build + test: all green
```

### Phase 2: HTTP Endpoints + hive-report.sh (~1 hr)

```
2.1  Extend HTTP server in index.ts:
     POST /task-create    → tasks.createTask(), return { id }
     POST /task-assign    → tasks.updateTask(assigned, owner) + sendToAgent(worker, 'TASK')
     POST /task-done      → tasks.updateTask(done) + appendLog(worklog) + sendToAgent(manager, 'MSG')
     POST /task-blocked   → tasks.updateTask(blocked) + sendToAgent(manager, 'MSG') + notify
     GET  /task-status    → tasks.listTasks(), return JSON (stdout for agent)
     POST /ready          → sendToAgent(manager, 'MSG', { worker, status:'ready' })
     POST /report-human   → send to UI + macOS notification + Telegram
     POST /batch-propose  → send to UI as proposal card

2.2  Extend generateReportScript() in utils.ts:
     Add cases:
       task-create)  curl POST /task-create -d "$MSG"
       task-assign)  curl POST /task-assign -d '{"taskId":"$2","agentId":"$3"}'
       task-done)    curl POST /task-done -d '{"agentId":"$AGENT","taskId":"$2","summary":"$3"}'
       task-blocked) curl POST /task-blocked -d '{"agentId":"$AGENT","taskId":"$2","reason":"$3"}'
       task-status)  curl GET /task-status (output to stdout, not /dev/null)
       ready)        curl POST /ready -d '{"agentId":"$AGENT"}'
       report-human) curl POST /report-human -d '{"agentId":"$AGENT","message":"$MSG"}'
       batch-propose) curl POST /batch-propose -d "$MSG"

2.3  Implement notification in /report-human and /task-blocked handlers:
     macOS:    exec(osascript -e 'display notification "..." with title "Hive" sound name "Glass"')
     Telegram: exec(echo '...' | $HIVE_NOTIFY_SCRIPT) — opt-in via env var
     UI:       win.webContents.send('manager:report', data)

2.4  Tests: new endpoints.test.ts (mock HTTP requests)
     - POST /task-create returns { id }
     - POST /task-assign updates task + calls sendToAgent
     - POST /task-done writes worklog + updates task + notifies manager
     - POST /task-blocked updates task + triggers notification
     - GET /task-status returns JSON array
     - POST /report-human triggers all 3 notification channels
2.5  Build + test: all green
```

### Phase 3: PTY Injection Layer (~20 min)

```
3.1  index.ts — new function:
     function sendToAgent(agentId: string, type: string, payload: object): boolean {
       const term = terminals.get(agentId)
       if (!term) return false
       const msg = JSON.stringify({ type, ...payload })
       term.write(`[HIVE:${type.toUpperCase()}] ${msg}\r`)
       return true
     }

3.2  IPC handler:
     ipcMain.handle('agent:send', (_, { agentId, type, payload }) =>
       sendToAgent(agentId, type, payload))

3.3  Preload bridge:
     agent: { ..., send: (agentId, type, payload) =>
       ipcRenderer.invoke('agent:send', { agentId, type, payload }) }

3.4  preload/index.d.ts: add type for agent.send

3.5  Tests: new send-to-agent.test.ts
     - Writes correct [HIVE:TYPE] JSON format to PTY
     - Returns false if terminal not found
     - JSON payload is valid
     - \r appended (Enter key)
3.6  Build + test: all green
```

### Phase 4: Gate Runner (~1 hr)

```
4.1  Create src/main/gate.ts:
     interface GateResult {
       pass: boolean
       failures: { step: string, detail: string }[]
     }
     
     async function runGate(cwd: string, task: Task): Promise<GateResult>
       ① exec('npm run build', { cwd, timeout: 120000 })
       ② exec('npm test', { cwd, timeout: 120000 })
       ③ scope check: exec('git diff --name-only origin/main...HEAD', { cwd })
          filter files outside task.scope
       ④ contract verify: for each task.verify[] → exec(cmd, { cwd })
          collect failures
       Return { pass, failures }

4.2  Gate trigger: hook into /task-done endpoint
     When worker reports task-done:
       → run gate on worker's worktree
       → pass: proceed with status=done
       → fail: send gate failure to worker, increment attempt
       → attempt >= maxGateRetries: status=blocked

4.3  Tests: new gate.test.ts (mock child_process.exec)
     - All checks pass → { pass: true, failures: [] }
     - Build fails → correct failure detail
     - Test fails → correct failure detail
     - Scope violation → lists offending files
     - Verify command fails → lists failing command
     - Timeout handling
4.4  Build + test: all green
```

### Phase 5: Soul Addenda + Manager Skill (~30 min)

```
5.1  Create src/main/souls.ts:
     getManagerSoulAddendum(config: { todoSource: string }): string
     getWorkerSoulAddendum(config: { maxRetries: number }): string
     getQaSoulAddendum(): string
     getCriticSoulAddendum(): string
     
     Each returns markdown to APPEND to agent's existing soul.
     Content as defined in Section 2 above.

5.2  Modify writeAgentDefinition in index.ts:
     Accept optional taskGroupRole + config
     If role present → append corresponding soul addendum

5.3  Create .claude/skills/manager-whip-start/SKILL.md:
     Interactive startup:
       Todo file? [docs/todo.md] > (Enter = default)
       Max gate retries? [3] > (Enter = default)
     Then: parse todo.md → batch → propose → wait for approval

5.4  Tests: new souls.test.ts
     - Manager addendum contains batch proposal instructions
     - Worker addendum contains /clear protocol and [HIVE:TASK] recognition
     - QA addendum contains test report format
     - Critic addendum contains delivery protocol + /review reference
     - Addendum appended, not replacing original soul
     - Addendum removed on role clear
5.5  Build + test: all green
```

### Phase 6: UI (~3 hr)

```
6.1  Restructure project tabs: 3 → 4
     [Dashboard] [Office] [Task Group] [Settings]
     - Rename 'project' tab to 'dashboard'
     - Add 'taskgroup' tab
     - Update projectTab state type
     - Update existing tests for tab structure change

6.2  Dashboard tab (new content):
     - Summary: project name, description (from CLAUDE.md or README first paragraph)
     - Progress bar: done/total from scanDirForTodos (existing)
     - Task Group status card:
       active → batch N, X/Y done, phase indicator, role badges
       inactive → [+ Create Task Group] button
     - Work Zones (moved from old Project tab)

6.3  Office tab: unchanged, but agent kanban cards show task info:
     If agent has taskGroupRole + active task → show task title under name

6.4  Task Group tab:
     Empty state: centered icon + "No active Task Group" + [+ Create Task Group]
     Active state:
       - Roles bar: badges + agent names
       - Current batch panel: task list with status/owner/progress
       - Previous batches: collapsed list with status
       - Manager reports: scrollable log
       - Controls: [Pause] [Dissolve] [Send to Manager...]
     Overlay cards (conditional):
       - Batch proposal: task list + assignments + [Approve] [Edit] [Reject]
       - Awaiting merge: QA/Critic status + [View PR] [View Report] [Merge & Next] [Reject]

6.5  CreateTaskGroupModal:
     4 role pickers (dropdowns filtered by project agents):
       Manager (1): dropdown, default suggest GM/Product template agents
       QA (1): dropdown, default suggest QA template agents
       Critic (1): dropdown, default suggest Engineering template agents
       Workers (1+): multi-select checkboxes
     Todo source: text input, default 'docs/todo.md'
     Validation: ≥ 4 agents, each exactly 1 role, no duplicates
     On submit: save TaskGroup, set agent.taskGroupRole, inject souls, start agents

6.6  Role badges on agent sidebar:
     SVG icon overlay on avatar top-right (10px circle with icon):
     manager → crown, gold #F59E0B
     worker  → hammer, blue #3B82F6
     qa      → shield, green #10B981
     critic  → eye, purple #8B5CF6
     Shown only when agent has taskGroupRole.

6.7  Notification toast (manager reports):
     Bottom-right, auto-dismiss 10s, max 3 stacked.
     Shows: role badge + agent name + message + dismiss button.

6.8  IPC listeners in App.tsx:
     window.api.on('task:update') → update task list state
     window.api.on('manager:report') → show toast
     window.api.on('batch:proposal') → show proposal overlay

6.9  Update existing Playwright tests:
     - Tab navigation: 3 tabs → 4 tabs
     - Dashboard content assertions (was "Project" tab)
     - Agent sidebar: badge rendering when taskGroupRole set

6.10 New Playwright tests:
     - Create Task Group flow (open modal, assign roles, submit)
     - Task Group tab empty state → create button
     - Role badges visible after task group created
     - Batch proposal card appears and approve works
     - Dissolve task group removes badges

6.11 Build + test: all green (unit + E2E)
```

### Phase 7: Agent Flow Integration (~2 hr)

```
7.1  Manager flow (driven by soul + skill):
     /manager-whip-start → parse todo.md → batch-propose
     On approval: task-create each → task-assign to workers
     Poll task-status every 30s
     All done: merge worker branches → integration branch → trigger QA
     QA pass: trigger Critic
     Critic done: report-human

7.2  Worker flow (driven by soul):
     [HIVE:TASK] → execute → build/test → commit → push
     → Gate auto-runs → pass → task-done → ack → lessons → /clear → ready
     → Gate fail → read failure → fix → re-push
     → 3 fails → task-blocked

7.3  QA flow (driven by soul):
     [HIVE:TASK] type=qa → checkout integration
     → npm test → coverage → all verify[] → write report → task-done/blocked

7.4  Critic flow (driven by soul + /review skill):
     [HIVE:TASK] type=delivery → rebase → gate → read report
     → /review → gh pr create → push → task-done

7.5  Integration branch management:
     Manager (or Hive main process via IPC):
     git checkout -b integration/batch-N main
     git merge --no-ff hive/worker-a/branch (each worker)
     Conflict → report-human

7.6  Merge execution:
     Human clicks [Merge & Next Batch] in UI
     → Hive: exec('gh pr merge N --squash --delete-branch')
     → sendToAgent(manager, 'HUMAN', { merged: true, next: true })

7.7  Tests: integration test scenarios
     - task-done triggers gate → pass → updates task
     - task-done triggers gate → fail → notifies worker with detail
     - 3 gate fails → status blocked → manager notified
     - report-human triggers all 3 notification channels
7.8  Build + test: all green
```

### Phase 8: Edge Cases + Polish (~1 hr)

```
8.1  Blocked worker → manager sends [HIVE:MSG] with reassignment
8.2  All workers blocked → immediate report-human escalation
8.3  Merge conflicts → Critic reports, manager escalates to human
8.4  Human rejects PR → sendToAgent(manager) with feedback
8.5  Pause task group → stop assigning, running tasks finish naturally
8.6  Dissolve task group → remove roles, remove soul addenda, clean TaskGroup
8.7  todo.md changes mid-batch → manager detects on next poll, defers to next batch
8.8  Data migration: old data.json without taskGroups field loads cleanly
8.9  Build + test: all green
```

---

## 5. Features

| ID | Feature | Description |
|---|---|---|
| F1 | Contract todo.md | `verify` checklist with shell commands that exit 0/1 |
| F2 | Automated Gate | Hive main process: build + test + scope + contract verify. Zero tokens. |
| F3 | Task Group | Role assignment from existing agents. 4 roles, 1 group/project. |
| F4 | Batch execution | Manager proposes, human approves, workers parallel, zero deps per batch. |
| F5 | Stateless workers | `/clear` between tasks. Lessons file for cross-task knowledge. |
| F6 | QA test report | Structured report. Critic refuses PR without it. |
| F7 | Critic delivery | Rebase + gate + report + review + PR create + push. |
| F8 | PTY injection | `[HIVE:TASK/MSG/HUMAN/BATCH]` via `pty.write()`. |
| F9 | Human intervention | Approve/reject in UI. Direct PTY to any agent. |
| F10 | Dashboard | Project summary + progress bar + task group status. |
| F11 | Notifications | macOS + Telegram + UI toast on blocked/report-human. |
| F12 | Manager skill | `/manager-whip-start` — interactive bootstrap, 2 questions, then go. |

---

## 6. Verification Gates

### Gate 1: Worker Self-Test (soft, agent-side)
Worker runs build + test before commit. Claude Code's natural behavior. If skipped, Gate 2 catches.

### Gate 2: Automated Gate (hard, Hive main process)
After every worker push. All must pass.

| Check | Command | Pass |
|---|---|---|
| Build | `npm run build` | exit 0 |
| Test | `npm test` | exit 0 |
| Scope | `git diff --name-only` | all files in task.scope |
| Contract | each task.verify[] | all exit 0 |

Fail → worker receives specific failure → fix → re-push. Max retries → blocked.

### Gate 3: QA Integration (agent-side, batch-level)
On merged integration branch.

| Check | Description |
|---|---|
| Full tests | `npm test` on merged code |
| Coverage | No regression vs main |
| All contracts | Every verify[] from all tasks |
| Smoke test | Browse key pages (if web) |

Output: `.hive/comms/{projectId}/reports/batch-N-qa.md`

### Gate 4: Critic Independent (agent-side, delivery-level)
Does NOT trust prior results.

| Check | Description |
|---|---|
| Rebase | integration onto latest main, no conflicts |
| Build + test | Independent run |
| Scope | All changes within declared scopes |
| Verify | All contract commands pass |
| Report | QA report file exists and valid |
| Review | Adversarial: security, logic, scope creep, quality |

No report = no PR. Gate fail = no PR.

### Gate 5: Human Merge (manual, final)
Reviews PR in Hive UI. [Merge & Next Batch] or [Reject].

---

## 7. Test Plan

### Mandatory testing rules

```
Every Phase completion requires:
  ① Write unit tests (Vitest) for every new function/module
  ② npm run build — 0 errors
  ③ npm test — ALL tests pass (new + existing regression)
  ④ Fix failures before proceeding. Never skip.

Phase 6 (UI) additionally:
  ⑤ Update existing Playwright tests (3 tabs → 4 tabs layout change)
  ⑥ New Playwright tests for task group creation, batch operations

Final (after all Phases):
  ⑦ Full regression: npm test (all unit tests)
  ⑧ Full E2E: npx playwright test (all Playwright tests)
  ⑨ All green required before PR submission
```

### New unit tests (Vitest)

| File | Tests | Cases |
|---|---|---|
| contract-parser.test.ts | Contract format parsing | ~8 |
| tasks.test.ts | Task file CRUD + status machine | ~10 |
| endpoints.test.ts | HTTP endpoint handlers | ~8 |
| gate.test.ts | Gate runner logic | ~6 |
| souls.test.ts | Soul addenda generation | ~6 |
| send-to-agent.test.ts | PTY injection format | ~4 |
| **Subtotal** | | **~42** |

### New E2E tests (Playwright)

| File | Tests | Cases |
|---|---|---|
| task-group-ui.spec.ts | Task Group creation + badges + dissolve | ~5 |
| batch-flow.spec.ts | Batch proposal + approve + merge | ~4 |
| dashboard.spec.ts | Dashboard tab content + progress bar | ~3 |
| **Subtotal** | | **~12** |

### Existing test updates

| File | Change |
|---|---|
| Existing UI E2E tests | Tab navigation: 'project' → 'dashboard', add 'taskgroup' tab |
| templates.test.ts | Verify soul addendum injection doesn't break template generation |

### Total: ~55-60 test changes (42 new unit + 12 new E2E + ~5 existing updates)

---

## 8. PR Review Checklist

### Code Quality
- [ ] `npm run build` — 0 errors, 0 warnings
- [ ] `npm test` — all unit tests pass (existing 116+ and ~42 new)
- [ ] `npx playwright test` — all E2E tests pass (existing + ~12 new)
- [ ] No hardcoded paths (use `app.getPath('home')` or config)
- [ ] No TypeScript `any` in new code (strict types)

### Architecture
- [ ] TaskGroup type defined in types.ts, persisted in data.json
- [ ] Task files in `~/.hive/comms/{projectId}/tasks/`
- [ ] QA reports in `~/.hive/comms/{projectId}/reports/`
- [ ] All 8 HTTP endpoints implemented and tested
- [ ] All hive-report.sh commands implemented and tested
- [ ] sendToAgent() uses `\r` terminator
- [ ] Gate runner handles exec timeout/crash gracefully
- [ ] fs.watch cleanup on window close (no leaked watchers)
- [ ] data.json backwards compatible (old format loads without error)

### Security
- [ ] HTTP server only on 127.0.0.1 (no external access)
- [ ] No shell injection in hive-report.sh (inputs properly escaped)
- [ ] No path traversal in task file CRUD (validate projectId/taskId)
- [ ] No secrets in soul addenda, task files, or PR body

### UI
- [ ] 4 tabs: Dashboard, Office, Task Group, Settings
- [ ] Dashboard: summary + progress bar + task group status
- [ ] Task Group tab: empty state + active state + overlays
- [ ] Role badges render at all avatar sizes (24px sidebar, 20px kanban)
- [ ] CreateTaskGroupModal validates 4+ agents, no role duplicates
- [ ] Notification toasts auto-dismiss, max 3 stacked
- [ ] Dissolve cleans up all state (roles, badges, soul addenda)

### Notifications
- [ ] macOS notification fires on report-human and task-blocked
- [ ] Telegram notification fires on report-human and task-blocked
- [ ] UI toast fires on manager:report IPC
- [ ] All 3 channels work independently (one failing doesn't block others)

### Integration
- [ ] E2E: todo.md → batch propose → approve → task created
- [ ] Worker /clear → ready → receives [HIVE:TASK] (timing works)
- [ ] Gate fail → worker gets specific failure detail
- [ ] Gate 3 fails → blocked → manager notified → human notified
- [ ] Merge button executes `gh pr merge --squash --delete-branch`
- [ ] Old agents without taskGroupRole work unchanged
- [ ] Existing hive-report.sh start/done commands still work
