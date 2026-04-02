# Multi-Agent Integration Test Plan

**Date:** 2026-04-02
**Type:** Live integration test with real Claude agents
**Duration:** ~15-30 minutes
**Cost:** $0 (Claude Code subscription)

---

## Guardrails (ABSOLUTE RULES)

### Data Protection
1. **NEVER write to `~/.hive/data.json` directly from test code**
2. All test agents created via Hive UI (Playwright clicks), not file manipulation
3. All test agents deleted via Hive UI (Playwright clicks), not file manipulation
4. Before test: snapshot `~/.hive/data.json` to `~/.hive/data.json.test-backup`
5. After test: verify production data intact by comparing project count + agent count
6. If project count or agent count decreased after test → **ABORT + restore backup**

### Filesystem Protection
1. Test tasks write ONLY to `test-multi-agent-tasks/` folder inside the Hive project
2. Test agents work ONLY in worktrees (never main branch)
3. Test todo.md placed in `test-multi-agent-tasks/todo.md`
4. After test: `git clean` only `test-multi-agent-tasks/` — nothing else
5. **NEVER `rm -rf` any path outside `test-multi-agent-tasks/`**
6. **NEVER `git reset --hard`**
7. **NEVER delete worktrees not created by this test**

### Git Protection
1. Test branches named `hive/test-*` — only delete branches with this prefix during teardown
2. Integration branch named `integration/test-batch-*` — only these during teardown
3. **NEVER force push**
4. **NEVER touch main/master branch**
5. PR created by critic → close without merge during teardown (or merge to throwaway branch)

### Agent Protection
1. Test agents named with `[TEST]` prefix: `[TEST] Manager`, `[TEST] Worker-1`, etc.
2. Only delete agents with `[TEST]` prefix during teardown
3. Verify existing agent count unchanged after teardown
4. Test task group only references `[TEST]` agents

### Port Protection
1. Test uses Hive's existing dev server (already running or `npm run dev`)
2. Does NOT start a separate Electron instance
3. Uses the existing HTTP port (17710)

---

## Test Setup

### Pre-flight Checks
```
1. Verify Hive app is running (dev server)
2. Count existing projects and agents → save as baseline
3. Backup: cp ~/.hive/data.json ~/.hive/data.json.test-backup
4. Verify claude CLI works: claude --version
5. Verify gh CLI works: gh auth status
6. Create test-multi-agent-tasks/ directory in project root
```

### Create Test Todo (contract format)
```
test-multi-agent-tasks/todo.md:

# Integration Test Tasks

## test-batch

- [ ] Create file alpha.md with 3 paragraphs about testing
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/alpha.md
    - wc -l test-multi-agent-tasks/alpha.md | awk '{print ($1 >= 5)}'
  - acceptance: alpha.md exists with 3+ paragraphs

- [ ] Create file bravo.md with a numbered list of 10 items
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/bravo.md
    - grep -c "^[0-9]" test-multi-agent-tasks/bravo.md
  - acceptance: bravo.md exists with 10 numbered items

- [ ] Create file charlie.md with a markdown table
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/charlie.md
    - grep -c "|" test-multi-agent-tasks/charlie.md
  - acceptance: charlie.md exists with a markdown table

- [ ] Create file delta.md with code examples
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/delta.md
    - grep -c '```' test-multi-agent-tasks/delta.md
  - acceptance: delta.md has code blocks

- [ ] Create file echo.md summarizing alpha and bravo
  - depends: [alpha, bravo]
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/echo.md
  - acceptance: echo.md references content from alpha.md and bravo.md

- [ ] Create file foxtrot.md with a flowchart in mermaid
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/foxtrot.md
    - grep -c "mermaid" test-multi-agent-tasks/foxtrot.md
  - acceptance: foxtrot.md has mermaid flowchart

- [ ] Create file golf.md with pros/cons analysis
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/golf.md
    - grep -ci "pro\|con" test-multi-agent-tasks/golf.md
  - acceptance: golf.md has pros and cons sections

- [ ] Create file hotel.md with Q&A format
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/hotel.md
    - grep -c "?" test-multi-agent-tasks/hotel.md
  - acceptance: hotel.md has Q&A pairs

- [ ] Create file india.md with timeline of events
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/india.md
  - acceptance: india.md has chronological timeline

