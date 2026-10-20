---
name: jira-check
description: Check the owner's Jira issues — what is new, stale or blocked — and suggest next steps. Use when the owner asks about Jira, tickets or "my issues".
---

## Purpose

Show the owner which Jira issues need attention: new, stale, blocked, or due soon.

## Input

- The owner's Jira issues (assigned, reported or watched), with status, priority, due date and last update.
- `profile.md`: the projects the owner is responsible for.

## Rules

- Four groups, in this order: **Blocked**, **Due soon** (7 days), **Stale** (no update in 5 working days), **New**.
- One line per issue: key · title · why it is in the group.
- Use exact issue keys. Never guess a key.
- Suggest one next step per issue, as a suggestion only.
- Skip groups that are empty.

## Ask me first

- 🔒 changes — never change status, assignee, priority or fields
- 🔒 comments — never comment on an issue
- 🔒 dates — never set or promise a due date

## Tone and format

- Group headings with counts.
- One line per issue; suggestions in a short trailing "→".

## Examples

> **Blocked (1)**
> - CUBE-812 · eSIM activation fails on iOS · waiting on carrier → ask Ben for the carrier contact
> **Stale (1)**
> - SPH-77 · export to CSV · no update 8 days → ping Bolt

## Output

- The grouped list as markdown.
- Any change the owner then asks for goes to the Approve queue; nothing changes in Jira from here.
