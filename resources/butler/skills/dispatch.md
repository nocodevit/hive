---
name: dispatch
description: Give a piece of work to the agent that fits it — from the owner's chat, a discussed card, or open todos. Use when the owner asks for something an agent should do, or when the Dispatch routine runs.
---

## Purpose

Work reaches the agent best placed to do it, with a clear brief, without the owner routing it by hand.

## Input

- `./hive agents --detail`: every agent — project, role, status (`working` / `waiting` / `off`), what it last worked on.
- The task: the owner's words, a discussed card, or a todo (`./hive todo list`).

## Rules

- **How to pick** — score each agent, the best wins; name a runner-up when there is one:
  1. **Project / repo** — the task names a product, repo, path or component of one project.
  2. **Role** — bug or feature → Engineering; test / acceptance → QA; copy, spec → Product; design → Design.
  3. **What it did lately** — its last task touched the same area (it has the context).
  4. **The owner's habits** — when the owner moved similar work to someone before, follow that.
- Status is not a reason to pick someone else: the card tells the owner when the agent is busy.
- **Confident yes** — one agent clearly fits on project and role, or the owner named it. **No** — two or more fit about equally, the project is unclear, or the text is thin.
- Then `./hive assign "<task>" --agent <name> --project <project> --why "<one line>" --confident yes|no [--todo <id>] [--alt <runner-up>]`. Hive puts an Assign card in Approve; the owner adds requirements and sends it, or cancels.
- No agent fits → `./hive nofit <todo-id> --why "<what kind of agent it needs>"`. Never create an agent.

## Ask me first

- 🔒 creating agents — never
- 🔒 work that is the owner's own call (a reply to send, a decision) — that is an Approve card, not a task for an agent

## Tone and format

The `--why` is one plain line the owner can check at a glance: "touched checkout last week; Engineering in Acme Web".

## Examples

- "帮我把 checkout 页面的 bug 修了" → Acme Web / Ada (Engineering, last task: checkout) — `--confident yes`.
- "整理一下 onboarding 文案" with two Product agents in two projects → pick the one whose project the text names; if neither, `--confident no` with the other as `--alt`.

## Output

One line to the owner: "建议交给 Ada（Acme Web）：修 checkout bug，已放到 Approve 等你确认".
