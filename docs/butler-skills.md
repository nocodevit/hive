# Butler skills

One markdown file per task Butler does for the owner (reply to an email,
answer Feishu, morning plan, …). Code: `src/main/butlerSkills.ts` (pure
logic + files), `src/main/butlerSkillsIpc.ts` (IPC, `claude -p`), UI
`components/butler/SkillsSettings.tsx` + `AboutMeSettings.tsx`
(App Settings).

## Layers

| Layer | Path | Written by |
|---|---|---|
| Default | `resources/butler/skills/<id>.md` | Hive (shipped, replaced on upgrade) |
| Form overlay | `~/.hive/butler/skills/<id>.json` | Owner: tone, max length, language, extra ask-first items, extra rules |
| Override | `~/.hive/butler/skills/<id>.md` | Owner: full markdown ("Advanced", or Accept in "Describe a change") |
| Effective | `~/.hive/butler/.claude/skills/<id>/SKILL.md` | Hive, at every session start and after every save |

- Effective = override if present **and it passes lint**, else default +
  overlay. A hand-edited override that fails lint (e.g. a 🔒 line removed)
  is ignored and its problems shown in Settings.
- Hive never overwrites the owner's files; Reset deletes them for that id.
- `skills/.meta.json` remembers the default's hash when the owner
  customizes. If the shipped default of an overridden skill changes, the
  skill shows "default updated" → Compare (diff mine vs new default) →
  Keep mine or Reset. Form overlays follow the new default by themselves.
- Ids: `^[a-z][a-z0-9-]{0,31}$` and a shipped default must exist.

## Writing guide

Frontmatter, then exactly these sections in this order:

```markdown
---
name: <id>                 # must equal the file name
description: <what it does>. Use when <trigger>.
---

## Purpose          one sentence: the outcome for the owner
## Input            🔒 locked — what the skill receives
## Rules            short imperative bullets, one rule per line
## Ask me first     topics Butler must not decide; "- 🔒 …" lines are locked
## Tone and format  voice, length, layout
## Examples         input → exact output, short
## Output           🔒 locked — what the skill returns, and that nothing is sent
```

- `## Input` and `## Output` must stay identical to the default: they are
  the contract with the code that runs the skill.
- `## Ask me first` lines that start with `- 🔒` are the safety floor
  (prices, approvals, private chats, sending…). Keep every one word for word; add
  your own as `- <topic> — <when>`.
- Rules are lines, not essays. Change only what you mean to change.
- Nothing a skill produces leaves Hive without the owner's approval
  (the Approve queue).

Lint (`lintSkill`) checks: frontmatter present and `name` = id,
description non-empty; all seven sections, no others, in order, none
twice; Input/Output unchanged; every 🔒 line still present.

## Form overlay → sections

| Field | Goes to |
|---|---|
| Tone (Formal / Direct / Friendly) | `## Tone and format`, wins over the lines above |
| Max length, Language | `## Tone and format` |
| Ask me first chips | `## Ask me first` as `- <chip>` |
| Extra | `## Rules`, one bullet per line |

## Try it / Describe a change

Both call `claude -p --output-format text` (prompt on stdin, cwd = temp
folder, 3 min timeout). Nothing is sent or saved.

- **Try**: effective skill (or the pending proposal) + `profile.md` +
  the sample input → output shown under the box.
- **Describe a change** ("一句话改"): current effective skill + this guide +
  the owner's sentence → new skill and one example output. Hive lints it
  (one automatic retry with the problems), shows change chips, the example
  and the diff (folded). Accept saves it as the override; Discard drops it.

## About me

App Settings → About me edits `profile.json` (`butler:profile` /
`butler:saveProfile`). Up front: role, responsible for, style, answer like
a, when unsure. "More": name, team, works with, often/never says,
language, prefix, intro. "What your agent reads" shows the rendered
`profile.md` live (`butler:profilePreview`).
