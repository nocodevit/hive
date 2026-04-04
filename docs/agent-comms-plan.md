# Agent Communication Plan

## Current State
- `hive-report.sh` — agent → Hive (task_start / task_done)
- HTTP webhook (localhost:17710) — hooks report status (working/waiting)
- Work logs — collected by main process, displayed in UI
- **All one-directional: Agent → Hive only**

## Missing
- Agent ↔ Agent direct messaging
- Hive → Agent messaging/task assignment
- Shared task list
- Task distribution/claiming mechanism

## Architecture

| Layer | Mechanism | Direction |
|---|---|---|
| Status | Existing — webhook hooks | Agent → Hive |
| Task Report | Existing — hive-report.sh | Agent → Hive |
| Task Assign | New — PTY injection | Hive → Agent |
| Agent Messaging | New — filesystem mailbox | Agent ↔ Agent |
| Shared Tasks | New — JSON task files | All agents read/write |

## Storage

```
~/.hive/
  comms/
    {projectId}/
      tasks/
        task-001.json    # { id, title, status, owner, blocked_by, created_by }
        task-002.json
      messages/
        {agentId}/
          msg-{timestamp}.json  # { from, to, content, type }
      broadcast/
          msg-{timestamp}.json  # all-agent broadcast
```

## Implementation Phases

### Phase 1: Hive → Agent (1-2 days)
- Already have `pty.write` capability
- Add UI button "Send Message to Agent"
- Main process injects text into target agent's terminal
- Near-zero effort — capability already exists

### Phase 2: Shared Task List (2-3 days)
- JSON task files under `~/.hive/comms/{projectId}/tasks/`
- Extend `hive-report.sh` with `claim` / `update` commands
- Main process `fs.watch` monitors changes, UI shows task board
- Agent soul instruction: "After completing task, check task list and claim next available"

### Phase 3: Agent ↔ Agent Messaging (2-3 days)
- Message files under `~/.hive/comms/{projectId}/messages/{agentId}/`
- Agent A writes file → Hive `fs.watch` detects → PTY injection notifies Agent B
- Extend `hive-report.sh` with `send {agentId} {message}` command

## Total Estimate: 5-8 days

## Design Decisions
- Filesystem-based (borrowed from Claude Code Agent Teams pattern)
- No external dependencies (no Redis, no MCP server)
- PTY injection as the Hive → Agent channel
- `hive-report.sh` as the Agent → Hive/Agent channel
- `fs.watch` as the event bus

## Reference: Anthropic 16-Agent C Compiler

Anthropic built a C compiler with 16 parallel agents, 2000 sessions, 100K lines, $20K cost over 2 weeks.

### Key Architecture Patterns

**1. Stateless short-lived agents (infinite loop + fresh containers)**
```
while true:
    container = fresh Docker container
    agent = new Claude session (no memory, no state)
    agent.claim_next_task()    ← file-lock on shared task list
    agent.work()
    agent.commit()             ← git commit as checkpoint
    agent.release_lock()
    container.destroy()        ← destroy, no state preserved
```
- Each session is an independent short task, destroyed on completion
- ~9 sessions per agent per day
- No single agent has a holistic view of the project

**2. File-lock task claiming**
- Shared task list (JSON), agents use file locks to claim tasks
- Prevents two agents from modifying the same module simultaneously
- **Hive implication**: add `.lock` file mechanism to `~/.hive/comms/{projectId}/tasks/`

**3. GCC as Oracle**
- Randomly compile files with GCC, compile the rest with their own compiler
- Binary search to find regressions
- **Hive implication**: define oracle/reference tests per project for automated regression detection

**4. CI forced regression protection**
- Every commit runs full test suite
- Any agent breaking existing functionality → CI rejects the commit
- Mid-project they had to strengthen CI because agents repeatedly broke existing features
- **Hive implication**: PostToolUse hook should run tests after every commit, block if failing

### Core Insight

> 16 agents, 2000 sessions — no single agent knows the full picture.
> Reliability comes from the harness (task locks + git + CI), not from agent memory or continuity.
> Agents are disposable. The harness is permanent.

### Implications for Hive Agent Comms

| Anthropic Pattern | Hive Adaptation |
|---|---|
| File-lock task claiming | Add `.lock` to task JSON files, `hive-report.sh claim` uses `flock` |
| Commit after every task | Agent soul: "git commit after every completed task, not at the end" |
| CI regression gate | PostToolUse hook: `npm test` after every commit, reject on failure |
| Stateless agents | Optional: agent restart between tasks to clear context bloat |
| Small task granularity | Task decomposition: each task should be completable without cross-module knowledge |
| No agent knows full picture | Project context via CLAUDE.md + progress.json, not agent memory |