- [ ] Create file juliet.md summarizing all 9 previous files
  - depends: [echo, charlie, delta, foxtrot, golf, hotel, india]
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/juliet.md
    - wc -l test-multi-agent-tasks/juliet.md | awk '{print ($1 >= 10)}'
  - acceptance: juliet.md references all 9 files
```

### Create Test Agents (via Playwright UI)

| Agent | Role | Template | Department |
|---|---|---|---|
| [TEST] Manager | GM | General Manager | Non-R&D |
| [TEST] Worker-1 | Engineering | Full-Stack Engineer | R&D |
| [TEST] Worker-2 | Engineering | Full-Stack Engineer | R&D |
| [TEST] QA | QA | QA | R&D |
| [TEST] Critic | Engineering | Full-Stack Engineer | R&D |

All assigned to Hive project, src zone (R&D zone).

### Create Task Group (via Playwright UI)

```
Manager:  [TEST] Manager
Workers:  [TEST] Worker-1, [TEST] Worker-2
QA:       [TEST] QA
Critic:   [TEST] Critic
Todo:     test-multi-agent-tasks/todo.md
Max retries: 3
```

---

## Test Execution

### Phase 1: Manager Batch Proposal

```
1. Click [TEST] Manager in sidebar → terminal opens → claude --agent starts
2. Wait for Claude to load (detect prompt ready)
3. PTY inject: /manager-whip-start
4. Manager should:
   a. Ask for todo file → inject: test-multi-agent-tasks/todo.md
   b. Ask for max retries → inject: 3 (or Enter for default)
   c. Parse 10 tasks
   d. Group into batches:
      Batch 1: alpha, bravo, charlie, delta, foxtrot, golf, hotel, india (8 tasks, no deps)
      Batch 2: echo (depends: alpha, bravo)
      Batch 3: juliet (depends: echo + many others)
   e. Call hive-report.sh batch-propose
5. Verify: batch:proposal IPC received in UI
6. Verify: Batch Proposal card visible in Task Group tab
7. Click [Approve]
8. Verify: Manager receives [HIVE:HUMAN] approval
```

### Phase 2: Parallel Worker Execution

```
1. Click [TEST] Worker-1 → terminal opens → claude starts
2. Click [TEST] Worker-2 → terminal opens → claude starts
3. Manager assigns tasks (PTY inject workers with [HIVE:TASK])
4. Workers execute in parallel:
   - Worker-1 picks up some tasks
   - Worker-2 picks up others
   - Each creates a .md file in test-multi-agent-tasks/
5. Monitor:
   - Task board shows tasks moving: pending → assigned → in_progress → done
   - Each task-done triggers gate (verify[] commands)
   - Workers /clear between tasks
6. Observe:
   - Do workers pick up different tasks? (no collision)
   - Does gate pass? (files created + verify commands succeed)
   - Does /clear → ready → next task work?
   - What if both workers finish at ~same time?
7. Record: task completion order, timing, any gate failures
```

### Phase 3: Batch 2 + 3 (Dependencies)

```
1. After Batch 1 all done, Manager should:
   - Detect all Batch 1 tasks done
   - Propose Batch 2 (echo.md — depends on alpha + bravo)
   - After Batch 2 done → Propose Batch 3 (juliet.md — depends on many)
2. Approve each batch in UI
3. Workers execute
4. Verify dependency ordering correct
```

### Phase 4: QA

```
1. After all tasks done, Manager triggers QA
2. Click [TEST] QA → terminal opens
3. QA agent:
   - Checks all 10 files exist
   - Runs verify[] commands
   - Writes test report
4. Verify: QA report file created
5. QA reports pass/fail to Manager
```

### Phase 5: Critic / Delivery

```
1. Manager triggers Critic
2. Click [TEST] Critic → terminal opens
3. Critic agent:
   - Rebases (if needed)
   - Runs gate independently
   - Reads QA report
   - Reviews changes
   - Creates PR via gh pr create
