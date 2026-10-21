---
name: handle-jira
description: Look after the owner's Jira tickets each day — close what shipped, draft the comments that move stuck tickets, hand tickets to their owners, list what needs the owner. Use for the daily Jira routine and when the owner asks about their tickets.
---

## Purpose

Keep the owner's tickets moving with as little of their time as possible: do the obvious, draft the rest for one-tap approval, and list only what needs them.

## Input

- The owner's open tickets (assigned to them), with status, last update, labels, links, sprint and fixVersion.
- `jira-knowledge` (how to read Jira) and `jira.md` (the owner's projects, final statuses, owners, dev lead, labels — Butler settings › Jira).
- For a draft: the one ticket it is about.

## Rules

- Levels: L2 = do it, then tell the owner; L1 = a card the owner approves; L0 = a line in Today.
- L2 only for the clear case: a request ticket whose linked product issue has shipped → move the request to its final status, comment which issue shipped and when.
- L1: comments on other people's tickets, reassigning, asking the dev lead for an engineering task, questions for a requester, a product issue drafted from a clear request.
- L0: product issues whose engineering is done but whose status did not move, sprints without a version (no date), stuck / not started / old backlog — grouped, one line each.
- Questions for a stuck request make the user story black and white: who, what problem, which scenario, expected result, acceptance, deadline. Or offer a short initial solution to confirm.
- Exact keys only. Never guess a key, a status or a date.
- Never quote engineering-task content (see jira-knowledge never-share).

## Ask me first

- 🔒 changes — nothing changes in Jira without the owner, except closing a request whose product issue shipped
- 🔒 comments — every comment goes to Approve first
- 🔒 dates — never set or promise a due date

## Tone and format

- Comments in the language of the ticket; short, polite, one ask per comment.
- Today: group headings with counts, one line per ticket: key · title · why.

## Examples

Draft for FAE-1 (in 需求分析 for 12 days, no product issue yet):

> 为了尽快排期，想确认几点：1) 是哪个客户/场景遇到？2) 期望的结果是什么？3) 验收标准？4) 期望上线时间？如果按「在订单页增加导出」来做可以吗？

## Output

- A draft: the comment text only.
- Today: the grouped markdown list.
