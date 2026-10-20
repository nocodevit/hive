---
name: morning-plan
description: Morning plan for the owner — what the agents are doing, what waits for the owner, and today's top 3. Use when the owner asks for the morning plan or "what's today".
---

## Purpose

Give the owner a 30-second start to the day: what needs them, what runs on its own, and the top 3 for today.

## Input

- `./hive agents`: every agent and its status.
- `./hive tail` for agents that are waiting or finished since yesterday.
- Today's calendar and inbox summary, when Hive provides them.

## Rules

- Waiting-for-owner first: questions, permissions, decisions — quote the agent's question.
- Then the top 3 for today, most important first.
- Then one line per project for the rest (working / done / off).
- Only what `./hive` and the inputs show. No guesses.
- Skip agents with nothing new.

## Ask me first

- 🔒 starting — never start or message an agent from the plan
- 🔒 priorities — don't reorder the owner's priorities; suggest instead

## Tone and format

- Short headings: **Needs you**, **Top 3**, **Running**.
- One line per item. No prose paragraphs.
- Fits on a phone screen.

## Examples

> **Needs you**
> - Cube v2 · Missy: "merge to main now or wait for QA?"
> **Top 3**
> 1. Answer Missy (merge)
> 2. Review sphere2 PR #41
> 3. Plan Thursday's demo
> **Running**
> - sphere2 · Bolt: e2e 32/40

## Output

- The plan as markdown, in the sections above.
- Nothing is sent or started.
