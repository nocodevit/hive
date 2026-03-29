# Multi-Agent Communication & Collaboration Patterns for Hive

**Date:** 2026-03-26
**Scope:** Research report on multi-agent communication approaches for an Electron desktop app (Hive) that manages multiple Claude Code AI agents, each running in its own node-pty terminal with its own git worktree.

---

## 1. Executive Summary

Hive's architecture -- Electron main process, node-pty terminals, git worktrees, Claude Code CLI agents -- constrains and informs the choice of inter-agent communication. This report evaluates 14 approaches across four dimensions (complexity, latency, reliability, scalability) and recommends a layered architecture:

1. **Foundation layer:** Electron IPC event bus (already native to the app) for all Hive-internal coordination.
2. **Agent-facing layer:** Local MCP server exposing communication tools (`hive_send`, `hive_status`, `hive_tasks`) so Claude Code agents can communicate without custom CLI hacks.
3. **Coordination layer:** Shared SQLite database for persistent task state, message history, and agent metadata.
4. **Optional future layer:** A2A protocol for cross-machine or cross-app agent collaboration.

This combination avoids external dependencies (no Redis, no RabbitMQ), keeps latency under 10ms for local operations, and leverages what Claude Code agents already understand (MCP tools).

---

## 2. Detailed Analysis of Each Approach

### 2.1 MCP Server (Model Context Protocol)

**Description:** Agents communicate via MCP tools exposed by a local server. Each Claude Code agent connects to the Hive MCP server and gets tools like `hive_send_message`, `hive_get_tasks`, `hive_report_status`.

**How it works technically:**
- Hive runs a local MCP server (stdio or HTTP transport).
- Each Claude Code agent is launched with `--mcp-config` pointing to the Hive server.
- The server exposes tools as JSON-RPC endpoints. When an agent calls `hive_send_message(to="frontend-agent", msg="API contract ready")`, the MCP server routes it via the Electron main process.
- MCP supports stdio (subprocess), SSE, and Streamable HTTP transports. For Hive, stdio is ideal since agents are local subprocesses.

**Pros:**
- Native to Claude Code -- agents understand MCP tools and use them autonomously without prompt engineering.
- No external dependencies; the server runs inside the Electron main process.
- Bidirectional: agents can both push and pull information.
- Tool descriptions guide agent behavior (e.g., "Call hive_check_messages before starting a new task").
- MCP is now an industry standard (97M+ monthly SDK downloads as of Feb 2026).

**Cons:**
- Requires implementing an MCP server (moderate effort, ~500 LOC with the TypeScript SDK).
- Agents decide when to call tools -- no guaranteed polling frequency.
- MCP is agent-to-tool, not agent-to-agent; requires Hive to act as router.
- Debugging MCP tool calls requires logging infrastructure.

**Relevance to Hive:** Very high. This is the most natural way for Claude Code agents to communicate. The agent already has MCP support built in. Hive simply needs to expose the right tools.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 3 | 2 | 4 | 4 |

---

### 2.2 Shared Filesystem

**Description:** Agents read/write to shared files or directories (e.g., `.claude/comms/`, `.hive/messages/`) for coordination.

**How it works technically:**
- A shared directory (e.g., `.hive/comms/`) contains files like `{from}-to-{to}.md` for direct messages and `broadcast.md` for announcements.
- Agents are instructed via system prompt or CLAUDE.md to check this directory periodically.
- File watchers (fs.watch / chokidar) in the Electron main process can detect changes and inject notifications into agent terminals via PTY write.

**Pros:**
- Zero infrastructure -- just files on disk.
- Human-readable; easy to debug by inspecting files.
- Works with any agent, not just Claude Code.
- Survives agent restarts (persistent).

**Cons:**
- Passive: agents must be told to check, and compliance is unreliable.
- Race conditions with concurrent writes (no built-in locking).
- No structured schema; parsing free-form markdown is fragile.
- Latency depends on polling frequency.
- File system watchers can be unreliable on some platforms.