4. Verify: PR created on GitHub
5. Verify: Merge card visible in Task Group tab
6. Click [Merge] (or close PR without merge for test safety)
```

---

## Observations to Record

Report directory created at test start, written to continuously (not at teardown):

```
test-multi-agent-report/
  summary.md              — overall pass/fail, timing, issues found
  batch-timeline.md       — when each task started/finished, which worker
  gate-results.md         — gate pass/fail per task, failures if any
  collision-log.md        — any concurrent task-done or assignment conflicts
  agent-behavior.md       — did agents follow soul instructions? /clear work?
  tasks/                  — snapshot of task JSON files (copied after each phase)
  reports/                — QA report (copied after QA phase)
  manager-log.md          — manager report-human messages collected
  screenshots/            — Playwright screenshots at key moments
```

### Continuous Snapshot Strategy

Data is copied to report dir **during the test, not at teardown**:

```
After Phase 1 (batch proposed):
  → cp comms/tasks/*.json → test-multi-agent-report/tasks/phase1/

After Phase 2 (workers done):
  → cp comms/tasks/*.json → test-multi-agent-report/tasks/phase2/
  → snapshot manager reports → manager-log.md

After Phase 4 (QA done):
  → cp comms/reports/*.md → test-multi-agent-report/reports/

After Phase 5 (Critic done) or on any failure:
  → final snapshot of all comms data
  → screenshot of Task Group tab
```

If test crashes mid-way, everything up to the last completed phase is preserved.

### Key Metrics
- Total time from start to all tasks done
- Tasks per worker (balanced distribution?)
- Gate pass rate (should be 100% for simple file creation)
- /clear → next task latency
- Any PTY injection failures (message not recognized)
- Any soul instruction confusion

---

## Teardown

Deleting an agent via UI automatically:
- Kills PTY terminal
- Removes git worktree directory + branch
- Deletes agent definition file

```
1. Dissolve test task group (via Dissolve button)
   → clears taskGroupRole on agents + removes TaskGroup from data.json
   → does NOT delete task JSON files or QA reports
2. Delete each [TEST] agent via UI delete button
   → auto-deletes: worktree directory, git branch, agent definition file
3. Clean comms (task files + reports created during test):
   → verify test-multi-agent-report/ already has copies (from continuous snapshots)
   → rm test task JSONs from ~/.hive/comms/{projectId}/tasks/
   → rm test QA reports from ~/.hive/comms/{projectId}/reports/
   → ONLY for Hive projectId, verify files are test-generated before deleting
   → if report dir missing copies → copy first, then delete
4. Close test PR (if created): gh pr close N
5. Delete integration branch: git push origin --delete integration/test-batch-*
6. Remove test task folder: rm -rf test-multi-agent-tasks/
7. Verify production data intact:
   - Count projects → must equal baseline
   - Count agents → must equal baseline (all [TEST] agents gone)
8. Commit test report: git add test-multi-agent-report/ && git commit
9. Push
```

### Teardown Safety Checks
```
BEFORE deleting anything:
  ✓ agent.name.startsWith('[TEST]')     — only delete test agents via UI
  ✓ folder === 'test-multi-agent-tasks/' — only delete test folder
  ✓ production project count unchanged
  ✓ production agent count unchanged
  ✓ NO direct data.json manipulation
  ✓ NO git reset --hard / git clean -f
```

---

## Failure Modes & Response

| Failure | Response |
|---|---|
| Manager doesn't parse todo.md | Check soul addendum, fix, restart |
| Worker doesn't recognize [HIVE:TASK] | Check PTY injection format, fix soul |
| Gate fails on valid file | Check verify[] commands, fix gate.ts |
| /clear doesn't trigger next task | Check ready → delay → [HIVE:TASK] timing |
| Two workers claim same task | Check task assignment logic in manager |
| QA can't find test report path | Check ensureReportsDir, fix path |
| Critic can't create PR | Check gh auth, branch name, fix |
| data.json corrupted | Restore from ~/.hive/data.json.test-backup |

---

## Decision: Playwright Automated vs Manual?

**Recommendation: Semi-automated.**

- Playwright creates agents, task group, clicks approve/merge
- Real Claude agents execute tasks (can't automate Claude's thinking)
- Playwright monitors UI state changes, takes screenshots
- Human watches terminal output for unexpected behavior

The test script should be a Playwright spec that:
1. Sets up everything
2. Kicks off the flow
3. Polls UI for completion (task board all done)
4. Records observations
5. Tears down

But it MUST handle the fact that real Claude agents take unpredictable time.
Use `page.waitForSelector` with long timeouts (5 min per task) instead of fixed delays.
