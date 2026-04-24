<div align="center">

<img src="resources/icon.png" width="128" alt="Hive icon" />

# Hive

**Your AI agents deserve an office.**

A macOS desktop app to manage multiple [Claude Code](https://claude.ai/claude-code) agents — each with its own soul, skills, and workspace.

[![GitHub stars](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive/stargazers)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-purple.svg)](LICENSE)
[![Beta](https://img.shields.io/badge/status-beta-orange.svg)]()
[![macOS](https://img.shields.io/badge/platform-macOS-blue.svg)]()

![Hive — Full app view with soul-injected agent terminal](docs/screenshot-full.png)
*Three-column layout: Projects, Agents by department, and Terminal with soul-injected Claude Code session*

[Download](#getting-started) · [Features](#features) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

---

## Why Hive?

Running multiple Claude Code instances means juggling terminal tabs, losing context, and zero visibility into what each agent is doing. Hive fixes that.

| Without Hive | With Hive |
|---|---|
| 5 terminal tabs, which one is which? | Named agents organized by department |
| Every agent is the same generic assistant | Each agent has a soul — personality, role, boundaries |
| No idea what each agent is working on | Real-time status via hooks, work logs, dashboard |
| Skills scattered everywhere | Visual skill browser, toggle per agent |
| Restart = context lost | Persistent memory per agent |

## Screenshots

### Project Dashboard
![Dashboard with R&D todos, agent kanban, and project status](docs/screenshot-dashboard.png)
*Glassmorphism R&D and Admin cards scan your project's markdown files for todos. Agent kanban shows real-time status with pixel avatars. Project stage (Active/Incubating/Early Stage) auto-detected from git activity.*

### Agent Board
![Agent kanban showing working, waiting, and idle agents with task titles](docs/screenshot-agents.png)
*Agents grouped by status. Each card shows avatar, role, department, and current task title. Task summaries auto-reported by Claude via hooks.*

### Agent Editor
![Agent editor with pixel avatar, department/role selector, and soul config](docs/screenshot-editor.png)
*Configure identity (name, department, role), customize pixel avatar (skin, hair, clothes, accessories), and write soul.md to define personality and boundaries. Tabbed interface: Basic, Skills, Settings.*

### Work Logs
![Work logs grouped by task with start/done badges and status timeline](docs/screenshot-worklog.png)
*Activity grouped by task blocks. Each task shows title (START badge), summary (DONE badge), and status timeline. Persistent across sessions.*

### Soul in Action
![Claude Code responding as Daisy, the UI/UX specialist, with injected personality](docs/screenshot-full.png)
*Native `--agent` integration. Claude responds in character — "I'm Daisy, your UI/UX specialist" — with role-specific knowledge, skills, and personality.*

## Features

### Native Claude Code Agent Integration
Each agent is a native Claude Code `--agent` definition (`.claude/agents/hive-{id}.md`). Includes personality, tools, model, effort level, skills, and status hooks — all in one file. Session resume via `claude -c`. No custom workarounds.

### Agent Template System
8 built-in role templates (Full-Stack Engineer, Product, QA, Design, Admin, Marketing, BA, Operations) with structured sections: Role, Workflow, Boundaries, Custom. Create from template, customize, or import .md files. Save custom templates for reuse. Project CLAUDE.md auto-loads into Custom section.

### Split Soul Editor
Left-right split: write markdown on the left, see rendered preview on the right. Real-time updates as you type.

### Default Skills per Department
Configure global default skills for R&D and Non-R&D agents in Project Settings. New agents auto-inherit defaults. Override per agent during creation.

### Template Editor
Edit any template (built-in or custom) from Project Settings. Modify sections, skills, model, effort with live preview. "Save + Sync Agents" updates all agents using that role.

### HiveChat — Crush-styled React chat ✨ *new in v1.7*

After three dead-end pivots (handrolled ANSI parser → `@xterm/headless` → xterm decoration overlays), we finally found the right door — **`claude --print --output-format stream-json`**. Same idea [Crush](https://github.com/charmbracelet/crush) uses in Go, now in React.

Each agent's chat is a structured event stream, rendered as typed components:

- **Streaming typewriter** via `content_block_delta` — live token-by-token rendering
- **Colored ToolBlocks** — Bash (Malibu blue) · Read/Edit/Grep (Julep green) · Task/Agent (Dolly pink) · Todo (Charple) · MCP (Mochi) · Web (Violet)
- **Edit diff panel** — before/after in Julep-plus / Sriracha-minus split with gutter line numbers
- **Syntax-highlighted Read results** via prism-react-renderer, Crush theme
- **Markdown tables** rendered in Crush style, with code-fence highlighting
- **Clickable choices** — numbered *and* letter (`A) ...`, `B) ...`), fullwidth parens supported
- **Permission modal** — deny / allow-once / allow-and-remember, wired through `control_request` ⇄ `control_response` stdio handshake
- **Real subscription %%** — scraped from interactive `/usage` TUI via node-pty, no guessing
- **Session resume** — full JSONL replay from `~/.claude/projects/<cwd>/<sid>.jsonl`
- **Runtime redaction** — masks `meiyang` → `m****g`, bearer tokens, common secrets
- **Thinking spinner** — Charple → Dolly scrolling gradient, verified against Crush's `makeGradientRamp` source
- **IME-safe enter** — no accidental send mid-pinyin composition
- **371 tests passing** — every pure helper covered

The ride was not graceful. The lessons live in `docs/slides-hivechat-journey.html` (14-slide journey deck) — 4 pivots, 40+ commits, one lost afternoon to a Zod schema we had to recover from a captured log.

### Multiple Agent Terminals
Run N Claude Code sessions side by side. Click to switch. Each terminal persists — switch between agents without losing state. Auto-run Claude on terminal open.

### Agent Roles & Departments
- **R&D**: Engineering, Product, QA, Design
- **Non-R&D**: Admin, HR, Marketing, BA, Operations, GM
- 12 personality traits: Detail-oriented, Creative, Analytical, Security-first, etc.

### Pixel Avatar Editor
Customize each agent's appearance: skin tone, hair style/color, top/bottom style/color, hat, and accessories (glasses, headset, backpack). Randomize button for quick setup.

### GStack Skills Integration
Browse and toggle [GStack](https://github.com/garrytan/gstack) skills per agent. Expand any skill to read the full SKILL.md content. Skills auto-linked to agent's working directory.

### Project Dashboard
![Dashboard with analytics, commit density, and agent work time](docs/screenshot-dashboard-v2.png)
*Unified todo list, task group stats, 7-day commit density per agent, and agent work time tracking.*

- **Unified todo list** — All todos in one scannable table with zone tags (R&D / Admin / Ops)
- **Agent kanban** — Working / Waiting / Idle columns with avatars and task titles
- **Project status** — Auto-detected: Active Online, Active, Incubating, Early Stage
- **Project drag-and-drop** — Reorder projects by dragging in the sidebar
- **Right-click context menu** — (Re)start all agents in a project

### Task Group Orchestration
![Task Group with agent roster, batch history, and activity log](docs/screenshot-taskgroup.png)
*Agent roster (vertical list with role emoji, department, stats), collapsible batch history, and structured activity log.*

Coordinate multiple agents on a shared task list with Manager (👑), Worker (🔧), QA (🛡️), Critic (⚖️) roles:
- **Batch workflow** — Manager reads todo.md → proposes batches → human approves (or auto-approve) → workers execute in parallel
- **Batch history** — All batches visible, collapsible with dates. Task table: Worker | Task ID | Summary | Result
- **Activity log** — Timeline: Who | Time | Action | Content, color-coded by action type (create/assign/done/blocked/abandoned)
- **Auto-approve mode** — Approve once, all subsequent batches auto-approved until stopped
- **Gate verification** — Scope warnings only (not blocking). Workers run verify[] themselves for full output visibility
- **Stuck detection** — Max 3 notifications per task, then silent polling. Skips agents waiting for 5h limit reset
- **5-hour limit auto-whip** — Detects "You've hit your limit" in PTY output, parses reset time, auto-restarts agent
- **Task abandon** — Manager-only, reason required. Shows in batch as 🚫 with reason tooltip
- **Task notes** — Optional special instructions per task (📌 indicator)
- **Daily report** — Toggle per task group. Dispatcher triggers Manager at 00:01 to write daily summary + tomorrow's plan
- **Staging/UAT branch** — Configurable target branch. Auto-created on task group setup. Workers forced to push + rebase before task-done
- **Forced git push** — `hive-report.sh task-done` auto-commits, rebases on staging, pushes. No push = no done.

![Batch proposal with Approve / Always Approve / Reject](docs/screenshot-taskgroup-proposal.png)
*Batch proposal card appears above the batch list. Three actions: Approve, Always Approve (enables auto-mode), Reject.*

### Task Reporting
Claude auto-reports task start (title) and completion (summary) via `.claude/hive-report.sh`. Displayed in agent title bar, kanban cards, and grouped work logs.

### Status Hooks
Claude Code hooks report agent status to Hive via localhost webhook (port 17710). `PreToolUse` → working, `Stop` → idle. Deduped — only status changes are logged.

### Git Worktree Isolation
When creating a project, you can **git clone** a repo directly into an R&D folder (supports GitHub and GitLab with token auth for private repos). When a coding agent is assigned to a git-enabled R&D folder and launched:

1. Hive creates a **sibling worktree** directory: `{repo}-{agent-name}/`
2. A dedicated branch `hive/{agent-name}-{id}` is created from HEAD
3. The agent works entirely within its own worktree — no merge conflicts between agents
4. Worktree and branch are auto-removed when the agent is deleted

### File Explorer
![File Explorer with path and branch tag](docs/screenshot-file-explorer.png)
*Path display + 🌿 branch tag under File Explorer title. Tree-view with VSCode-style icons.*

Tree-view file browser in right sidebar. Path + current git branch displayed under title. Collapsible directories, VSCode-style icons (colored letters for code, emoji for media/docs). Click `.md` files to open split editor + live preview (GFM tables, task lists, code blocks). Drag files to terminal to insert path. Supports Finder drag-drop.

### Team Management
Organize agents into teams within departments. `+ Team` button opens modal to name a team and select ungrouped agents. Drag agents between teams or drop to ungroup. Reorder agents via drag-and-drop. Agents cannot move across departments.

### Auto Rebase on Restart
R&D agents with worktrees automatically `git fetch && rebase` when restarted (not on first launch). Detects base branch: prefers `develop` > `main` > `master`. Toggle in App Settings.

### Agent Memory
Each agent has isolated persistent memory at `~/.hive/memory/{agentId}/`. Symlinked to working directory. Keyed by ID, survives renames.

### Work Logs
Permanent activity log per agent. Tasks grouped with START/DONE badges. Status timeline. Refresh and Clear All controls.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          Hive App                              │
│                                                                │
│  ┌──────────┬─────────────┬────────────────────┬─────────────┐ │
│  │ Projects │   Agents    │  Terminal / Editor  │   Files     │ │
│  │          │             │                    │             │ │
│  │ Alex  ●  │ R&D         │  $ claude          │  app.tsx    │ │
│  │          │  David  ENG │    --agent hive-xxx │  style.css  │ │
│  │          │  Daisy  DES │    -c -n "david"   │  .env.local │ │
│  │          │  Drake  QA  │                    │             │ │
│  │  [+ Add] │    [+ New]  │  [native agent]    │  [search]   │ │
│  └──────────┴─────────────┴────────────────────┴─────────────┘ │
│                                                                │
│  Electron · React · xterm.js · node-pty                        │
└────────────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
  ~/.hive/                    .claude/agents/hive-{id}.md
  ├── data.json               (native agent definition with
  ├── memory/{agentId}/        hooks, skills, model, effort)
  └── logs/{agentId}.json            │
                              localhost:17710 (webhook)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 35 |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Terminal | xterm.js + node-pty *(same as VS Code & Cursor)* |
| Build | Vite + electron-vite |
| Theme | Purple primary, light/dark, CSS custom properties |
| Fonts | Space Grotesk + DM Sans |

## Getting Started

### Prerequisites

- macOS (Apple Silicon or Intel)
- Node.js 20+
- [Claude Code](https://claude.ai/claude-code) CLI installed

### Download (macOS)

| Version | Description | Download |
|---------|-------------|----------|
| v0.9.27-beta | Staging/UAT workflow, dashboard analytics, activity log, batch history, auto-whip, forced push | [DMG (Apple Silicon)](https://github.com/nocodevit/hive/releases/tag/v0.9.27-beta) |
| v0.8.0-beta | Task group orchestration, gate verification, stuck detection | [DMG (Apple Silicon)](https://github.com/nocodevit/hive/releases/tag/v0.8.0-beta) |
| v0.6.0-beta | Team management, drag-drop, auto rebase, markdown preview, GM template | [DMG (Apple Silicon)](https://github.com/nocodevit/hive/releases/tag/v0.6.0-beta) |
| v0.5.0-beta | File explorer tree, git clone, GitHub/GitLab tokens, scroll fix | [DMG (Apple Silicon)](https://github.com/nocodevit/hive/releases/tag/v0.5.0-beta) |
| v0.4.0-beta | Native --agent, templates, split editor, session resume | [DMG (Apple Silicon)](https://github.com/nocodevit/hive/releases/tag/v0.4.0-beta) |
| v0.3.0-beta | Office viz, files panel, resizable, job pickup | [Release](https://github.com/nocodevit/hive/releases/tag/v0.3.0-beta) |
| v0.2.0-beta | Soul injection, task reporting, avatar editor, worktree | [Release](https://github.com/nocodevit/hive/releases/tag/v0.2.0-beta) |

Or via Homebrew:
```bash
brew install --cask nocodevit/tap/hive
```

> First launch: Right-click → Open, or run `xattr -cr /Applications/Hive.app`

### Build from Source

```bash
git clone https://github.com/nocodevit/hive.git
cd hive
npm install
npm run dev
```

### Install GStack Skills (Optional)

```bash
brew install oven-sh/bun/bun
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

Restart Hive — skills appear in Agent Editor under the Skills tab.

## How It Works

1. **Create a Project** — Point to your R&D and Non-R&D folders
2. **Add Agents** — Pick a department, role, personality traits
3. **Soul auto-generates** — Based on name + role + traits
4. **Start working** — Click an agent, Claude launches with native `--agent` flag
5. **Resume anytime** — `claude -c` restores full conversation context
6. **Monitor** — Dashboard shows status, kanban, todos. Logs track everything.

## Data Storage

| Data | Location |
|------|----------|
| Projects & Agents | `~/.hive/data.json` |
| Agent Definitions | `{project}/.claude/agents/hive-{agentId}.md` |
| Agent Memory | `~/.hive/memory/{agentId}/` |
| Work Logs | `~/.hive/logs/{agentId}.json` |
| Skills | `~/.claude/skills/` |
| Status Hooks | Embedded in agent definition file |

## Roadmap

- [x] Multi-agent terminal management
- [x] Soul auto-generation from role + personality traits
- [x] Native Claude Code `--agent` integration (replaces soul injection)
- [x] Session resume via `claude -c` (replaces job pickup)
- [x] Agent template system (8 built-in + custom + import .md)
- [x] Split soul editor (markdown + live preview)
- [x] Default skills per department (global config)
- [x] GStack skills integration with detail view
- [x] Status hooks (working/waiting/idle via PreToolUse/Stop)
- [x] Task reporting (title/summary via hive-report.sh)
- [x] Work logs grouped by task with START/DONE badges
- [x] Agent memory isolation per agentId
- [x] Project dashboard with glassmorphism todo cards
- [x] Agent kanban with pixel avatars
- [x] Pixel avatar editor (skin, hair, clothes, accessories)
- [x] Git worktree auto-management
- [x] Project status auto-detection (Active/Incubating/Early Stage)
- [x] Agent roles: R&D (Engineering/Product/QA/Design) + Non-R&D (Admin/HR/Marketing/BA/Operations/GM)
- [x] Light/dark theme
- [x] Office visualization (Canvas 2D animated pixel office)
- [x] Files panel (right sidebar, search, drag-to-terminal)
- [x] Resizable sidebar panels
- [x] Job pickup (auto-resume from work logs)
- [x] Agent groups within departments (drag-to-reorder)
- [x] Terminal scroll-to-bottom button (follows system)
- [x] Project Settings tab (add/remove folders inline)
- [x] **Multi-agent task orchestration** — Manager/Worker/QA/Critic roles, gate verification, stuck detection, auto-assign
- [x] **Staging/UAT workflow** — Configurable target branch, forced push + rebase on task-done, auto-create staging branch
- [x] **Activity log** — Structured timeline (Who/Time/Action/Content), color-coded actions, clear controls
- [x] **Batch history** — All batches collapsible with dates, task table (Worker/Task/Summary/Result)
- [x] **Auto-approve** — Batch proposals auto-approved when enabled
- [x] **5-hour limit auto-whip** — PTY output detection, reset time parsing, auto-restart
- [x] **Task abandon** — Manager-only with required reason
- [x] **Daily report** — Dispatcher triggers Manager at 00:01 for daily summary
- [x] **Forced git push** — task-done commits + rebases staging + pushes before reporting
- [x] **R&D Rebase button** — One click rebases all active R&D agents
- [x] **File Explorer branch tag** — Shows path + 🌿 branch under File Explorer title
- [x] **Project drag-and-drop** — Reorder projects in sidebar
- [x] **Port lock isolation** — Dispatcher writes port.lock, dev server fully isolated
- [x] **HiveChat — Crush-styled React chat** — `claude --print --output-format stream-json` parsed into typed ToolBlocks (Bash/Read/Edit/Grep/Todo/Web/MCP), streaming typewriter, Edit diff panel, syntax highlighting, markdown tables, clickable choices (numbered + letter), permission modal with `control_response` handshake, thinking spinner, session resume, secret redaction ([journey](docs/slides-hivechat-journey.html))
- [x] **Real subscription %%** — node-pty scrape of interactive `/usage` TUI, event-driven refresh on `message_stop`
- [ ] **Session-scoped slash commands in HiveChat** — `/clear`, `/compact`, `/model`, `/remote-control` via round-trip: pause `--print` → headless PTY `--resume <sid>` → drive TUI → close → re-resume in `--print`
- [ ] **Multi-agent communication** — PTY injection + filesystem mailbox + shared task list ([plan](docs/agent-comms-plan.md))
- [ ] **Terminal UI customization** — React overlays on xterm: task cards, diff preview, progress bars, agent messages ([plan](docs/terminal-ui-customization-plan.md))
- [ ] **MCP Server** — Auto-reporting without soul instructions
- [ ] **GNU Screen session persistence** — Terminal sessions survive app restart
- [ ] **Notification integrations** — Slack, Telegram, WhatsApp, macOS
- [ ] **Office visualization upgrade** — Phaser 3 + real sprite assets (currently Canvas 2D)
- [ ] **Offline log buffer** — hive-report.sh saves to local file when Hive is offline, syncs on reconnect
- [ ] claude-mem / memsearch for enhanced memory
- [ ] **Voice input** — macOS native SFSpeechRecognizer, free/offline ([plan](scripts/hive-speech.swift))

## Contributing

Contributions welcome! Please read the [license](LICENSE) — AGPL-3.0 means your changes must also be open source.

```bash
# Development
npm run dev

# Build
npm run build

# Test
npm test
```

## License

[AGPL-3.0](LICENSE) — Open source. Fork freely. Commercial use requires authorization.

---

<div align="center">

**If Hive helps you manage your AI agents, give it a star!**

[![Star this repo](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive)

</div>
