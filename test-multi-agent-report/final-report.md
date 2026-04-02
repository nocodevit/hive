# Multi-Agent Integration Test — Final Report

**Date:** 2026-04-02 ~ 04-03
**Runs:** 5 attempts (4 failed on test script bugs, 1 passed)
**Duration:** Run 5 took 11 minutes
**Result:** 7/7 Playwright tests PASSED — but orchestration did NOT actually work

---

## Critical Finding

**Tests passed but gave FALSE POSITIVE.** The Playwright tests don't have hard assertions on the orchestration flow actually completing. They use timeouts and warnings instead of fail-on-missing.

### What Actually Happened (from screenshots + data)

| Phase | Expected | Actual | Evidence |
|---|---|---|---|
| Manager startup | Claude launches, reads todo.md | ✅ Claude started, /manager-whip-start ran | screenshot 07 |
| Manager proposes batch | batch-propose HTTP call → UI shows proposal card | ❌ No proposal card appeared | screenshot 09: "No tasks yet" |
| Workers execute | Workers receive [HIVE:TASK], create files | ❌ Workers opened terminals but never received tasks | screenshot 10: empty terminal |
| Task progress | Tasks move pending→done | ❌ 0/0 tasks throughout 5 minutes | batch-timeline.md: all entries "0/0" |
| QA | QA runs integration test | ❌ QA terminal opened but no task to verify | no task files created |
| Critic | Creates PR | ❌ No PR created | no tasks = nothing to review |
| Teardown | Clean all [TEST] resources | ✅ All agents deleted, baseline restored | summary.md: "10 projects, 17 agents" |

### Root Cause: Manager Never Created Tasks

Screenshot 07 shows the manager was "Pontificating... (thinking)" after reading todo.md. The `/manager-whip-start` skill told it to parse todo.md and call `hive-report.sh batch-propose`, but:

1. **Manager was still thinking when the test moved on** — 15s wait was not enough for Claude to finish processing the todo.md, formulate a batch, and call hive-report.sh
2. **No tasks were created** — `task-status` returned 0/0 for the entire 5-minute worker wait
3. **Task JSON in comms/** — only `test-proj_task-001.json` exists (from previous test runs, not from this run)

### Why the Tests Still Passed

The test has soft assertions:
```javascript
// This doesn't fail — it just logs a warning
if (await approveBtn.isVisible(...).catch(() => false)) {
  // approve
} else {
  appendReport('⚠️ No batch proposal card found')  // ← warning, not assert
}

// Worker loop exits on timeout, doesn't fail
if (!allDone) {
  appendReport('⚠️ Timeout: not all tasks completed')  // ← warning, not assert
}
```

---

## Bugs Found and Fixed During Testing

### Test Script Bugs (fixed)

| # | Bug | Runs Affected | Fix |
|---|---|---|---|
| 1 | app.firstWindow() timeout — port conflict with running Hive | Run 1 | Use port 17796 |
| 2 | screenshot() crash on undefined page | Run 1 | Null guard + try/catch |
| 3 | selectOption with regex (Playwright doesn't support) | Run 2-3 | Use exact label string |
| 4 | Worker checkbox strict mode (2 matches) | Run 3 | Use getByRole().first() |
| 5 | Task Group tab not visible after agent terminal | Run 4 | goToTaskGroupTab() navigates back to project first |

### Orchestration Bugs (NOT yet fixed — need investigation)

| # | Bug | Severity | Analysis |
|---|---|---|---|
| 6 | Manager thinks too long, never calls batch-propose | 🔴 Critical | Soul/skill instructions may not be clear enough. Or Claude is trying to do something complex before proposing. Need to check what manager actually did in its terminal. |
| 7 | Manager doesn't call hive-report.sh task-create | 🔴 Critical | Related to #6. If manager never proposes, it never creates tasks. |
| 8 | Workers never receive [HIVE:TASK] | 🔴 Critical | Downstream of #6-7. No tasks = nothing to assign. |
| 9 | Test assertions are too soft (warnings instead of fails) | 🟡 Medium | Tests should fail when batch proposal doesn't appear within timeout. |
| 10 | Manager PTY timing is guesswork (hardcoded waits) | 🟡 Medium | Should monitor terminal output for specific prompts before injecting. |

---

## Data Preserved

```
test-multi-agent-report/
├── final-report.md          ← this file
├── summary.md               ← per-run summaries with timestamps
├── session-log.md           ← bug log across all runs
├── batch-timeline.md        ← task progress polls (all 0/0)
├── run1-output.txt          ← Playwright output run 1
├── run2-output.txt          ← run 2
├── run3-output.txt          ← run 3
├── run4-output.txt          ← run 4
├── run5-output.txt          ← run 5 (7/7 passed)
├── screenshots/             ← 29 screenshots across all phases
│   ├── 00-before-setup.png
│   ├── 01-hive-project-selected.png
│   ├── 02-test-agents-created.png
│   ├── 03-task-group-config.png
│   ├── 04-task-group-created.png
│   ├── 05-manager-terminal.png
│   ├── 06-manager-whip-start.png
│   ├── 07-after-manager-propose.png  ← KEY: manager "Pontificating..."
│   ├── 08-task-group-after-propose.png
│   ├── 09-no-proposal-card.png       ← KEY: no proposal appeared
│   ├── 10-workers-started.png        ← KEY: empty worker terminal
│   └── 11-progress-*.png             ← all show "No tasks yet"
└── tasks/                    ← task JSON snapshots per phase
    ├── phase1-proposal/
    ├── phase2-*/
    ├── phase4-qa/
    ├── phase5-critic/
    └── final/
```

---

## Next Steps (Priority Order)

1. **Investigate what manager actually did** — need to read manager's terminal output after /manager-whip-start. The screenshot shows "Pontificating..." but we don't know what it decided to do next. Possible: it errored out, or it's trying to use hive-report.sh but the script doesn't exist in the test worktree.

2. **Check hive-report.sh generation** — when [TEST] Manager was created, did writeAgentDefinition create `.claude/hive-report.sh` in the correct cwd? The manager is Non-R&D (no worktree), so cwd = zone path = project root. Does hive-report.sh exist there?

3. **Harden test assertions** — change soft warnings to hard `expect()` with reasonable timeouts. A test that always passes is useless.

4. **Add terminal output capture** — expose PTY output via IPC so Playwright can wait for specific prompts before injecting text.

5. **Increase manager wait time** — or better, poll for batch proposal IPC event instead of fixed timeout.

---

## Guardrails Verification

| Check | Result |
|---|---|
| Production data intact after all runs | ✅ 10 projects, 17 agents (unchanged) |
| data.json.test-backup exists | ✅ |
| No [TEST] agents remaining | ✅ All cleaned up |
| No test worktrees remaining | ✅ (agents deleted → worktrees auto-removed) |
| No test branches remaining | ✅ |
| test-multi-agent-tasks/ cleaned | ✅ |
