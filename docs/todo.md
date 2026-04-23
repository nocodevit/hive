# Hive Todo

## v0.10.0 — QA/Critic Pipeline + UI Polish

- [ ] QA auto-trigger: dispatcher detects all batch tasks done → create QA task + assign to QA agent
  - depends: none
  - scope: src/main/
  - acceptance: When all tasks in a batch are done, dispatcher auto-creates a QA task with workerBranches + integrationBranch, assigns to QA agent.

- [ ] Critic auto-trigger: dispatcher detects QA pass → create delivery task + assign to Critic agent
  - depends: QA auto-trigger
  - scope: src/main/
  - acceptance: When QA task-done with "QA pass", dispatcher auto-creates delivery task and assigns to Critic.

- [ ] Batch timeline UI: replace flat task list with organized timeline (who | time | action | content)
  - depends: none
  - scope: src/renderer/
  - acceptance: Batch expanded view shows timeline rows with agent emoji, name, time, action tag, and task content. System events dimmed.

- [ ] Checkpoint: Worker stalled → save progress to task JSON, another Worker can resume
  - depends: none
  - scope: src/main/
  - acceptance: When a Worker hits 5h limit, its task progress is persisted. A new Worker picking up the task reads the checkpoint and continues.

- [ ] Dependency Graph UI: visualize batch task dependencies in Task Group tab
  - depends: none
  - scope: src/renderer/
  - acceptance: Task Group tab shows a simple DAG of task dependencies across batches.

- [ ] Pause button functionality
  - depends: none
  - scope: src/renderer/
  - acceptance: Pause stops assigning new tasks. Running tasks finish. Resume re-enables.

- [ ] Task count badge on Task Group tab label
  - depends: none
  - scope: src/renderer/
  - acceptance: Tab shows count like "Task Group (3)".

## Done (v0.9.x)

- [x] Gate reform: scope+verify only, no build/test (QA's job)
- [x] Gate scope changed to warning (not blocking)
- [x] Worker runs verify[] themselves for full output visibility
- [x] Stuck detection with max 3 notifications, then silent polling
- [x] 5-hour limit detection via PTY output + auto-whip on reset
- [x] Task abandon (Manager only, reason required)
- [x] Task note field
- [x] Daily report trigger (00:01, Manager soul)
- [x] Port lock file (dispatcher isolation)
- [x] Dev server isolation (separate port + data dir)
- [x] Activity Log with role emoji, agent names, date/time, clear controls
- [x] Batch history (all batches visible, collapsible, with dates)
- [x] Auto-approve mode for batch proposals
- [x] Startup task loading from disk
- [x] Agent definition rewrite on task group creation + app startup
- [x] R&D Rebase button
- [x] File Explorer: path + branch tag
- [x] Skill dedup (gstack + standalone)
- [x] Project right-click context menu (restart all agents)
- [x] PTY message submit fix (150ms delay)
- [x] QA soul: merge worker branches before testing
- [x] Critic soul: trust QA, no re-test
- [x] Compact soul addenda
- [x] Brighter purple theme + font +1px + Apple emoji
