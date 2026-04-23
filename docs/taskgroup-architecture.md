# Task Group Architecture — Role & Responsibility

## Core Principle

**Manager = Decision Maker. Dispatcher = Execution Engine.**

Manager makes all decisions. Dispatcher executes them reliably, enforces constraints, maintains state consistency, and reports back to Manager.

---

## Role Definitions

### Manager (Brain)
- **Decides**: what to do, who does it, when, and what to do when things fail
- **Does NOT**: directly communicate with agents, manage state, enforce constraints
- **Relies on**: Dispatcher for all execution, state queries, and agent communication

Responsibilities:
- Parse todo.md → group into batches → propose batch
- Decide task assignments (who does what)
- QA failed → decide: create fix tasks, reassign, or abandon
- Worker stuck → decide: wait, reassign, or escalate
- Task no longer needed → abandon with reason
- Daily report: summarize progress, plan tomorrow

### Dispatcher (Nervous System)
- **Executes**: Manager's decisions with guaranteed delivery and state consistency
- **Does NOT**: make decisions about what to do next
- **Reports to**: Manager (via [HIVE:MSG]) and Human (via notifications)

Responsibilities:
- **Communication**: Deliver messages between agents (Manager→Worker, Worker→Manager, etc.)
- **State management**: Update task status (pending→assigned→done→blocked→abandoned)
- **Constraints enforcement**:
  - One task per worker at a time (reject double-assign)
  - Forced git commit + rebase + push on task-done (no code left behind)
  - Scope check on task-done (warning to Worker + Manager)
  - Task-abandon requires reason (reject empty reason)
  - Task-abandon only by Manager (reject worker/qa/critic)
- **Auto-operations** (mechanical, not decisions):
  - Auto-assign next pending task when worker finishes (Manager pre-decided the queue)
  - Stuck detection → notify Manager (Manager decides what to do)
  - 5h limit detection → auto-whip (mechanical recovery, not a decision)
  - Port lock management
  - Activity log persistence
  - Daily report trigger at 00:01 (Manager decides content)
- **Status queries**: Respond to `task-status` so Manager can see current state

### Worker (Hands)
- Receives task via [HIVE:TASK]
- Executes within scope
- Runs verify[] commands
- Calls task-done (triggers Dispatcher's commit+push+scope chain)
- Calls task-blocked if stuck (Dispatcher notifies Manager)
- Never makes scheduling decisions

### QA (Quality Gate)
- Receives QA task via [HIVE:TASK] (Manager creates and assigns)
- Merges worker branches → runs build + test + verify
- Reports pass (task-done) or fail (task-blocked)
- Never fixes code

### Critic (Delivery Gate)
- Receives delivery task via [HIVE:TASK] (Manager creates and assigns)
- Rebases on main, reads QA report, runs code review, creates PR
- Reports PR ready (task-done) or issues (task-blocked)
- Never fixes code

### Human (Final Authority)
- Approves/rejects batch proposals
- Reviews and merges PRs on GitHub
- Intervenes when Manager escalates (all workers blocked, QA failed 3x, etc.)
- Can override any decision via [HIVE:HUMAN] messages

---

## Decision Flow

```
Human
  ↕ [approve/reject/override]
Manager (decisions)
  ↕ [commands via hive-report.sh]
Dispatcher (execution)
  ↕ [HIVE:TASK / HIVE:MSG / state updates]
Workers / QA / Critic (execution)
```

### Who Decides What

| Decision | Who | Dispatcher Role |
|----------|-----|-----------------|
| What tasks exist | Manager | Creates task in DB |
| Who does what task | Manager | Assigns + delivers [HIVE:TASK] |
| Next task after done | Manager (pre-queued) | Auto-assigns from pending queue |
| When to trigger QA | **Manager** | Creates QA task + assigns |
| When to trigger Critic | **Manager** | Creates Critic task + assigns |
| Task is stuck — what to do | Manager | Notifies Manager, Manager decides |
| Task should be abandoned | Manager | Executes abandon + notifies worker |
| QA failed — what to do | Manager | Notifies Manager, Manager decides |
| Git push required | Dispatcher (constraint) | Enforced in hive-report.sh |
| Scope warning | Dispatcher (check) | Reports to Worker + Manager |
| 5h limit recovery | Dispatcher (auto) | Mechanical whip, no decision needed |
| Daily report content | Manager | Dispatcher triggers, Manager writes |
| PR approval | Human | Outside Hive |

---

## Information Flow

### Manager → Dispatcher (Commands)
```
hive-report.sh batch-propose {...}     → Dispatcher stores, notifies Human
hive-report.sh task-create {...}       → Dispatcher creates task in DB
hive-report.sh task-assign ID AGENT    → Dispatcher assigns + delivers
hive-report.sh task-abandon ID REASON  → Dispatcher updates status + notifies
hive-report.sh task-status             → Dispatcher returns all tasks
hive-report.sh report-human MSG        → Dispatcher notifies Human
```

### Dispatcher → Manager (Reports)
```
[HIVE:MSG] {task: ID, status: "done", summary: "..."}     → Worker finished
[HIVE:MSG] {task: ID, status: "blocked", reason: "..."}   → Worker stuck
[HIVE:MSG] {gate: "warning", task: ID, warnings: [...]}   → Scope drift detected
[HIVE:MSG] {ping: ID, message: "exceeded time"}           → Stuck detection alert
```

### Dispatcher → Worker (Delivery)
```
[HIVE:TASK] {id, title, scope, verify[], note, ...}       → New task assignment
[HIVE:MSG] {gate: "pass/warning", task: ID}               → Scope check result
```

### Dispatcher → Human (Notifications)
```
macOS notification: "Task Stuck", "Gate Blocked", "QA Triggered", etc.
Telegram notification (if configured)
Activity Log in UI
```

---

## Constraint Enforcement (Dispatcher)

| Constraint | Where Enforced | Behavior |
|-----------|----------------|----------|
| One task per worker | `/task-assign` endpoint | Rejects if worker has assigned/in_progress task |
| Forced push on task-done | `hive-report.sh task-done` | git add + commit + rebase + push. Push fail = done rejected |
| Scope check | `gate.ts runGate()` | Warning only. Task still done. Worker + Manager notified |
| Abandon requires reason | `/task-abandon` endpoint | 400 if reason empty |
| Abandon manager-only | `/task-abandon` endpoint | 403 if caller is not task group manager |
| Cannot abandon done task | `/task-abandon` endpoint | 409 if task already done |
| Stuck notification max 3 | Stuck detection interval | 3 notifications, then silent polling |
| Target branch rebase | `hive-report.sh task-done` | Rebase on origin/{targetBranch}. Conflict = done rejected |

---

## What Dispatcher Should NOT Do

- ~~Auto-trigger QA when batch complete~~ → Manager should decide and create QA task
- ~~Auto-trigger Critic when QA passes~~ → Manager should decide and create Critic task
- ~~Decide what to do about stuck tasks~~ → Only notify Manager
- ~~Decide which worker gets which task~~ → Only execute Manager's assignment
- ~~Create fix tasks when QA fails~~ → Only notify Manager

---

## Current Deviation (To Fix)

`checkBatchComplete()` in `index.ts` currently auto-creates QA and Critic tasks. This should be removed. Instead:
- Dispatcher should notify Manager: `[HIVE:MSG] {batch: N, status: "all_done", message: "All worker tasks complete. Create QA task when ready."}`
- Manager decides and creates QA task via `hive-report.sh task-create`
- Same for Critic: Dispatcher notifies Manager when QA passes, Manager creates Critic task

This preserves Manager as sole decision maker.
