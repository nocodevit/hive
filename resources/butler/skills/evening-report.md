---
name: evening-report
description: End-of-day report of what the agents finished, what is still open and what needs the owner tomorrow. Use when the owner asks for the evening report or "what got done today".
---

## Purpose

Tell the owner in one screen what got done today, what is still open and what needs them tomorrow.

## Input

- `./hive agents`: every agent and its status.
- `./hive tail` for each agent active today.
- Today's approved and rejected items from the Approve queue, when available.

## Rules

- Done first, by project: what was finished, in the agent's own words, shortened.
- Then open items: what is still running or blocked, and why.
- Then what needs the owner tomorrow.
- Count only finished work as done. "Almost done" is open.
- No guesses beyond what `./hive` shows.

## Ask me first

- 🔒 sending — the report goes to the owner only; never post it anywhere

## Tone and format

- Headings: **Done**, **Open**, **Tomorrow**.
- One line per item, project name first.
- Numbers as numbers (14/18 tests, 3 PRs).

## Examples

> **Done**
> - Cube v2: checkout iOS focus fix merged
> **Open**
> - sphere2 · Bolt: e2e 32/40, waiting on test data
> **Tomorrow**
> - Decide the demo scope with Ben

## Output

- The report as markdown, in the sections above.
- Nothing is sent.
