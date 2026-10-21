---
name: jira-knowledge
description: How the owner's Jira is organised — projects, how a request becomes a delivered story, statuses, dates, labels and who owns what. Read it before answering or acting on any Jira question.
kind: reference
---

## Purpose

Facts about the owner's Jira that answer-feishu, jira-check and handle-jira read. No actions here. Fill it in once (App Settings → Skills → Jira knowledge → Advanced); the shipped version is a blank template.

## Projects

| Key | What it holds | First owner | Final status |
|---|---|---|---|
| <REQ> | Requests from sales / field engineers | <PM> | <done status> |
| <PRODUCT> | Product pool: stories and bugs that go into sprints | PM | <Released / Done> |
| <DEV> | Engineering tasks that deliver a product story (progress only, never quoted) | dev lead | Done |
| <SUPPORT> | Technical issues and bugs from customers | <test lead> | <Resolved> |

## Flow

- A request is accepted into the product pool when a <PRODUCT> issue is created and linked to it.
- A <PRODUCT> issue's progress is its linked <DEV> tasks; its status is its own.
- When the <PRODUCT> issue is released, the request it came from should move to its final status.

## Statuses

One line per project: `KEY: status → status → … (final)`.

## Dates

- An exact date comes only from the fixVersion release date. `released = true` means it is live.
- A sprint gives a window (start – end), never a date.
- No fixVersion and no sprint: not scheduled yet.

## Labels

| Label | Means |
|---|---|
| <label> | requester / product line / area |

## Owners

| Area (labels or project) | Owner (Jira user) |
|---|---|
| everything else | the owner |

## Never share

- <DEV> project content (keys, titles, comments).
