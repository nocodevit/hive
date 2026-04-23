# Multi-Agent Communication Research Report (Deep Dive)

**Date**: 2026-04-21
**Context**: Hive currently uses a dispatcher (index.ts) as middleman — all agent communication goes through PTY injection + HTTP webhooks. This report surveys 12 communication mechanisms with deep source-code-level analysis and proposes 3 plans.

---

## 1. Claude Code Agent Teams (Built-in)

**Source**: [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams)
**Enable**: `settings.json` → `"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}` (v2.1.32+)

### File Layout
```
~/.claude/teams/{team-name}/
  config.json                    # members [{name, agentId, agentType}]
  inboxes/{agent-name}.json      # per-agent inbox, JSON array

~/.claude/tasks/{task-list-id}/
  .lock                          # flock() mutual exclusion
  .highwatermark                 # next task ID
  {id}.json                      # one file per task
```

### Inbox Message Schema
```json
{
  "from": "agent-name",
  "text": "string (or serialized JSON for typed messages)",
  "summary": "optional short summary",
  "timestamp": "ISO-8601",
  "read": false
}
```
Message types embedded in `text`: `message`, `broadcast`, `task_assignment`, `shutdown_request`, `idle_notification`, `plan_approval_request/response`.

### Delivery Mechanism
**Pure file I/O.** Sender appends JSON entry to `~/.claude/teams/{team}/inboxes/{recipient}.json`. No IPC, no sockets. Recipients **poll their inbox file** — subsecond latency observed. File locking via `flock()` on `.lock` file.

### Task Schema
```json
{ "id": "1", "subject": "...", "description": "...", "status": "pending|in_progress|completed|deleted",
  "owner": "agent-name", "blocks": ["id"], "blockedBy": ["id"] }
```

