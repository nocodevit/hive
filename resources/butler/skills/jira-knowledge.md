---
name: jira-knowledge
description: How to read a Jira the way a product team uses it — requests, product issues, engineering tasks, statuses, sprints and versions, links, what is safe to quote. Read it with the owner's own Jira settings (jira.md) before answering or acting on any Jira question.
kind: reference
---

## Purpose

General knowledge for every Jira-aware skill (answer-feishu, handle-jira). The owner's company specifics — which project is which, final statuses, owners, the dev lead, what labels mean — are not here: they are in Butler settings › Jira and reach you as `jira.md`. When the two disagree, `jira.md` wins.

## Reaching Jira

Use your `jira_*` tools. If you have none, Jira is connected directly: `./hive jira search "<JQL>"`, `./hive jira get KEY`, `./hive jira transitions KEY`, `./hive jira me` (read only).

## Three kinds of project

- Request projects: what sales, field engineers or customers ask for (requirements, support tickets, supplier requests). They are where questions come from.
- The product project: stories and bugs the team plans into sprints and releases with versions. Its status is the product's status.
- An engineering project (if any): the tasks that deliver a product issue. Progress only — its keys, titles and comments are never quoted to anyone.

## Following a request

- A request is accepted when a product issue is linked to it (often "created by", sometimes Blocks or Relates). No product issue yet → not scheduled.
- Answer "how is X going" from the product issue: its own status first; its engineering tasks only tell you how far along it is.
- When the product issue has shipped, the request should be closed; if it is not, it was forgotten.

## Statuses

- Each project has its own workflow. Use the status names exactly as Jira shows them.
- A done-category status is not always final (e.g. "ready to release"); the final ones are in `jira.md`.
- A "waiting for the reporter to verify" status is the reporter's move, not a stuck ticket.
- Jira often will not skip steps: moving to a later status may need the steps in between.

## Dates

- The only date you may give is a fixVersion's release date (`released = true` means it is live).
- A sprint gives a window (start – end), never a date: "in sprint <name>, <start>–<end>; exact date once a version is set".
- No version and no sprint: "已登记，尚未排期" / "logged, not scheduled yet". Never invent a date.

## Reading a ticket

- Description detailed or a PRD link → the design is ready; engineering should have a task.
- Labels usually say who asked (business unit, region), the product line and the area — see `jira.md` for this owner's.
- Comments: the latest ones say what is happening; summarize, do not paste.

## Safe to quote

- Request and product keys, titles, statuses, versions and dates.
- Never: engineering-project content, prices, anything confidential, other people's private remarks in comments.
