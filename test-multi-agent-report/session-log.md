# Integration Test Session
Started: Thu Apr  2 23:30:14 +08 2026


## Run 1 — FAILED

**Time:** $(date)
**Bugs found:**

### Bug 1: app.firstWindow() timeout (60s)
- **Cause:** Test launched new Electron on default port 17710, but user's Hive app already running on that port → window never opened
- **Fix:** Use separate port 17796 via HIVE_PORT env var
- **File:** e2e/integration.spec.ts

### Bug 2: screenshot() crash when page is undefined
- **Cause:** beforeAll failed (no window), but afterAll still ran and called screenshot(page, ...) with undefined page
- **Fix:** Guard screenshot() with null check + try/catch
- **File:** e2e/integration.spec.ts

---
App launched on port 17796


## Run 2 — PARTIAL (2/7 passed)

**Bugs found:**

### Bug 3: selectOption with regex label
- **Cause:** Playwright selectOption doesn't accept RegExp for label, only string
- **Fix:** Use exact label strings: "[TEST] Manager (GM)" etc.
- **File:** e2e/integration.spec.ts

---
App launched on port 17796


## Run 3 — PARTIAL (2/7 passed)

### Bug 4: Worker checkbox strict mode violation
- **Cause:** `label:has-text("[TEST] Worker-1")` matched 2 elements (label text appears in both checkbox area and possibly dropdown remnant)
- **Fix:** Use `getByRole('checkbox', { name: '[TEST] Worker-1' }).first()`
- **File:** e2e/integration.spec.ts

---
App launched on port 17796


## Run 4 — PARTIAL (3/7 passed)

### Bug 5: Task Group tab not visible after agent terminal opens
- **Cause:** Clicking agent opens terminal view. Project tabs (Dashboard/Office/Task Group/Settings) only visible when no agent is selected. Must click project in sidebar first to deselect agent.
- **Fix:** Added `goToTaskGroupTab()` helper that clicks project first, then tab.
- **File:** e2e/integration.spec.ts
- **Affected:** 3 locations (after manager, worker poll loop, after critic)

---
App launched on port 17796

App launched on port 17796


## Run 6 — PASSED but still FALSE POSITIVE

### Bug 6 (confirmed): hive-report.sh now has all commands ✅ FIXED
- Manager's hive-report.sh confirmed to have batch-propose, task-create etc.
- But manager was still "Recombulating [thinking]" — processing todo.md

### Bug 7: Manager wait time too short (15s after config → moved on)
- **Cause:** 15s fixed wait not enough for Claude to parse 10 contracts + build batch + call hive-report.sh
- **Fix:** Replace fixed wait with 3-minute polling loop that checks task-status HTTP endpoint every 10s
- **File:** e2e/integration.spec.ts

### Improvement: Worker wait increased to 8 minutes

---
App launched on port 17796


## Run 7 — PASSED but still 0 tasks created

### Bug 8: Manager cwd is Non-R&D zone, not code project
- **Cause:** Manager agent zone = `/Users/meiyang/OnePersonCompany/Hive` (Non-R&D). But `test-multi-agent-tasks/todo.md` is relative to `/Users/meiyang/FrontEndProjects/hive`. Manager's Claude session can't find the file.
- **Evidence:** Screenshot 07-manager-99s.png: "No todo.md found in the project. The path test-multi-agent-tasks/todo.md doesn't exist either."
- **Fix:** Use absolute path for todo.md when injecting into PTY
- **File:** e2e/integration.spec.ts

---
App launched on port 17796


## Run 8 — Manager parsed todo correctly! But stuck on Y/n prompt

### Bug 9: Manager asks "Submit batch proposal? [Y/n]" but test never responds
- **Cause:** /manager-whip-start skill has a confirmation step. Manager correctly parsed todo.md (10 tasks, 3 batches), showed the proposal, asked for Y/n. But test was polling task-status instead of answering.
- **Evidence:** Screenshot 07-manager-99s.png clearly shows batch plan + "Submit batch proposal to human? [Y/n] >"
- **Fix:** After 60s, switch to manager terminal and send "Y\r". Then continue polling for tasks.
- **File:** e2e/integration.spec.ts

**This is a MAJOR milestone** — the orchestration parsing + batching logic WORKS. Just need the Y/n answer to unblock.

---