### Custom Agent Compatibility
**Partially broken.** Issue [#23506](https://github.com/anthropics/claude-code/issues/23506): `--agent` gets SendMessage/TaskCreate but NOT the Task tool (subagent spawner). Issue [#24316](https://github.com/anthropics/claude-code/issues/24316): `.claude/agents/*.md` can be referenced but `skills` and `mcpServers` frontmatter ignored on teammates.

### Known Bugs (30+ open issues)
| Issue | Severity | Description |
|-------|----------|-------------|
| [#39651](https://github.com/anthropics/claude-code/issues/39651) | High | Messages from unrelated sessions delivered to wrong team leads |
| [#47396](https://github.com/anthropics/claude-code/issues/47396) | High | Zombie teammates: alive but process nothing; lead can't force-terminate |
| [#46691](https://github.com/anthropics/claude-code/issues/46691) | Medium | Lead stalls after teammates report back, requires keypress |
| [#44481](https://github.com/anthropics/claude-code/issues/44481) | Medium | 429/529 rate limit errors with concurrent teammates on Max plan |
| [#49786](https://github.com/anthropics/claude-code/issues/49786) | Medium | Teammates lack context compression, exhaust context window |
| [#1124](https://github.com/anthropics/claude-code-action/issues/1124) | Blocker | Completely unusable in SDK/headless mode |

### Real-World Stability
- Anthropic's own Claude Code Review (production): raised review coverage 16% → 54%
- Stress test: 16 agents built 100K-line C compiler, ~2000 sessions, $20K API cost
- **Verdict**: Works for parallel-independent tasks. Fragile for long-running autonomous runs (zombies, stalling, cross-session message leaks). Requires human monitoring.

---

## 2. claude-peers-mcp (Broker + SQLite)

**Source**: [github.com/louislva/claude-peers-mcp](https://github.com/louislva/claude-peers-mcp)
**Stars**: 1,915 | **Issues**: 41 | **Language**: TypeScript (Bun) | **Last update**: 2026-04-21

### Architecture
Singleton HTTP broker (`Bun.serve()`) on `127.0.0.1:7899` + SQLite.

**SQLite schema:**
- `peers`: `id TEXT PK, pid INTEGER, cwd TEXT, git_root TEXT, tty TEXT, summary TEXT, registered_at TEXT, last_seen TEXT`
- `messages`: `id INTEGER PK AUTOINCREMENT, from_id TEXT FK, to_id TEXT FK, text TEXT, sent_at TEXT, delivered INTEGER DEFAULT 0`

**Broker endpoints**: `/register`, `/heartbeat`, `/set-summary`, `/list-peers`, `/send-message`, `/poll-messages`, `/unregister`, `GET /health`

### Message Injection
Uses **Claude's experimental channel protocol** (`notifications/claude/channel`). MCP server declares `{ experimental: { "claude/channel": {} } }`. Claude Code launched with `--dangerously-load-development-channels server:claude-peers`.

Server polls broker every **1 second**, pushes via MCP notification:
```ts
mcp.notification({ method: "notifications/claude/channel",
  params: { content: msg.text, meta: { from_id, from_summary, from_cwd, sent_at } } })
```
Standard MCP notification over stdio — **no bracketed-paste bypass needed**. Content injected as `<channel>` tag in conversation.

### MCP Tools
| Tool | Parameters | Returns |
|------|-----------|---------|
| `list_peers` | `scope: "machine"\|"directory"\|"repo"` | Peer listing |
| `send_message` | `to_id: string, message: string` | Success/failure |
| `set_summary` | `summary: string` | Confirmation |
| `check_messages` | (none) | Undelivered messages |

### Delivery Guarantees
**At-most-once.** Marked `delivered=1` immediately on poll, before channel push confirms. No ack, no retry. Issue [#25](https://github.com/louislva/claude-peers-mcp/issues/25) requests explicit ack. Issue [#37](https://github.com/louislva/claude-peers-mcp/issues/37): messages lost when peers restart (stale cleanup deletes undelivered).

### Known Limitations
- No auth on broker API (issue #26)
- Messages lost on peer restart (issue #37)
- Windows broken: SQLite write locks (issue #31)
- No multicast/group messaging (issue #30)
- Broker SIGPIPE death on MCP teardown (issue #34)
- Requires `--dangerously-skip-permissions` + `--dangerously-load-development-channels`
- Requires claude.ai login (API key auth won't work for channels)

---

## 3. Agent Message Queue (AMQ) — File-Based Maildir

**Source**: [github.com/avivsinai/agent-message-queue](https://github.com/avivsinai/agent-message-queue)
**Stars**: 45 | **Language**: Go | **Last push**: 2026-04-13

### Directory Structure
```
<root>/agents/<agent>/inbox/{tmp,new,cur}/    # Maildir incoming
<root>/agents/<agent>/outbox/sent/            # sent copies
<root>/agents/<agent>/receipts/               # delivery receipts
<root>/agents/<agent>/dlq/{tmp,new,cur}/      # dead letter queue
```

### Message Format
JSON frontmatter + `---` + Markdown body:
```
schema, id, from, to, thread, subject, created, refs, priority, kind, labels, context, reply_to, reply_project
```

### Thread Continuity
P2P threads auto-generate as `p2p/<lower>__<higher>` (lexicographic). Threads span sessions via `thread` field. Replies reference parent via `refs`.

### Cross-Project Routing
`.amqrc` config with `project` name and `peers` map (absolute paths to peer `.agent-mail` roots). `reply_project` enables automatic return routing.

### Race Condition Handling
Two layers:
1. **Maildir atomic delivery**: write to `tmp/` with `O_EXCL`, `fsync`, then `os.Rename` to `new/`. Nanosecond timestamp + PID for uniqueness.
2. **Advisory file locking**: `unix.Flock` with `LOCK_EX` on separate lockfile.

### Claude Code Integration
Integrates as a **Skill** (not MCP). Install: `npx skills add avivsinai/agent-message-queue -g -y`. Terminal injection via `amq wake` using TIOCSTI (known to corrupt in-progress input, issue #95).

### Known Limitations
- `amq wake` TIOCSTI injection corrupts user input (issue #95)
- Designed for 2-3 agents, not a distributed broker
- Swarm bridge delivers task notifications only, not direct messages
- Windows: core works, `wake` requires WSL

---

## 4. AgentDM (MCP Cloud Platform)

**Source**: [agentdm.ai](https://agentdm.ai/)

Unique @alias identity per agent. MCP-based send/receive. Cross-platform (Claude-to-GPT possible).

**Pros**: Universal addressing, cross-platform
**Cons**: External service, privacy (messages through their servers), latency

---

## 5. Google A2A Protocol + claude-a2a wrapper

**Source**: [github.com/ericabouaf/claude-a2a](https://github.com/ericabouaf/claude-a2a)
**Stars**: 2 | **Commits**: 5 | **Last push**: Sep 2025

### Architecture
```
Client --HTTP POST--> Express Server --A2A SDK--> ClaudeCodeExecutor
  --> @anthropic-ai/claude-code query() --> async generator --> A2AResponse
```

**AgentCard** (served at `/.well-known/agent-card`):
```json
{ "name": "...", "capabilities": { "streaming": true, "pushNotifications": false },
  "defaultInputModes": ["text"], "protocolVersion": "0.3.0" }
```

Wraps Claude Code SDK `query()` with A2A task store. PostToolUse hook intercepts Write tool to publish file artifacts.

**Verdict**: Proof-of-concept. In-memory store, 5 commits, no tests, no auth. Not production-ready.

---

## 6. OpenCode Ensemble (Event-Driven Agent Teams)

**Source**: [github.com/hueyexe/opencode-ensemble](https://github.com/hueyexe/opencode-ensemble)
**Stars**: 49 | **Tests**: 482 | **Last push**: Apr 2026

### Architecture
```
Lead Agent (system prompt injected with team state every LLM call)
  +-- team_spawn --> Teammate A (isolated git worktree + OpenCode session)
  +-- team_spawn --> Teammate B
  +-- team_spawn --> Teammate C
  
Full-mesh P2P via JSONL inbox files
SQLite (WAL mode) for teams/members/tasks/messages
Dashboard at localhost:4747
```

### Session Injection (replaces file polling)
Messages append to `team_inbox/<projectId>/<teamName>/<agentName>.jsonl` (O(1) append). OpenCode's `promptAsync` injects messages directly as **synthetic user messages**, starting prompt loop atomically. No polling delay.

### Auto-Wake
Idle lead gets `autoWake()` → transitions to "running" → launches `SessionPrompt.loop()` via fire-and-forget.

### Crash Recovery
Three-step bootstrap: (1) register permission handler, (2) force-transition busy→ready + inject notification, (3) subscribe cleanup events. No automatic restart (prevents runaway API spend).

### Stale Detection
3 retry attempts at `SessionPrompt.cancel()` with 120ms spacing. 5min stall threshold → escalation.

### Message Format
```json
{"id": "msg_123", "from": "alice", "text": "validation complete", "timestamp": 1712345678000, "read": false}
```

**Verdict**: Late prototype / early production. 482 tests, crash recovery, dashboard. Single-process limitation.

---

## 7. Claude MPM (Multi-Channel Orchestration)

**Source**: [github.com/bobmatnyc/claude-mpm](https://github.com/bobmatnyc/claude-mpm)

47+ specialized agents, Telegram/Slack channel adapters. Remote agents via channel routing. 56 skills, plugin system.

**Pros**: Production-grade channel integration
**Cons**: Heavy (pip install), opinionated, may conflict with Hive

---

## 8. Redis Pub/Sub — AgentHub

**Source**: [github.com/RelientS/agenthub](https://github.com/RelientS/agenthub)
**Stars**: 0 | **Last update**: 2026-02-26 (abandoned)

**Misleading**: Despite Redis in stack, event bus is actually **in-process Go channels** (goroutines + mutexes), NOT Redis pub/sub. Redis used only for caching. Requires PostgreSQL + Redis + Docker Compose.

**Verdict**: Abandoned prototype. Not usable. Redis pub/sub claim is false.

---

## 9. NATS Messaging

**Source**: [nats.io](https://nats.io/)
**Stars**: 19,652 | **CNCF incubating** | **Battle-tested at scale**

### Key Features
- Single 20MB binary, <20MB RAM, zero dependencies
- Pub/sub + request/reply + streaming (JetStream)
- JetStream persistence: RAFT-based, memory or file storage, replay from sequence/timestamp
- Subject-based routing with wildcards: `hive.tasks.assign`, `hive.worker.{id}.status`
- Node.js client (`nats.ws` or `nats`) works in Electron

### NATS vs Redis for <10 agents
| | NATS | Redis |
|--|------|-------|
| Infra | Single binary | Separate process |
| Pub/sub persistence | JetStream (built-in) | None (messages lost if no subscriber) |
| Setup | Download + run | Install + configure |
| Memory | <20MB | ~30MB minimum |
| **Winner** | ✅ | |

**Electron suitability**: Excellent — embed `nats-server` binary in app, start on launch.
**Setup complexity**: 1/5

---

## 10. ai-consensus-mcp (Voting / Debate)

**Source**: [github.com/entropyvortex/ai-consensus-mcp](https://github.com/entropyvortex/ai-consensus-mcp)
**Stars**: 0 | **Created**: 2026-04-17 (4 days old)

### Mechanism
Multi-round structured debate (1-10 rounds, default 4). Blind first round → counterarguments → confidence scores → convergence check (delta ≤ 3) → optional judge synthesis.

MCP tool: `consensus(prompt, maxRounds, participantIds, earlyStop, judge, convergenceDelta, ...)`

### Token Cost
~20 LLM calls minimum per consensus (4 rounds × 5 participants). No budget enforcement.

**Verdict**: Zero adoption, interesting concept for decision quality, not coordination.

---

## 11. OpenClaw + Lobster (Deterministic Pipeline)

**Source**: [dev.to article](https://dev.to/ggondim/how-i-built-a-deterministic-multi-agent-dev-pipeline-inside-openclaw-and-contributed-a-missing-4ool)

YAML-defined deterministic workflows. LLMs do creative work, YAML handles plumbing. Loop support, sub-workflows.

**Verdict**: Good for CI/CD-style pipelines, not for ad-hoc agent communication.

---

## 12. wshobson/agents (184 Agents + Orchestrators)

**Source**: [github.com/wshobson/agents](https://github.com/wshobson/agents)

78 plugins, 16 orchestrators. Sonnet + Haiku delegation for cost optimization. Preset teams for review/debug/feature.

**Verdict**: Agent library, not communication infrastructure.

---

## 2. Comparison Matrix

| # | Solution | Delivery | Real-time | Persistence | Maturity | Effort | Electron-fit |
|---|----------|----------|-----------|-------------|----------|--------|-------------|
| 1 | Agent Teams | File poll | No (~1s) | File | ⭐⭐ (experimental, 30+ bugs) | Low | Good |
| 2 | claude-peers-mcp | MCP channel | Near (~1s) | SQLite | ⭐⭐⭐ (1.9K stars, 41 issues) | Medium | Good |
| 3 | AMQ (Maildir) | File poll | No | File (atomic) | ⭐⭐ (45 stars, solid Go code) | Medium | OK |
| 4 | AgentDM | Cloud API | Near | Cloud | ⭐⭐ (external dependency) | Low | OK |
| 5 | A2A/claude-a2a | HTTP | Yes | None | ⭐ (PoC, 2 stars) | High | Poor |
| 6 | OpenCode Ensemble | Session inject | Yes | SQLite+JSONL | ⭐⭐⭐ (482 tests) | High | Medium |
| 7 | Claude MPM | Channels | Near | DB | ⭐⭐⭐ (production) | High | Poor |
| 8 | Redis/AgentHub | In-memory | N/A | N/A | ⭐ (abandoned, misleading) | High | Poor |
| 9 | NATS | Push | Yes (<1ms) | JetStream | ⭐⭐⭐⭐⭐ (19.6K stars, CNCF) | Medium | Excellent |
| 10 | Consensus MCP | Debate | No | None | ⭐ (4 days old) | Low | Good (addon) |
| 11 | OpenClaw/Lobster | YAML pipe | No | File | ⭐⭐ | Medium | Poor |
| 12 | wshobson/agents | Delegation | No | File | ⭐⭐ | Low | OK |

---

## 3. Problems to Solve in Hive

1. **PTY injection unreliable** — `\r` not submitting, bracketed-paste, messages lost
2. **No peer-to-peer** — all through dispatcher (bottleneck, single point of failure)
3. **No message persistence** — PTY messages lost if agent not listening
4. **No delivery confirmation** — sendToAgent returns bool but no ack
5. **No structured messaging** — JSON strings in terminal, fragile parsing
6. **Polling overhead** — stuck detection, task status all poll-based
7. **No consensus** — Manager makes all decisions alone

---

## 4. Recommended Plans (Updated with Deep Research)

### Plan A: Claude Code Agent Teams + Hive UI Layer
**Approach**: Enable native Agent Teams. Use built-in `SendMessage` + `TaskCreate`. Hive becomes a UI dashboard reading filesystem state.

**Changes**:
- Enable flag in agent definitions
- Replace PTY injection `sendToAgent()` with Agent Teams filesystem writes
- Hive reads `~/.claude/teams/` and `~/.claude/tasks/` for UI display
- Keep Hive dispatcher for: notifications, stuck detection, daily report

**Effort**: 2-3 days
**Test difficulty**: Medium
**Quality stability**: ⭐⭐ — Experimental. 30+ open bugs including zombie agents, cross-session message leaks, lead stalling. Requires human monitoring. Custom agent compatibility partially broken.

**Pros**: Zero infrastructure, native Anthropic support, peer-to-peer
**Cons**: Experimental/unstable, many bugs, can't customize, file polling not real-time, teammate skills ignored

---

### Plan B: MCP Message Bus (claude-peers-mcp inspired)
**Approach**: Build Hive MCP server inside Electron process. Agents communicate via MCP tools. No PTY injection.

**Changes**:
- Build `hive-mcp-server` (Node.js, runs inside Electron)
- MCP tools: `hive_send(to, message)`, `hive_tasks()`, `hive_done(taskId, summary)`
- SQLite for message storage (like claude-peers-mcp but without broker daemon)
- Use MCP channel protocol for instant delivery (like claude-peers-mcp's `notifications/claude/channel`)
- Agent definitions add `mcpServers: { hive: { command: "...", args: [...] } }`
- Remove PTY injection + hive-report.sh entirely

**Effort**: 5-7 days
**Test difficulty**: High (MCP integration testing)
**Quality stability**: ⭐⭐⭐⭐ — MCP is stable protocol. SQLite reliable. Channel protocol proven (1.9K stars on claude-peers-mcp). But channel requires `--dangerously-load-development-channels` flag.

**Pros**: Structured messaging (no terminal hacks), persistent, delivery via MCP channel (no bracketed-paste), searchable history, extensible
**Cons**: MCP channel requires dangerous flags, significant engineering, each agent needs MCP config

---

### Plan C: NATS Embedded Message Bus
**Approach**: Embed `nats-server` binary in Hive Electron app. All agents communicate via NATS pub/sub. Real-time, persistent, battle-tested.

**Changes**:
- Bundle `nats-server` binary (~20MB) in Electron resources
- Start on app launch, stop on quit
- Hive dispatcher publishes: `hive.task.{id}.assigned`, `hive.task.{id}.done`, etc.
- Agent's `hive-report.sh` replaced by NATS publish (via `nats` CLI or Node.js client)
- JetStream for message persistence (survives crashes)
- Request/reply for synchronous calls (task-done → gate → result)
- UI subscribes to NATS for real-time updates (no polling)
- Add consensus tool via ai-consensus-mcp for group decisions (future)

**Effort**: 7-10 days
**Test difficulty**: Very High (event ordering, delivery guarantees, race conditions)
**Quality stability**: ⭐⭐⭐⭐⭐ — NATS is production-grade (19.6K stars, CNCF). JetStream persistence. Sub-millisecond latency. But complex integration.

**Pros**: Real-time (<1ms), persistent (JetStream), battle-tested at scale, wildcard routing, request/reply pattern, embeddable
**Cons**: Most complex, binary dependency (~20MB), overkill for <10 agents, NATS CLI needed in agent scripts

---

## 5. Final Recommendation

| Factor | Plan A (Agent Teams) | Plan B (MCP Bus) | Plan C (NATS) |
|--------|---------------------|-------------------|---------------|
| Effort | 2-3 days | 5-7 days | 7-10 days |
| Stability | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| PTY fix | ✅ eliminates | ✅ eliminates | ✅ eliminates |
| Persistence | ✅ file | ✅ SQLite | ✅ JetStream |
| Real-time | ❌ polling | ⚠️ near (channel) | ✅ sub-ms |
| Custom agents | ⚠️ partially broken | ✅ full control | ✅ full control |
| Hive control | ❌ Anthropic controls | ✅ we control | ✅ we control |

**Short-term**: Plan B (MCP) — solves all PTY problems, we control the code, proven patterns from claude-peers-mcp. 5-7 days.

**Long-term**: Plan C (NATS) — if scaling beyond 10 agents or need real-time dashboard. Can migrate from Plan B to C later.

**Avoid Plan A** for Hive — too many bugs, experimental, custom agent compatibility broken, we lose control.

---

## Sources

- [Claude Code Agent Teams Docs](https://code.claude.com/docs/en/agent-teams)
- [Reverse-engineering Agent Teams](https://dev.to/nwyin/reverse-engineering-claude-code-agent-teams-architecture-and-protocol-o49)
- [claude-peers-mcp](https://github.com/louislva/claude-peers-mcp) — 1,915 ⭐
- [Agent Message Queue](https://github.com/avivsinai/agent-message-queue) — 45 ⭐
- [AgentDM](https://agentdm.ai/)
- [claude-a2a](https://github.com/ericabouaf/claude-a2a) — 2 ⭐
- [OpenCode Ensemble](https://github.com/hueyexe/opencode-ensemble) — 49 ⭐, 482 tests
- [OpenCode Agent Teams article](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol)
- [Claude MPM](https://github.com/bobmatnyc/claude-mpm)
- [AgentHub (Redis)](https://github.com/RelientS/agenthub) — abandoned, misleading
- [NATS](https://nats.io/) — 19,652 ⭐, CNCF
- [ai-consensus-mcp](https://github.com/entropyvortex/ai-consensus-mcp) — 0 ⭐, 4 days old
- [OpenClaw/Lobster](https://dev.to/ggondim/how-i-built-a-deterministic-multi-agent-dev-pipeline-inside-openclaw-and-contributed-a-missing-4ool)
- [wshobson/agents](https://github.com/wshobson/agents)
- [Anthropic C compiler blog](https://www.anthropic.com/engineering/building-c-compiler)
- [IETF Messaging for Agentic AI](https://www.ietf.org/archive/id/draft-mpsb-agntcy-messaging-00.html)
