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

