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

- What needs the owner comes first: numbered, most urgent first.
- Then open items: what is still running or blocked.
- Then done, by project. Count only finished work as done. "Almost done" is open.
- No guesses beyond what `./hive` shows.

## Ask me first

- 🔒 sending — the report goes to the owner only; never post it anywhere

## Tone and format

- Line 1: a headline of at most 12 words.
- Headings: **Needs you**, **Open**, **Done**. Leave out an empty one.
- One item per line: `<project> — <short label>`. Labels, not sentences.
- Numbers as numbers (14/18 tests, PR #90).

## Examples

> Cube v2 #219 part 2 on UAT
> **Needs you**
> 1. Cube Support — grant Vercel GitHub App access
> 2. Ben — answer Plan C
> **Open**
> - sphere2 · Bolt — e2e 32/40, waiting on test data
> **Done**
> - Cube v2 — checkout iOS focus fix merged

## Output

- The report as markdown, in the sections above.
- Nothing is sent.
