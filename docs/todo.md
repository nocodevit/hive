# Hive Todo

## v0.8.0 — Multi-Agent Orchestration

- [ ] Add Pause button functionality to Task Group
  - depends: none
  - scope: src/renderer/src/App.tsx
  - verify:
    - npm run build
    - npx vitest run
    - grep -r "handlePause\|pauseTaskGroup" src/renderer/
  - acceptance: Pause button in Task Group tab stops assigning new tasks. Running tasks finish. Resume re-enables assignment.

- [ ] Add task count badge to Task Group tab label
  - depends: none
  - scope: src/renderer/src/App.tsx
  - verify:
    - npm run build
    - npx vitest run
    - grep -r "taskgroup.*badge\|task-count" src/renderer/
  - acceptance: Task Group tab shows count of active tasks like "Task Group (3)". Zero shows no badge.

- [ ] Add lessons.md viewer in agent editor
  - depends: none
  - scope: src/renderer/src/
  - verify:
    - npm run build
    - npx vitest run
  - acceptance: Agent editor has a "Lessons" tab that reads and displays .claude/lessons.md from the agent's worktree.