**Relevance to Hive:** Medium. Good as a fallback or debugging mechanism, but insufficient as a primary communication channel. Already partially described in Hive's existing `multi-agent-comms-plan.md` as "Level 1."

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 1 | 4 | 2 | 2 |

---

### 2.3 Message Queue (Redis Pub/Sub, RabbitMQ)

**Description:** Agents publish and subscribe to message channels via an external message broker.

**How it works technically:**
- A Redis or RabbitMQ server runs locally.
- Each agent has a subscriber on its own channel (e.g., `agent:frontend`).
- When Agent A needs to message Agent B, it publishes to `agent:backend`.
- The Hive main process subscribes to all channels and can route/log messages.
- Redis pub/sub is fire-and-forget; RabbitMQ provides persistence and acknowledgments.

**Pros:**
- Battle-tested, high-throughput infrastructure.
- True pub/sub: broadcast to many agents simultaneously.
- Decoupled: publishers don't need to know about subscribers.
- Rich ecosystem of monitoring tools.

**Cons:**
- External dependency -- users must install Redis/RabbitMQ.
- Overkill for a desktop app with 3-10 local agents.
- Redis pub/sub is fire-and-forget (messages lost if no subscriber is listening).
- Adds operational complexity inappropriate for a consumer desktop app.
- Claude Code agents can't natively subscribe to Redis; requires wrapper scripts.

**Relevance to Hive:** Low. The overhead of an external message broker is unjustified for a local desktop app. Electron's built-in IPC and MCP tools achieve the same result with zero external dependencies.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 4 | 1 | 4 | 5 |

---

### 2.4 Webhook Relay (HTTP Endpoints)

**Description:** Agents communicate via HTTP POST requests to a local webhook server running inside Hive.

**How it works technically:**
- Hive runs a local HTTP server (e.g., on port 4747).
- Agents use shell scripts or curl to POST messages: `curl -X POST localhost:4747/api/message -d '{"to":"backend","msg":"done"}'`.
- The server routes messages to target agents by writing into their PTY.
- Can also use Server-Sent Events (SSE) for real-time push to web UI.

**Pros:**
- Simple to implement (Express.js or native http module).
- Agents can use curl/wget -- universally available.
- Integrates with existing webhook patterns.
- Can serve double duty as an API for external integrations.

