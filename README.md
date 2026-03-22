<div align="center">

<img src="resources/icon.png" width="128" alt="Hive icon" />

# Hive

**Your AI agents deserve an office.**

A macOS desktop app to manage multiple [Claude Code](https://claude.ai/claude-code) agents — each with its own soul, skills, and workspace.

[![GitHub stars](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive/stargazers)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-purple.svg)](LICENSE)
[![Beta](https://img.shields.io/badge/status-beta-orange.svg)]()
[![macOS](https://img.shields.io/badge/platform-macOS-blue.svg)]()

<!-- Replace with actual screenshot -->
![Hive Dashboard](docs/screenshot-dashboard.png)

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

## Demo

<!-- Replace with actual GIF/video -->
![Hive Demo](docs/demo.gif)

## Features

### Multiple Agent Terminals

Run N Claude Code sessions side by side. Click to switch. Each terminal persists — switch between agents without losing state.

### Soul System

Every agent gets a `soul.md` — define their role, personality, and boundaries. A frontend specialist thinks differently from a QA lead.

```markdown
# Soul

## Role
You are a senior frontend developer specializing in React and TypeScript.

## Personality
- Opinionated about code quality
- Prefers functional components
- Always suggests tests

## Boundaries
- Never modify backend code
- Ask before large refactors
```

### GStack Skills Integration

Browse and toggle [GStack](https://github.com/garrytan/gstack) skills per agent. Visual skill browser with enable/disable switches.

<!-- Replace with actual screenshot -->
![Skills Browser](docs/screenshot-skills.png)

### Project Dashboard

Kanban board showing all agents grouped by status. See who's working, who's waiting, who's idle — at a glance.

### Status Hooks

Claude Code hooks automatically report agent status to Hive via localhost webhook. No polling, no guessing.

```
Agent starts tool use → status: working
Agent stops → status: waiting
Terminal exits → status: done
```

### Agent Memory

Each agent has isolated persistent memory at `~/.hive/memory/{agentId}/`. Survives restarts, survives renames. Keyed by ID, not name.

### Work Logs

Permanent activity log per agent. Every status change, every report — timestamped and stored in `~/.hive/logs/`.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Hive App                          │
│                                                        │
│  ┌──────────┬─────────────┬──────────────────────────┐ │
│  │ Projects │   Agents    │  Terminal / Editor / Logs │ │
│  │          │             │                          │ │
│  │ PSLE App │ Engineering │  $ claude                │ │
│  │ Hive     │  FE Dev  ●  │  > Building component... │ │
│  │          │  BE Dev  ●  │                          │ │
│  │          │ Research    │  [soul.md loaded]        │ │
│  │          │  Analyst ○  │  [gstack skills active]  │ │
│  └──────────┴─────────────┴──────────────────────────┘ │
│                                                        │
│  Electron · React · xterm.js · node-pty                │
└────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
  ~/.hive/                    localhost:17710
  ├── data.json               (status webhook server)
  ├── memory/{agentId}/              ▲
  └── logs/{agentId}.json            │
                              Claude Code hooks
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

### Install & Run

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

Restart Hive — skills appear in Agent Editor.

## How It Works

1. **Create a Project** — Point to your working folders (R&D + docs)
2. **Add Agents** — Name them, assign a department, pick a zone
3. **Configure Soul** — Write `soul.md` to define personality
4. **Enable Skills** — Toggle GStack or custom skills
5. **Start Working** — Click an agent, Claude Code launches in their zone
6. **Monitor** — Dashboard shows real-time status, logs track everything

## Data Storage

| Data | Location |
|------|----------|
| Projects & Agents | `~/.hive/data.json` |
| Agent Memory | `~/.hive/memory/{agentId}/` |
| Work Logs | `~/.hive/logs/{agentId}.json` |
| Skills | `~/.claude/skills/` |
| Hook Config | `{project}/.claude/settings.local.json` |

## Roadmap

- [x] Multi-agent terminal management
- [x] Soul.md editor
- [x] GStack skills integration
- [x] Status hooks (working/waiting/idle)
- [x] Work logs
- [x] Agent memory isolation
- [x] Project dashboard with kanban
- [x] Light/dark theme
- [ ] Pixel avatar editor
- [ ] Git worktree auto-management
- [ ] Project status analysis (scan todos from R&D/docs)
- [ ] Agent-to-agent communication
- [ ] Office visualization (agents at desks)
- [ ] Agency-Agents role templates
- [ ] claude-mem / memsearch integration

## Contributing

Contributions welcome! Please read the [license](LICENSE) — AGPL-3.0 means your changes must also be open source.

```bash
# Development
npm run dev

# Build
npm run build
```

## License

[AGPL-3.0](LICENSE) — Open source. Fork freely. Commercial use requires authorization.

---

<div align="center">

**If Hive helps you manage your AI agents, give it a star!**

[![Star this repo](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive)

</div>
