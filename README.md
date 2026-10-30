<div align="center">

<img src="resources/icon.png" width="112" alt="Hive icon" />

# Hive

**Your Claude Code team — not just more terminal tabs.**

A macOS app that runs a team of Claude Code agents, each with a role, memory and its own workspace.
A manager agent can hand out the work, chats survive restarts and long goals,
and you can check on the team and give orders from your phone.

[![Latest release](https://img.shields.io/github/v/release/nocodevit/hive?color=8b5cf6)](https://github.com/nocodevit/hive/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive/stargazers)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-purple.svg)](LICENSE)
[![macOS · Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-blue.svg)](#install)

[**Download**](https://github.com/nocodevit/hive/releases/latest) · [Features](#features) · [What's new](#whats-new) · [Install](#install) · [中文](docs/README.zh-CN.md)

</div>

---

## 🎃 Halloween limited skin — Oct 24 to Nov 2

<img src="docs/screenshot-halloween.png" alt="Hive in the Halloween skin: spiders, ghosts, a mummy and Frankenstein's monster around the Butler Todo panel" />

Update in season and Hive puts on a night-violet and pumpkin-gold skin, once. The window gets a cast:

- Press Send and a **ghost** pops out of its hole.
- **Spiders** dash in every so often, stop on the chat to look around, then run into a corner and spin a web that fades a minute or two later.
- A **mummy** shambles along the bottom; **Frankenstein's monster** peeks up from the edge, neck bolts sparking.
- Every few minutes a **ghost or the pumpkin fiend** lunges at you — the pumpkin bites.

None of it takes a click (it's all click-through). Switch back any time in *Settings › Theme palette*; after Nov 2 your previous palette returns by itself. With *Reduce motion* on, nothing moves.

## What's new

- **2.39** — A motion pass: sending shows a spinner then ✓ and the card slides away; Dismiss and Drop are instant with **Undo**; ticking a todo draws the ✓ and strikes it through; tabs, counts and menus animate. Feishu cards say who sent the message. The pumpkin fiend.
- **2.38** — The Halloween skin. The update window shows **every version you skipped**, not just the newest. A recording bar for voice input (tap or hold: timer, live waveform, slide to cancel).
- **2.37** — Butler's **Todo** gets three priorities (⚡ 要命 storms to the top / 🔥 冒烟 / 🧊 冻着), multi-select and *Move to tomorrow*. **Discuss** sends a card or todo to Butler or to any agent in any project. Butler can read and tidy Approve cards from its chat (it never sends for you).

Every release: [CHANGELOG.md](CHANGELOG.md) · [Releases](https://github.com/nocodevit/hive/releases)

---

## Why Hive?

Running several Claude Code sessions at once usually means a wall of terminal tabs, agents that all behave the same, and work that dies when the laptop restarts. Hive treats them as a team instead:

- **Agents with jobs.** Each agent is a native Claude Code `--agent` with a role, personality, skills and its own memory. Engineers get their own git worktree, so they never step on each other.
- **A manager that delegates.** Task groups give one agent the Manager role: it reads your todo list, proposes batches, and Workers, QA and a Critic carry them out.
- **Work that keeps going.** Long `/goal` loops, automatic compaction, continuing after a usage-limit reset, and on launch Hive offers to resume every chat that was open when it quit.
- **Steer it from your phone.** Turn on Butler and a "Hive Butler" session appears in the Claude app on your phone: ask who is working, read what an agent said, send an agent a message. No extra app to install.
- **Talk to it in Chinese and English.** Voice input understands both languages mixed in one sentence.

## Features

### A team, not tabs
- Projects with R&D and non-R&D departments; agents grouped into teams, drag to reorder.
- Eight role templates (engineer, product, QA, design, marketing, ops…) plus your own; each agent's definition is a plain `.claude/agents/hive-<id>.md` file.
- Per-agent skills, model and effort; persistent memory per agent that survives renames.
- Git worktree per coding agent (`{repo}-{agent}/`, branch `hive/{agent}-{id}`), cleaned up when the agent is removed; optional rebase on restart.

### Chat built for long-running agents
- A structured chat on top of `claude --print --output-format stream-json`: typed tool blocks (Bash, Edit with diff, Read, Grep, Todo, web, MCP), live subagent timeline, clickable choices, permission prompts.
- Context, 5-hour and 7-day usage shown live; one-click compact, smart compact-then-resume for heavy sessions, and automatic "please continue" after a rate-limit reset.
- `/goal` replies render as a card; a goal loop that gets stuck can be interrupted and cleared from the input box.
- On launch, a list of chats that were still open at the last quit (or crash), all ticked: one click resumes them.

### Task groups
- Manager 👑, Worker 🔧, QA 🛡️ and Critic ⚖️ roles on a shared todo list.
- Batch proposals you approve (or auto-approve), batch history, activity log, stuck detection, optional daily report.
- Staging branch workflow: a task is only "done" after its work is committed, rebased and pushed.

### Butler: your assistant inside Hive
- **Approve** — drafts Butler wrote (email, Feishu, Jira) wait as cards: what they said, what was already sent, the draft. You send, edit, discuss or dismiss; Butler never sends without you.
- **Todo** — what it promised to follow up, with the whole story per item; three priorities, due dates, multi-select.
- **Today** — the day's plan from your calendar (Feishu and/or macOS) and routines.
- **Feishu answer-for-me** (optional) — answers what it can from the facts, tells you; anything that's your call becomes a card and nothing is sent.

### Butler on your phone
- App Settings → **Remote Control** → *Allow remote control from my phone (Butler)*. Off by default.
- Hive runs a Claude Code session with Remote Control in its own folder; open the Claude app → **Code** → "Hive Butler".
- It lists agents and their status, reads an agent's latest output, and types your message into the chat of the agent you name, word for word. It never guesses between agents with the same name, never starts a chat you didn't ask for, and cannot edit files. ([details](docs/butler-api.md))

### Voice input
- Speak into the chat box; text appears as you talk and can be sent automatically when you pause.
- Tap 🎙 for hands-free, or hold it: the button stretches into a recording bar with a timer and a live waveform; slide left to cancel.
- With your own OpenAI API key, Chinese and English mixed in one sentence come out right; without one, macOS on-device recognition is used. ([details](docs/voice-input.md))

### Everything else
- Project dashboard (todos scanned from your markdown, agent board, project stage from git activity), work logs per agent, file explorer with markdown preview.
- Themes: purple, blue and pink palettes, light and dark, plus the "Prime" style — and the seasonal 🎃 Halloween skin.
- Updates install themselves: *Check for Updates → Install & Restart* (signature and developer are verified first). ([details](docs/self-update.md))

## Install

**Requirements**
- macOS on Apple Silicon.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in. Butler (phone control) needs a claude.ai subscription account, the same one as in the Claude app on your phone.

**Download** the latest `Hive-<version>-arm64.dmg` from [Releases](https://github.com/nocodevit/hive/releases/latest), open it and drag Hive into Applications.

Or with Homebrew:
```bash
brew install --cask nocodevit/tap/hive
```

> Hive is signed but not yet notarized. On first launch, right-click Hive → **Open**, or run `xattr -cr /Applications/Hive.app`.

### Build from source

```bash
git clone https://github.com/nocodevit/hive.git
cd hive
npm install
npm run dev
```

Node.js 20+. `npm test` runs the unit tests, `npm run test:e2e` the Playwright suite.

## Where Hive keeps things

| Data | Location |
|------|----------|
| Projects, agents, settings | `~/.hive/data.json` |
| Agent definitions | `{project}/.claude/agents/hive-{agentId}.md` |
| Agent memory | `~/.hive/memory/{agentId}/` |
| Chat logs | `~/.hive/chat-logs/` |
| Work logs | `~/.hive/logs/` |
| Butler session folder | `~/.hive/butler/` |
| Skills | `~/.claude/skills/` |

## Tech

Electron 35 · React 18 · TypeScript · Tailwind CSS · xterm.js + node-pty · electron-vite · Vitest · Playwright.

## Contributing

Issues and pull requests are welcome. Hive is [AGPL-3.0](LICENSE): if you distribute a modified version, its source must be open too.

## License

[AGPL-3.0](LICENSE) — open source, fork freely. Commercial use requires authorization.

---

<div align="center">

**If Hive helps you run your agents, a star helps other people find it.**

[![Star this repo](https://img.shields.io/github/stars/nocodevit/hive?style=social)](https://github.com/nocodevit/hive)

</div>