**Cons:**
- Requires agents to know the endpoint URL and format.
- HTTP overhead for local communication (unnecessary serialization).
- Agents must execute shell commands to send messages (not native to Claude Code's tool system).
- No built-in discovery or capability negotiation.

**Relevance to Hive:** Medium-high. Already partially implemented in Hive's existing plan as "Level 2." Works well as a bridge mechanism, but MCP tools are strictly superior for Claude Code agents because they're native.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 2 | 2 | 3 | 3 |

---

### 2.5 Unix Domain Sockets / Named Pipes

**Description:** Agents communicate via Unix domain sockets (macOS/Linux) or named pipes (Windows) for low-latency IPC.

**How it works technically:**
- Hive creates a Unix domain socket at a known path (e.g., `/tmp/hive-{session}.sock`).
- Each agent process connects to the socket for bidirectional communication.
- Messages are framed (length-prefixed or newline-delimited JSON).
- Node.js `net.createServer` natively supports Unix sockets.

**Pros:**
- Extremely low latency (no TCP overhead, no network stack).
- No external dependencies -- built into Node.js and the OS.
- Bidirectional, persistent connections.
- More secure than TCP (filesystem permissions).

**Cons:**
- Claude Code agents can't natively connect to Unix sockets; requires wrapper.
- Platform differences (Unix sockets vs. named pipes on Windows).
- No built-in message routing, queuing, or persistence.
- Debugging is harder than HTTP or file-based approaches.
- Requires custom framing protocol.

**Relevance to Hive:** Low-medium. The performance benefits are irrelevant for the message volumes Hive deals with (tens of messages per minute, not thousands per second). The implementation complexity outweighs the marginal latency gains.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 3 | 1 | 3 | 3 |

---

### 2.6 SQLite Shared Database

**Description:** A local SQLite database serves as the shared state store for task status, messages, and agent metadata.

**How it works technically:**
- Hive creates a SQLite database (e.g., `~/.hive/state.db`).
- Tables: `agents` (id, name, status, worktree), `tasks` (id, assignee, status, dependencies), `messages` (from, to, content, timestamp).
- The Electron main process reads/writes via better-sqlite3 (synchronous) or sql.js.
- Agents interact with the database indirectly through MCP tools or webhook API.
- SQLite WAL mode allows concurrent readers with one writer.

**Pros:**
- ACID transactions -- no race conditions.
- Queryable: complex task dependency graphs, message history, agent status.
- Persistent across app restarts.
- Zero external dependencies.
- better-sqlite3 is synchronous and fast (~10us per read).

**Cons:**
- Single-writer limitation (fine for Hive's scale, but bottleneck at high concurrency).
- Agents can't query SQLite directly from the CLI; needs an API layer.
- Schema migrations needed as features evolve.
- Not a communication mechanism itself -- needs a notification layer on top.

**Relevance to Hive:** High. Excellent as the persistence and state layer. Should be used alongside MCP/IPC for notifications. Task state, message history, and agent metadata belong in SQLite.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 2 | 1 | 5 | 3 |

---

### 2.7 Event-Driven Bus (Electron IPC / EventEmitter)

**Description:** The Electron main process acts as a central event bus. All agent coordination flows through `ipcMain`/`ipcRenderer` and internal EventEmitters.

**How it works technically:**
- The main process maintains an `AgentBus` (EventEmitter or custom pub/sub).
- When Agent A completes a task, the PTY output parser detects the completion signal and emits `agent:task-done` on the bus.
- The bus checks dependencies and, if Agent B was waiting, writes a notification into Agent B's PTY.
- The renderer subscribes to bus events for UI updates (agent status, progress).
- Uses Electron's `ipcMain.handle` / `ipcRenderer.invoke` for renderer-to-main communication.

**Pros:**
- Zero external dependencies -- already built into Electron.
- Sub-millisecond latency within the same process.
- Natural integration with Hive's existing architecture.
- Type-safe with TypeScript interfaces.
- Synchronous option available (ipcRenderer.sendSync).

**Cons:**
- Single point of failure (main process crash kills all coordination).
- In-memory only -- events are lost if the app crashes.
- Not accessible to Claude Code agents directly (they can't call ipcRenderer).
- Tight coupling to Electron's process model.

**Relevance to Hive:** Very high. This is already the backbone of Hive's internal architecture. The key insight is that this layer coordinates Hive's internal processes, while MCP tools are the interface agents see. They're complementary, not competing.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 1 | 1 | 3 | 2 |

---

### 2.8 Git-Based Collaboration

**Description:** Agents commit to branches, create PRs, and review each other's work using git as the communication medium.

**How it works technically:**
- Each agent works in its own git worktree on a dedicated branch.
- When Agent A finishes a feature, it commits and pushes to a branch.
- The Hive orchestrator detects the push (via file watcher on `.git/refs` or post-commit hook).
- Agent B is instructed to review/merge Agent A's branch.
- Conflicts are resolved by a designated "merge agent" or by the orchestrator.

**Pros:**
- Natural for software development workflows.
- Built-in conflict detection and resolution.
- Full audit trail (git log).
- Agents already understand git operations.
- Worktree isolation prevents file conflicts.

**Cons:**
- High latency: commit-push-detect-pull cycle is slow (~seconds).
- Not suitable for real-time coordination (status updates, quick messages).
- Merge conflicts require sophisticated resolution.
- Agents may not reliably follow git conventions.
- Requires network access for push/pull (or local bare repo).

**Relevance to Hive:** Medium. Hive already uses git worktrees for isolation, which is excellent. But git-as-communication-channel is too slow for real-time coordination. Best used for artifact handoff (code), not for messaging.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 2 | 5 | 4 | 4 |

---

### 2.9 LangGraph / CrewAI / AutoGen Orchestration

**Description:** Python-based multi-agent frameworks that define agent roles, communication graphs, and task pipelines.

**How it works technically:**
- **LangGraph:** Graph-based workflow where agent interactions are nodes in a directed graph. Supports conditional branching, cycles, and stateful execution. Reached v1.0 in late 2025.
- **CrewAI:** Role-based model inspired by organizational structures. Agents have roles ("Frontend Developer", "QA Engineer"), goals, and backstories. Communication flows through defined crew hierarchies.
- **AutoGen:** Conversational agent framework where agents communicate through chat-like interactions. Supports group chat, nested conversations, and dynamic role switching.

**Pros:**
- Rich abstractions for agent roles, tasks, and workflows.
- Battle-tested in production systems.
- Large communities and ecosystem.
- Built-in support for structured outputs and tool usage.

**Cons:**
- Python-based -- requires bridging to Hive's TypeScript/Electron stack.
- Designed for API-based LLM calls, not CLI agent processes.
- Heavy abstraction layers that don't map to Hive's PTY-based architecture.
- Would require running a Python subprocess alongside Electron.
- Agents in these frameworks are API calls, not persistent terminal sessions.

**Relevance to Hive:** Low. These frameworks solve a different problem: orchestrating API-based LLM calls. Hive's agents are persistent CLI processes in terminals, not ephemeral API calls. Adopting these frameworks would require a fundamental architecture change. However, their design patterns (role specialization, task graphs, hierarchical orchestration) are valuable intellectual inputs.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 4 | 3 | 3 | 4 |

---

### 2.10 Google A2A (Agent-to-Agent) Protocol

**Description:** Open protocol for agent interoperability across vendors, frameworks, and organizations. Announced by Google in April 2025.

**How it works technically:**
- Agents publish "Agent Cards" (JSON at `/.well-known/agent.json`) advertising their capabilities.
- Communication uses JSON-RPC 2.0 over HTTP(S).
- Task lifecycle: submitted -> working -> input-required -> completed -> failed -> canceled.
- Supports synchronous request/response, streaming (SSE), and async push notifications.
- Agent discovery is automatic via Agent Cards.
- v0.3 added gRPC support and security card signing.

**Pros:**
- True agent-to-agent protocol (unlike MCP which is agent-to-tool).
- Vendor-agnostic: agents from different frameworks can collaborate.
- Rich task lifecycle management.
- 50+ technology partners (Atlassian, Salesforce, SAP, etc.).
- Now co-housed with MCP under the Linux Foundation's AAIF.

**Cons:**
- Designed for distributed, network-based agents -- overkill for local desktop.
- HTTP overhead unnecessary for same-machine communication.
- Still evolving (v0.3); breaking changes possible.
- No TypeScript SDK maturity comparable to MCP.
- Claude Code has no native A2A support.

**Relevance to Hive:** Low now, potentially high later. If Hive ever needs to coordinate with agents running on other machines or other AI platforms, A2A is the right protocol. For local-only communication between Claude Code agents, MCP is sufficient and simpler. Worth monitoring as a future integration point.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 4 | 3 | 4 | 5 |

---

### 2.11 OpenAI Swarm / Agents SDK Pattern

**Description:** Lightweight multi-agent framework based on two primitives: Agents (instruction sets with tools) and Handoffs (transferring control between agents).

**How it works technically:**
- An Agent encapsulates instructions + functions. When it can't handle a request, it performs a Handoff to a more suitable agent.
- Stateless execution: the `run()` function takes messages, returns messages, saves no state between calls.
- Triage pattern: an initial agent evaluates requests and routes them to specialists.
- The original Swarm was educational; replaced by OpenAI Agents SDK (production-grade) in March 2025.

**Pros:**
- Elegant simplicity: just agents and handoffs.
- No persistent state to manage.
- Easy to reason about: clear control flow.
- Triage pattern maps well to task routing.

**Cons:**
- Stateless design conflicts with Hive's persistent terminal sessions.
- OpenAI-specific; designed for their API ecosystem.
- No built-in support for parallel execution.
- Handoff model assumes sequential processing.

**Relevance to Hive:** Low for direct adoption, medium for pattern inspiration. The handoff concept is useful: when a "frontend agent" encounters a backend issue, it could hand off to the "backend agent." The triage pattern maps to a "PM agent" that routes tasks. These patterns can be implemented on top of Hive's MCP + IPC architecture.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 2 | 2 | 3 | 3 |

---

### 2.12 Anthropic's Claude Code Agent Teams

**Description:** Claude Code's built-in experimental feature for coordinating multiple Claude Code instances with shared task lists, inter-agent messaging, and a team lead.

**How it works technically:**
- One Claude Code session acts as team lead; spawns teammate sessions.
- Shared task list with states: pending, in-progress, completed. Tasks can have dependencies.
- Teammates communicate via a mailbox system (direct messages and broadcasts).
- Task claiming uses file locking to prevent race conditions.
- Team config stored at `~/.claude/teams/{team-name}/config.json`.
- Task lists stored at `~/.claude/tasks/{team-name}/`.
- Display modes: in-process (Shift+Down to cycle) or split panes (tmux/iTerm2).
- Hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted` for quality gates.

**Pros:**
- First-party support from Anthropic -- designed for exactly this use case.
- Agents understand the team paradigm natively.
- Shared task list with dependency management.
- Direct inter-agent messaging without custom infrastructure.
- Plan approval workflow (read-only planning until lead approves).

**Cons:**
- Experimental and disabled by default.
- No session resumption with in-process teammates.
- One team per session; no nested teams.
- Lead is fixed; can't transfer leadership.
- Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag.
- Hive would need to adapt its PTY management to work with Agent Teams.

**Relevance to Hive:** Very high but complex. Agent Teams solves the exact problem Hive addresses, but at the CLI level. Hive could either: (a) build on top of Agent Teams, providing a GUI for the team lead, or (b) reimplement the key patterns (shared task list, mailbox, dependency tracking) with better UI integration. Option (b) gives Hive more control over the UX.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 3 | 2 | 3 | 4 |

---

### 2.13 Conductor/Orchestrator Agent Pattern

**Description:** A dedicated "PM" or "conductor" agent oversees all other agents, manages task assignment, monitors progress, and synthesizes results.

**How it works technically:**
- One agent (the conductor) runs with elevated context: it sees all agents' statuses, the task dependency graph, and project goals.
- The conductor doesn't write code itself; it delegates, reviews, and coordinates.
- It watches for task completions (via event bus or polling) and assigns next tasks.
- Can escalate decisions to the human user when needed.
- Inspired by ChatDev's "CEO/CTO/Programmer" hierarchy and MetaGPT's "Product Manager" role.

**Pros:**
- Centralized intelligence for decision-making.
- Natural mapping to real-world team structures.
- Single point of coordination reduces conflicts.
- Can implement sophisticated scheduling (critical path, load balancing).
- Research shows hierarchical orchestration is most effective for SE tasks.

**Cons:**
- Single point of failure.
- Conductor agent consumes tokens even when idle.
- Bottleneck if all agents need conductor approval.
- Requires careful prompt engineering for the conductor's instructions.

**Relevance to Hive:** High. This maps directly to Hive's existing "soul" concept. The conductor can be either an AI agent (Claude Code instance with special instructions) or a code-based orchestrator in the Electron main process. A hybrid approach -- code-based scheduling with AI-based decision-making -- is recommended.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 3 | 2 | 3 | 3 |

---

### 2.14 PTY-Injection Pattern (Terminal Write-Back)

**Description:** The Hive main process writes messages directly into agents' terminal input streams via node-pty's `write()` method.

**How it works technically:**
- When Agent A completes a task, the Electron main process detects this (via output parsing or webhook).
- The main process calls `agentB.pty.write("Agent A has completed the API design. You can now proceed with implementation.\n")`.
- This appears as if a human typed into the agent's terminal.
- Can also inject tool results, context updates, or redirection commands.

**Pros:**
- Zero infrastructure -- uses existing PTY connections.
- Immediate delivery -- sub-millisecond latency.
- Agents perceive injected text as human input (high compliance).
- Already possible in Hive's current architecture.
- No MCP server needed.

**Cons:**
- Fragile: injected text must be carefully timed (can interrupt agent mid-thought).
- No acknowledgment mechanism (fire-and-forget).
- Can confuse the agent if injected at the wrong time.
- Not structured: free-form text, no schema.
- Doesn't scale well to complex multi-agent conversations.

**Relevance to Hive:** High for simple notifications, low for complex coordination. Best used as the "last mile" delivery mechanism: Hive decides what to communicate (via event bus + SQLite), then delivers it by writing into the PTY. Should not be the primary coordination logic.

| Complexity | Latency | Reliability | Scalability |
|:---:|:---:|:---:|:---:|
| 1 | 1 | 2 | 1 |

---

## 3. Industry Analysis: How AI Coding Tools Handle Multi-Agent Coordination

### Cursor
- Runs subagents in parallel but **agents cannot communicate with each other**.
- Each agent works independently; results are merged by the main session.
- No shared task list or inter-agent messaging.

### Windsurf (Cognition/Devin)
- Acquired by Cognition (Devin's parent) in Dec 2025.
- Supports 5 parallel agents as of Feb 2026.
- Devin uses **isolated virtual machines** per agent with sandboxed environments.
- Multi-agent dispatch: one agent can dispatch tasks to others.
- Session management includes fork, rollback, and machine snapshots.

### Claude Code Agent Teams
- Most sophisticated: shared task lists, direct messaging, dependency tracking.
- See Section 2.12 for full analysis.

### Common Patterns Across Tools
- All use **isolation** (worktrees, VMs, or separate contexts) to prevent conflicts.
- All launched multi-agent features in the same Feb 2026 window.
- None currently support cross-tool agent communication (e.g., Cursor agent talking to Claude Code agent).

### Academic Research Findings
- The arxiv survey (2404.04834) of 94 papers found **Role-Based Cooperation** is the most common design pattern.
- **Hybrid communication** (centralized orchestration + decentralized peer messages) works best.
- **Shared knowledge repositories** reduce communication overhead and inconsistencies.
- The Agyn system resolves 72.2% of SWE-bench tasks using organizational modeling (PM, developers, reviewers).

---

## 4. Comparison Matrix

| # | Approach | Complexity | Latency | Reliability | Scalability | Hive Fit |
|---|---------|:---:|:---:|:---:|:---:|:---:|
| 1 | MCP Server | 3 | 2 | 4 | 4 | **5** |
| 2 | Shared Filesystem | 1 | 4 | 2 | 2 | 2 |
| 3 | Message Queue (Redis) | 4 | 1 | 4 | 5 | 1 |
| 4 | Webhook Relay | 2 | 2 | 3 | 3 | 3 |
| 5 | Unix Sockets / Pipes | 3 | 1 | 3 | 3 | 2 |
| 6 | SQLite Shared DB | 2 | 1 | 5 | 3 | **5** |
| 7 | Electron IPC / EventBus | 1 | 1 | 3 | 2 | **5** |
| 8 | Git-Based Collaboration | 2 | 5 | 4 | 4 | 3 |
| 9 | LangGraph/CrewAI/AutoGen | 4 | 3 | 3 | 4 | 1 |
| 10 | Google A2A Protocol | 4 | 3 | 4 | 5 | 2 |
| 11 | OpenAI Swarm Pattern | 2 | 2 | 3 | 3 | 2 |
| 12 | Claude Code Agent Teams | 3 | 2 | 3 | 4 | 4 |
| 13 | Conductor Agent | 3 | 2 | 3 | 3 | **5** |
| 14 | PTY Injection | 1 | 1 | 2 | 1 | 4 |

**Scale:** 1 = worst, 5 = best. For Complexity, 1 = simplest. For Latency, 1 = fastest.

---

## 5. Recommended Architecture for Hive

### Layer Diagram

```
+------------------------------------------------------------------+
|                        Hive Electron App                         |
|                                                                  |
|  +--------------------+    +-------------------------------+     |
|  |   Renderer (React) |    |     Main Process              |     |
|  |                    |    |                               |     |
|  |  Agent Dashboard   |<-->|  AgentBus (EventEmitter)      |     |
|  |  Task Board        |IPC |  TaskScheduler                |     |
|  |  Message Log       |    |  MCP Server (stdio)           |     |
|  |                    |    |  SQLite (better-sqlite3)       |     |
|  +--------------------+    +-------+---+---+---------------+     |
|                                    |   |   |                     |
|                    +---------------+   |   +---------------+     |
|                    |                   |                   |     |
|              +-----v-----+    +-------v-----+    +--------v--+  |
|              | Agent A    |    | Agent B     |    | Agent C   |  |
|              | node-pty   |    | node-pty    |    | node-pty  |  |
|              | worktree/a |    | worktree/b  |    | worktree/c|  |
|              | MCP client |    | MCP client  |    | MCP client|  |
|              +-----------+    +-------------+    +-----------+  |
+------------------------------------------------------------------+
```

### Layer 1: Electron IPC Event Bus (internal backbone)

**Purpose:** All Hive-internal coordination.

```typescript
// Main process
class AgentBus extends EventEmitter {
  emit(event: 'agent:task-done', payload: { agentId: string, taskId: string })
  emit(event: 'agent:message', payload: { from: string, to: string, content: string })
  emit(event: 'agent:status-change', payload: { agentId: string, status: AgentStatus })
}
```

- PTY output parser detects completion signals, emits events.
- TaskScheduler listens for `agent:task-done`, checks dependency graph, activates next tasks.
- Renderer subscribes via `ipcRenderer.on` for real-time UI updates.

### Layer 2: MCP Server (agent-facing interface)

**Purpose:** Give Claude Code agents tools to communicate.

Tools to expose:
| Tool | Description |
|------|-------------|
| `hive_send_message` | Send a message to another agent by name |
| `hive_broadcast` | Send a message to all agents |
| `hive_get_messages` | Retrieve unread messages for the calling agent |
| `hive_report_status` | Report task completion or blockers |
| `hive_get_task` | Get details of assigned task |
| `hive_get_agent_status` | Query another agent's current status |
| `hive_list_agents` | List all active agents and their roles |

Implementation: Use `@modelcontextprotocol/sdk` TypeScript package. The MCP server runs as a module inside the Electron main process. Each agent is launched with:
```bash
claude --mcp-config '{"hive":{"command":"node","args":["hive-mcp-server.js"],"transport":"stdio"}}'
```

### Layer 3: SQLite Persistence (state & history)

**Purpose:** Persistent task state, message history, agent metadata.

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  status TEXT DEFAULT 'idle',
  worktree_path TEXT,
  current_task_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT REFERENCES agents(id),
  status TEXT DEFAULT 'pending',
  depends_on TEXT, -- JSON array of task IDs
  created_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT REFERENCES agents(id),
  to_agent TEXT, -- NULL = broadcast
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
```

### Layer 4: PTY Injection (last-mile delivery)

**Purpose:** Notify agents of urgent events when they're not actively calling MCP tools.

- Used sparingly: only for high-priority interrupts (e.g., "Stop: Agent B found a critical bug in your module").
- Timed carefully: only inject during agent idle states (detected by output parser).

### Layer 5 (Future): A2A Protocol

**Purpose:** Cross-machine agent collaboration, integration with external AI platforms.

- Not needed for v1. Monitor the protocol's maturation under the Linux Foundation's AAIF.
- Implement when Hive needs to coordinate with remote Devin instances, cloud-hosted agents, or other AI tools.

---

## 6. Implementation Roadmap

### Phase 1: Foundation (1-2 weeks)
1. Implement `AgentBus` EventEmitter in the main process.
2. Add SQLite database with `agents`, `tasks`, `messages` tables using `better-sqlite3`.
3. Build PTY output parser to detect task completion signals.
4. Wire up: PTY parser -> AgentBus -> TaskScheduler -> SQLite state updates.

### Phase 2: MCP Server (1-2 weeks)
5. Implement Hive MCP server using `@modelcontextprotocol/sdk`.
6. Expose `hive_send_message`, `hive_get_messages`, `hive_report_status`, `hive_get_task`.
7. Launch each Claude Code agent with `--mcp-config` pointing to the Hive MCP server.
8. Test: Agent A sends message -> Hive routes -> Agent B receives via `hive_get_messages`.

### Phase 3: Task Orchestration (1-2 weeks)
9. Implement TaskScheduler with dependency graph resolution.
10. Add `hive_get_agent_status`, `hive_list_agents`, `hive_broadcast` MCP tools.
11. Build conductor logic (code-based, not AI-based initially): auto-assign tasks when dependencies resolve.
12. Wire task board UI to SQLite state via Electron IPC.

### Phase 4: Conductor Agent (1 week)
13. Add option to designate one Claude Code agent as conductor with special system prompt.
14. Conductor gets additional MCP tools: `hive_assign_task`, `hive_create_task`, `hive_get_all_statuses`.
15. Test end-to-end: user describes project -> conductor breaks into tasks -> agents execute -> conductor synthesizes.

### Phase 5: Polish & Reliability (1 week)
16. Add message persistence and replay (SQLite).
17. Implement agent restart recovery (reload state from SQLite).
18. Add monitoring: token usage per agent, task completion times, message throughput.
19. Implement `TeammateIdle`-style hooks for quality gates.

---

## 7. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary agent interface | MCP tools | Native to Claude Code; agents use them autonomously |
| Internal coordination | Electron IPC EventBus | Zero overhead, already in the architecture |
| Persistence | SQLite (better-sqlite3) | ACID, queryable, zero deps, synchronous API |
| Message delivery | MCP pull + PTY push for urgents | Balanced: agents pull when ready, get pushed when critical |
| Task scheduling | Code-based first, AI conductor optional | Deterministic scheduling is more reliable than AI-based |
| External protocols | None now, A2A later | Premature optimization; local-only for v1 |
| Framework adoption | None (LangGraph, CrewAI, etc.) | Wrong abstraction level for PTY-based CLI agents |

---

## Sources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [2026 MCP Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP vs A2A: The Complete Guide to AI Agent Protocols in 2026](https://dev.to/pockit_tools/mcp-vs-a2a-the-complete-guide-to-ai-agent-protocols-in-2026-30li)
- [Google A2A Protocol Announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [A2A Protocol GitHub](https://github.com/a2aproject/A2A)
- [Claude Code Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
- [OpenAI Swarm Framework](https://github.com/openai/swarm)
- [ccswarm: Claude Code Multi-Agent Orchestration](https://github.com/nwiizo/ccswarm)
- [LangGraph vs CrewAI vs AutoGen Comparison (DataCamp)](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [Claude Agent SDK Best Practices 2025](https://skywork.ai/blog/claude-agent-sdk-best-practices-ai-agents-2025/)
- [Devin 2.0 Technical Design](https://medium.com/@takafumi.endo/agent-native-development-a-deep-dive-into-devin-2-0s-technical-design-3451587d23c0)
- [Devin 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [LLM-Based Multi-Agent Systems for SE (arxiv)](https://arxiv.org/abs/2404.04834)
- [Agyn: Multi-Agent System for Autonomous SE (arxiv)](https://arxiv.org/abs/2602.01465)
- [Git Worktrees for Parallel AI Coding](https://nx.dev/blog/git-worktrees-ai-agents)
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [SQLite Threading and Multi-Process](https://sqlite.org/threadsafe.html)
- [Node.js IPC via Unix Domain Sockets](https://gist.github.com/Xaekai/e1f711cb0ad865deafc11185641c632a)
- [Redis Pub/Sub Documentation](https://redis.io/docs/latest/develop/pubsub/)
- [Multi-Agent Orchestration: Running 10+ Claude Instances in Parallel](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da)
- [Shipyard: Multi-Agent Orchestration for Claude Code](https://shipyard.build/blog/claude-code-multi-agent/)
