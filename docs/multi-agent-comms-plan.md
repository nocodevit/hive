# Multi-Agent Communication Plan

## Level 1: Shared Files (simplest, no code change)
- `.claude/comms/{from}-to-{to}.md` for direct messages
- `.claude/comms/broadcast.md` for all-agent announcements
- Soul instructs agents to check comms dir after each task
- Problem: passive, agents don't check proactively

## Level 2: Hive Webhook Relay (recommended first step)
- Agent completes task → hive-report.sh done "..."
- Hive checks: any agent waiting for this?
- Hive writes message into waiting agent's terminal via PTY
- Requires task dependency definitions in data.json
- Uses existing webhook server + PTY write, no new infra

## Level 3: MCP Server (best long-term)
- Each agent gets MCP tools:
  - `hive_send_message(to, message)` — send to another agent
  - `hive_check_messages()` — read incoming messages
  - `hive_get_agent_status(name)` — query status
  - `hive_get_agent_task(name)` — query current task
- Claude auto-decides when to communicate
- No soul instructions needed, Claude sees tools and uses them

## Level 4: Conductor Agent (most intelligent)
- Dedicated PM agent orchestrates all others
- Watches all agent statuses and task completions
- Auto-assigns next tasks based on dependency graph
- Reports rollup to CEO (user)
- Could use GStack's `/plan-eng-review` skill

## Recommendation
Start with Level 2 → graduate to Level 3 (MCP) when ready.
Level 2 requires: message queue in data.json, PTY write on task_done, dependency config in project settings.
