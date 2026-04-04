# Claude Code Agent Teams — Technical Internals Report

**Date:** 2026-03-31
**Claude Code version tested:** 2.1.87
**Feature status:** Experimental (opt-in via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
**Sources:** [Official docs](https://code.claude.com/docs/en/agent-teams), [Sub-agents docs](https://code.claude.com/docs/en/sub-agents), [Hooks docs](https://code.claude.com/docs/en/hooks), [Binary analysis (paddo.dev)](https://paddo.dev/blog/claude-code-hidden-swarm/), [alexop.dev deep dive](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/), [claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/agent-teams.md)

---

## 1. Architecture

### Components

| Component      | Description |
|:---------------|:------------|
| **Team lead**  | The main Claude Code session that creates the team, spawns teammates, coordinates |
| **Teammates**  | Separate Claude Code instances, each with its own 1M-token context window |
| **Task list**  | Shared JSON files on disk with dependency tracking and file-lock-based claiming |
| **Mailbox**    | Filesystem-based messaging system for inter-agent communication |

### Storage Locations (verified on disk)

```
~/.claude/teams/{team-name}/config.json          # Team config (runtime state)
~/.claude/teams/{team-name}/messages/{session-id}/ # Mailbox per agent
~/.claude/tasks/{team-name}/                      # Task list (one JSON file per task)
~/.claude/tasks/{team-name}/.lock                 # File lock for task claiming
~/.claude/tasks/{team-name}/.highwatermark        # Next task ID counter
```

**Note:** On my machine, `~/.claude/teams/` does not exist (no teams have been created yet). `~/.claude/tasks/` exists and contains UUID-keyed directories from the standalone TaskList tool (used outside of Agent Teams). When Agent Teams are active, directories are keyed by `{team-name}` instead of UUID.

### Team Config Format (`config.json`)

```json
{
  "members": [
    { "name": "researcher", "agentId": "unique-id", "agentType": "general-purpose" }
  ]
}
```

This file is **auto-generated and auto-updated** by Claude Code. Do NOT pre-author or hand-edit it — your changes are overwritten on the next state update. There is no project-level equivalent (`.claude/teams/teams.json` is not recognized).

### Task File Format (individual JSON per task)

```json
{
  "id": "1",
  "subject": "Task title",
  "description": "Detailed instructions",
  "status": "pending",        // pending | in_progress | completed
  "owner": "agent_name",      // set when claimed
  "blocks": [],               // task IDs this task blocks
  "blockedBy": []              // task IDs blocking this task
}
```

Task claiming uses **file locking** to prevent race conditions. When a blocking task completes, downstream tasks automatically unblock.

### Environment Variables (per-teammate process)

Each teammate process has these env vars injected:

| Variable | Purpose |
|:---------|:--------|
| `CLAUDE_CODE_TEAM_NAME` | Team identifier |
| `CLAUDE_CODE_AGENT_ID` | Unique agent identifier |
| `CLAUDE_CODE_AGENT_TYPE` | Agent type (e.g., `general-purpose`, or custom subagent name) |

---

## 2. Teammate Lifecycle

### Spawn

1. User tells lead to create a team (or lead proposes and user confirms)
2. Lead calls the **TeammateTool** with operation `spawnTeam`
3. Claude Code spawns each teammate as a **separate Claude Code process** with its own context window
4. Each teammate loads project context independently: `CLAUDE.md`, MCP servers, skills
5. Each teammate receives its spawn prompt from the lead (lead's conversation history does NOT carry over)

### Work

1. Teammate reads the shared task list and **self-claims** the next unblocked pending task (or lead assigns explicitly)
2. Teammate executes work using all standard Claude Code tools (Bash, Edit, Read, etc.)
3. Teammate can message other teammates or the lead via the mailbox system

### Idle

1. When a teammate finishes its current task and no more unblocked tasks remain, it goes **idle**
2. The `TeammateIdle` hook fires before idle (exit code 2 = keep working with feedback)
3. Idle teammates automatically notify the lead

### Message

Inter-agent messaging operations (from binary analysis, 13 operations total):

| Operation | Description |
|:----------|:------------|
| `write` | Direct message to one specific teammate |
| `broadcast` | Message to all teammates (use sparingly, cost scales with team size) |
| `requestShutdown` / `approveShutdown` / `rejectShutdown` | Graceful termination protocol |
| `approvePlan` / `rejectPlan` | Quality gate for plan-mode teammates |
| `requestJoin` / `approveJoin` / `rejectJoin` | Join protocol |
| `spawnTeam` / `discoverTeams` / `cleanup` | Lifecycle management |

Messages are delivered **automatically** to recipients — no polling needed. The underlying transport is **filesystem-based** (`~/.claude/teams/{team-name}/messages/{session-id}/`).

### Shutdown

1. Lead sends `requestShutdown` to teammate
2. Teammate can `approveShutdown` (exits gracefully) or `rejectShutdown` (with explanation)
3. Teammates finish their current request/tool call before shutting down (can be slow)
4. After all teammates shut down, lead runs `cleanup` to remove shared team resources

---

## 3. Working Directory / Worktree Behavior

### Default: Shared Working Directory

By default, **all teammates share the same working directory** as the lead. This means:

- Multiple agents can edit the same files (risk of overwrites/conflicts)
- No git isolation between teammates
- Official docs explicitly warn: "Two teammates editing the same file leads to overwrites"

### Worktree Isolation (via subagent definitions)

Subagent definitions support `isolation: worktree` in frontmatter:

```yaml
---
name: feature-builder
description: Builds features in isolation
isolation: worktree
---
```

When `isolation: worktree` is set:
- Claude Code creates a temporary **git worktree** under `.claude/worktrees/` with a new branch based on HEAD
- The teammate gets its own filesystem checkout (separate working directory, branch, and index)
- The worktree is **automatically cleaned up** if the teammate makes no changes
- On exit, the user is prompted to keep or remove the worktree

### EnterWorktree / ExitWorktree Tools

Claude Code has built-in tools for worktree management:

- `EnterWorktree`: Creates a git worktree in `.claude/worktrees/`, switches session CWD
- `ExitWorktree`: Returns to original CWD, optionally removes worktree + branch
- Only operates on worktrees created by `EnterWorktree` in the current session
- Clears CWD-dependent caches on exit

### CLI-level Worktree Support

```bash
claude --worktree [name]        # Create worktree for session
claude --tmux                   # Create tmux session for the worktree
```

### Practical Implication for Agent Teams

Agent Teams do NOT automatically create worktrees per teammate. You must either:

1. Use `isolation: worktree` in subagent definitions referenced by teammates
2. Have teammates manually create worktrees
3. Design task decomposition so teammates don't edit the same files

---

## 4. Communication Details

### Messaging vs Subagents

| Aspect | Subagents | Agent Teams |
|:-------|:----------|:------------|
| Context | Own window, results return to caller | Own window, fully independent |
| Communication | Report back to main agent only | Teammates message each other directly |
| Coordination | Main agent manages all work | Shared task list with self-coordination |
| Resumability | Can be resumed via `SendMessage` with agent ID | No session resumption with in-process teammates |
| Cost | Lower (results summarized back) | Higher (each teammate = separate Claude instance) |

### Message Types

- **message**: Direct one-to-one communication
- **broadcast**: One-to-all (expensive, scales with team size)
- **shutdown_request/response**: Graceful termination
- **plan_approval_response**: Quality gate decisions

### No Shared Memory

Teammates have **no shared memory or shared context**. The only coordination channels are:
1. Task files on disk
2. Mailbox messages
3. The actual git repository (shared filesystem)

---

## 5. Hooks Integration (Quality Gates)

Three hooks specifically for Agent Teams:

### TeammateIdle

```json
{
  "hook_event_name": "TeammateIdle",
  "teammate_name": "researcher",
  "team_name": "my-project",
  "session_id": "abc123",
  "cwd": "/path/to/project"
}
```
- Exit 0: teammate goes idle
- Exit 2: teammate receives stderr feedback and continues working
- JSON `{"continue": false}`: stops teammate entirely

### TaskCreated

```json
{
  "hook_event_name": "TaskCreated",
  "task_id": "task-001",
  "task_subject": "Implement auth",
  "task_description": "...",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```
- Exit 0: task created
- Exit 2: task NOT created, feedback to model

### TaskCompleted

Same fields as TaskCreated. Fires when:
1. Agent explicitly marks task complete via `TaskUpdate`
2. Teammate finishes its turn with in-progress tasks

These hooks enable external quality gates (run tests, lint, check artifacts) before allowing state transitions.

---

## 6. Permissions and MCP

### Permission Inheritance

- Teammates start with the **lead's permission settings**
- If lead uses `--dangerously-skip-permissions`, all teammates do too
- Individual teammate modes can be changed AFTER spawn (not at spawn time)

### MCP Server Access

Teammates load the same project context as a regular session, including MCP servers configured in `.mcp.json`. When using subagent definitions for teammates, the `mcpServers` field can scope specific MCP servers to specific agent types.

### Custom Agent Definitions

Yes, teammates can use custom subagent definitions from any scope:
- `.claude/agents/*.md` (project)
- `~/.claude/agents/*.md` (user)
- Plugin agents
- `--agents` CLI flag (session only)

Reference by name when spawning: `"Spawn a teammate using the security-reviewer agent type"`

---

## 7. Display Modes

### In-Process (default)

- All teammates run inside the main terminal
- `Shift+Down` to cycle through teammates
- `Enter` to view a teammate's session, `Escape` to interrupt
- `Ctrl+T` to toggle task list
- Works in any terminal

### Split Panes

- Each teammate gets its own tmux/iTerm2 pane
- Requires tmux or iTerm2 with `it2` CLI
- Configure via `~/.claude.json`: `{ "teammateMode": "tmux" }`
- Or CLI: `claude --teammate-mode in-process`
- Auto mode: uses split panes if already in tmux, in-process otherwise
- NOT supported in VS Code terminal, Windows Terminal, or Ghostty

---

## 8. Limitations (Verified)

1. **No session resumption** with in-process teammates — `/resume` and `/rewind` do not restore them
2. **Task status can lag** — teammates sometimes fail to mark tasks complete, blocking dependents
3. **Shutdown can be slow** — teammates finish current request/tool call first
4. **One team per session** — clean up current team before starting new one
5. **No nested teams** — teammates CANNOT spawn their own teams or teammates
6. **Lead is fixed** — cannot promote teammate to lead or transfer leadership
7. **Permissions set at spawn** — all teammates start with lead's mode, can only change after
8. **No shared context** — teammates don't see each other's reasoning, only explicit messages
9. **File conflict risk** — no automatic worktree isolation, same-file edits cause overwrites
10. **High token cost** — each teammate is a full Claude instance (~200k+ tokens in context)

---

## 9. Integration Points for Hive

### What Hive Can Hook Into

| Integration Point | Mechanism | Hive Opportunity |
|:-------------------|:----------|:-----------------|
| Team config file | `~/.claude/teams/{name}/config.json` | Read to discover active teams, members, session IDs |
| Task files | `~/.claude/tasks/{name}/*.json` | Read/write to inject tasks, monitor progress |
| Lock files | `~/.claude/tasks/{name}/.lock` | Monitor for task claim activity |
| Hooks: TeammateIdle | Shell script exit codes | Run Hive quality gates before idle |
| Hooks: TaskCreated | Shell script exit codes | Enforce Hive task naming/routing rules |
| Hooks: TaskCompleted | Shell script exit codes | Run Hive CI checks before task closure |
| Message directory | `~/.claude/teams/{name}/messages/` | Monitor inter-agent communication |
| Teammate env vars | `CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_AGENT_ID` | Identify teammates in Hive's process manager |
| Display mode | `teammateMode` in `~/.claude.json` | Force in-process mode so Hive controls the UI |
| Subagent definitions | `.claude/agents/*.md` | Define Hive-specific agent roles |

### What Hive Cannot Control

- Cannot spawn teammates programmatically (only the lead can, via natural language)
- Cannot directly message teammates (must go through Claude's messaging tool)
- Cannot reassign tasks between teammates
- Cannot promote/demote teammates
- Cannot resume a team after session ends

---

## 10. Recommendation: Should Hive Adopt Agent Teams, Wrap It, or Build Its Own?

### Option A: Adopt Agent Teams Directly

**Pros:**
- Anthropic-maintained, will improve over time
- Built-in task list, messaging, hooks
- Teammates get full Claude Code capabilities (tools, MCP, skills)

**Cons:**
- Experimental, unstable, limited control
- No programmatic API — everything is natural language driven
- No session resumption for teammates
- Cannot integrate Hive's existing UI/process management
- One team per session limit conflicts with Hive's multi-project model
- Display mode (in-process/tmux) doesn't map to Hive's Electron UI

**Verdict:** Not suitable as primary orchestration layer.

### Option B: Wrap Agent Teams

**Pros:**
- Leverage task list + messaging without reimplementing
- Hooks provide quality gate integration
- Can monitor team state via filesystem

**Cons:**
- Hive would be a passive observer, not a controller
- Cannot spawn/stop teammates programmatically
- The "lead" is a Claude session, not Hive
- Wrapping a natural-language-driven system adds fragility

**Verdict:** Possible for research/review use cases, but Hive loses control.

### Option C: Build Hive's Own Multi-Agent System (Recommended)

**Pros:**
- Full programmatic control over agent lifecycle
- Hive IS the orchestrator (not a Claude session)
- Can use `claude -p` (headless mode) for each agent = full API control
- Can implement Hive's own task queue, dependency graph, and messaging
- Can integrate worktree isolation natively
- Can support multiple teams/projects simultaneously
- Maps directly to Hive's Electron UI

**Cons:**
- More implementation work
- Must implement task coordination, messaging, conflict resolution

**What to steal from Agent Teams:**
1. **Task file format** — JSON per task with `id, subject, description, status, owner, blocks, blockedBy`
2. **Hook pattern** — TeammateIdle/TaskCreated/TaskCompleted exit-code protocol
3. **Subagent definitions** — `.claude/agents/*.md` format with YAML frontmatter
4. **Worktree isolation** — `isolation: worktree` pattern for per-agent git isolation
5. **Message types** — `message`, `broadcast`, `shutdown_request/response`

**Architecture for Hive's own system:**
```
Hive (Electron, Node.js)
├── Agent Manager — spawns claude -p processes, manages lifecycle
├── Task Queue — JSON-based, dependency-aware, with file locking
├── Message Bus — IPC or file-based mailbox (Level 2-3 from comms plan)
├── Worktree Manager — git worktree create/cleanup per agent
├── Hook Runner — quality gates on task transitions
└── UI — Electron renders agent status, tasks, messages
```

This aligns with the existing `multi-agent-comms-plan.md` (Level 2 -> Level 3 progression) and gives Hive full control over the orchestration layer while using Claude Code as the execution engine.

### Summary

| Criterion | Adopt | Wrap | Build Own |
|:----------|:------|:-----|:----------|
| Control | Low | Medium | Full |
| Stability | Experimental | Experimental | You own it |
| Multi-project | No (1 team/session) | No | Yes |
| Programmatic API | No | Partial (filesystem) | Full |
| UI integration | Poor (terminal-only) | Fair (monitor only) | Native |
| Implementation cost | Zero | Low | Medium |
| Long-term maintainability | Anthropic owns | Fragile wrapper | You own it |

**Recommendation:** Build Hive's own orchestration using `claude -p` as the execution engine. Steal the task file format, hook protocol, and subagent definition format from Agent Teams. Monitor Agent Teams evolution — if Anthropic adds a programmatic API (headless team creation, SDK integration), reassess wrapping.
