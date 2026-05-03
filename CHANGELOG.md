# Changelog

All notable changes per released version. Entries mirror the `(vX.Y.Z)` tag
in the git commit title; dates are the commit date.

This log was back-filled from git history at v1.7.28.

---

## [Unreleased]

### Added
- *nothing yet*

---

## [1.7.101] — 2026-05-03

### Added
- **`✦ Start New Session` in the kebab menu (active session).** The
  `startNewSession()` function existed since the start-chooser was
  introduced but was only reachable AFTER closing the session — once
  inside an active session, the kebab only offered Compact + Fork
  (carries summary as seed) and Resume (carries full context). Neither
  one corresponds to "clean slate, agent has no memory of prior
  conversation". Now exposed as a 4th menu item between Resume and
  Remote Control. `onFork` ≠ `onNewSession`: Fork preserves a compacted
  summary; New starts blank.

---

## [1.7.100] — 2026-05-03

### Fixed
- **File Explorer now loads the full project tree.** `fs:scanFiles` had a
  `files.length > limit * 2` early-bail that fired mid-DFS, so any project
  with >1000 files (e.g. `psle-alex-web-alex-data` at 14k files,
  `question-bank/` alone at 4.5k) silently dropped every directory walked
  after the threshold. Refresh re-ran the same broken scan, hence "only
  two folders" symptom. Replaced with three independent guards —
  `MAX_DEPTH=10` (was 5), `MAX_VISIT=50000` files-scanned ceiling, and a
  3s wall-time cutoff — and bumped the renderer-side limit from 500 → 5000
  so 4.5k-file folders actually render in the tree.
- **Tasks parse failures now surface in the console.** `listTasks()` was
  silently swallowing `JSON.parse` errors with `catch { return null }`,
  meaning corrupted task files vanished from the UI without warning. Now
  logs `[tasks] parse failed: <file> <message>`.

### Security
- **Hardened all `git:*` IPC handlers against shell metacharacter
  injection.** `git:commitHistory`, `git:createTargetBranch`,
  `git:currentBranch`, `git:worktreeAdd`, `git:worktreeRemove`,
  `git:worktreeList`, `git:createIntegration`, `git:clone` all migrated
  from `execSync` with template-literal interpolation (`git -C "${repoPath}"
  branch ${branch}`) to `execFileSync('git', [...args])` argv form, which
  bypasses the shell entirely. Branch names, paths, and clone URLs from
  external sources can no longer break out of arguments. Also clamps `days`
  on `git:commitHistory` and `batchNum` on `git:createIntegration` to
  integers to prevent any other unsafe input.

### Changed
- **Pause button (Task Group toolbar) is now visibly disabled** with a
  `Pause coming in v0.10.0` tooltip, instead of looking clickable but
  doing nothing on click.

---

## [1.7.74] — 2026-04-27

### Fixed
- **RateLimitBar countdown now ticks live.** `resets in Xh Ym` and
  `⏱ auto-continue in Xh Ym` were rendered once and frozen — only
  updated when the next stream event happened to re-render the
  component, so a long-rejected session showed stale time forever.
  Added a 60s heartbeat (matches `humanEta`'s minute resolution
  exactly) that bumps a force-render counter and cleans up when
  neither `resetsAt` nor `autoContinueAt` is set.

---

## [1.7.73] — 2026-04-27

### Added
- **ActionToolbar above input bubble** — utility row with always-on
  Compact button + `⋮` kebab dropdown for other session actions.
  Layout: `ctx 22%` chip on the left (when known) / `[Compact] [⋮]`
  on the right. Compact button border + label escalate with ctx %:
    - `< 60`: Charple border, label "Compact"
    - `60-79`: Zest border, label "Compact (⚠ 68%)"
    - `>= 80`: Sriracha border, label "Compact (⚠ 88%)"
  `⋮` dropdown contains: Compact + Fork / Resume Session / Remote
  Control / Close Session — consolidating session-level actions
  that previously lived in the bottom ModelUsageBar. Click-outside
  closes the menu.
- **Floating scroll-to-bottom button** — appears at the right edge
  above the toolbar when the user has scrolled up from the live
  edge (`distFromBottom > 60px`). Charple circular button with `↓`
  glyph; hover lightens to Violet. Click → scroll to bottom and
  resume auto-scroll. Auto-scroll on new messages now ALSO respects
  scroll position: if user is reading older content, new live events
  no longer yank them down.

### Tests
- `selectCompactBtnTier(pct)` (3 case groups, 9 assertions) added.
  Total now 32 files / 452 tests pass.

---

## [1.7.72] — 2026-04-27

### Fixed
- **Ctx % bar overflowing 100% (alex(data) flashed 181%)**. Two
  bugs combined to produce wildly wrong context-size readings:
  1. `result.usage.cache_read_input_tokens` is the CUMULATIVE sum
     across every iteration of an agentic turn — each tool call
     re-reads the prefix from cache and the running total is
     reported. For long turns this balloons to multiples of the
     context window (saw 25M on a 1M model). Fix: use
     `iterations[-1]` per-iteration values; fall back to top-level
     only when `iterations` is absent.
  2. Subagent `result` events carry their own independent usage and
     were overwriting the parent's ctx number. Fix: skip
     `setLatestInputTokens` when `parent_tool_use_id != null`. The
     subagent result entry is still added to the timeline (with
     `isSubagent: true` so renderer dims it), just not used for
     the parent's bar.

### Added
- **Context-pressure nag banner** at 80% (warn, Zest border + bg
  tint) and 90% (urgent, Sriracha). Sits above the Subagent /
  RateLimit row. Each tier dismissable independently with `✕`;
  both reset when ctx drops by ≥ 30% (= a /compact ran). Inline
  `Compact now` button runs the same path as typing `/compact` in
  the input box. Typed `/compact` was already supported (no change
  there) — the banner adds passive prompting + 1-click trigger.

### Tests
- `parseContextSize(s)` (5 cases) and `selectCtxNagTier(pct, dismissed)`
  (3 case groups, 11 assertions total) added to `progress-bar.ts`.
  449 tests across 32 files pass.

---

## [1.7.71] — 2026-04-26

### Changed
- **Subagent prompt bubble re-styled (final).** v1.7.70 stripped to
  plain Ash text per first-pass user feedback; user followed up
  "可以和 user input 样式类似，换个颜色就行" — i.e., keep the
  user-bubble shape, just recolor. Settled on:
    - bg: `rgba(107, 80, 255, 0.12)` (Charple at 12% — same opacity
      shape as the Dolly user bubble, different hue)
    - border: 1px Charple `#6B50FF`
    - prefix: `❯` Charple (was Julep on user input)
    - text: Ash `#DFDBDD` (slightly dimmer than Butter)
  Real human input still renders Dolly + Julep ❯ + Butter — `isSubagent`
  prop only flips when stream event has `parent_tool_use_id` set.

### Tests
- Extracted `computeGrainBar(pct, total)` math into
  `progress-bar.ts` and added 6 vitest cases (clamping, NaN/undefined,
  rounding, custom total, filled+empty invariant). 32 test files /
  444 tests now pass.

---

## [1.7.70] — 2026-04-26

### Fixed
- **Subagent prompts no longer rendered with user-input style.**
  Stream events with `parent_tool_use_id != null` come through as
  `kind: 'user'` (subagent's view: "what the parent told me to do"),
  but they're NOT real user input. v1.7.64 wrapped them in a
  Mochi-bordered SUB container, but the inner content still ran
  through `UserMessage` which slapped on the green Julep `❯` prefix
  and Dolly pink bubble — making subagent prompts look identical to
  things the human typed. Now `UserMessage` takes an `isSubagent`
  prop: when true, render as plain Ash `whiteSpace: pre-wrap` text
  with no bubble or `❯`. Real user input is unaffected (no
  `parent_tool_use_id` → `isSubagent` stays false → original style).
- **Progress-bar grain visible against panel bg.** `░` empty cells
  were Charcoal `#3A3943` against BBQ `#2D2C35` — only ~13 channels
  of contrast, basically invisible. Switched to Oyster `#605F6B`
  (~50 channels) so the grain reads clearly. `ui-preview-crush-elements.html`
  was wrong; updated alongside.

---

## [1.7.69] — 2026-04-26

### Added
- **Auto-continue after rate-limit reset.** When claude emits a
  `rate_limit_event` with `status: "rejected"` (5h or 7d cap hit and
  org-level overage disabled), the main process schedules a one-shot
  `setTimeout` for `resetsAt + 60s` that injects a normal user input
  (`"Limit reset — please continue."`) into the live `--print` stdin.
  No `--resume` needed — empirically the `--print` subprocess stays
  alive through `rejected` (verified against alex(data)
  `chat-agent-1774186235213-1777124830944.jsonl` line 41674); only the
  in-flight API call gets blocked.
  - State persists to `~/.hive/chat-auto-continue.json` so app
    restart re-arms the timer (entries older than 5min past their
    fire time get dropped).
  - RateLimitBar shows `⏱ auto-continue in Xh Ym` Charple text plus a
    `cancel` button. `chat:cancelAutoContinue` IPC clears both the
    timer and the persisted entry.
  - Only one timer per rejection epoch — many tool calls in a single
    turn each emit their own `rate_limit_event`, so we gate on
    `!session.autoContinueTimer`.
  - Status color in RateLimitBar widened: `rejected` now renders
    Sriracha (was generic Zest fallback).

---

## [1.7.68] — 2026-04-26

### Changed
- **"Load earlier" cap is temporary, not permanent.** Previously v1.7.66
  raised the live cap by `entries.length` on each load-older click —
  loaded entries persisted forever, growing memory unboundedly. Now
  the cap is temporarily raised AND a buffer counter (=10) is armed.
  Each genuine live entry — main-agent user/assistant/tool addition,
  excluding subagent noise (`parent_tool_use_id != null`) and
  in-place streaming-text replacements — decrements the counter.
  When it hits 0, cap snaps back to 500 and the loaded-older block is
  trimmed in one go. Lets you read 200 loaded entries comfortably
  before the next 10 real conversational turns push them off.

---

## [1.7.67] — 2026-04-26

### Changed
- **Status-bar progress bars now match `ui-preview-crush-elements.html`
  pixel-for-pixel — grain text glyphs (`█` / `░`) instead of CSS color
  fills.** All three indicators (`ctx`, `5h`, `7d`) render as 10-char
  monospace bars: filled `█` chars in the indicator's color, empty
  `░` (light shade / "grain") in Charcoal `#3A3943`. Matches the Crush
  TUI source. Default fill = Julep `#00FFB2`; `ctx` keeps its dynamic
  Bok → Zest → Sriracha threshold coloring at 70 / 85.

---

## [1.7.66] — 2026-04-25

### Fixed
- **"Show earlier messages" no longer vanishes**. Clicking the
  Load-older button prepended history into `timeline`, but a fixed
  `MAX_LIVE_ENTRIES = 500` cap then sliced the just-prepended
  oldest rows on the very next stream event — so the new rows
  appeared and disappeared within a frame. Replaced with a
  `liveLimitRef` that grows by `entries.length` on each prepend,
  so the cap respects loaded history. Live cap still starts at
  500 to bound memory on long fresh sessions.

---

## [1.7.65] — 2026-04-25

### Added
- **Sticky `Subagent #N` banner** above the rate-limit row whenever
  a Task tool's subagent is actively running. Tracks active
  subagents by `tool_use_id`, populated on Task `tool_use`,
  refreshed on every `system.subtype: task_progress` event (claude
  tells us what the sub is doing right now), removed when the
  matching `tool_result` arrives. Shows:
    `⏳ Subagent #1   Reading regen-batch2-handbook.md…   2 tools · 21K tok · 3.5s`
  - Charple `#6B50FF` color scheme (Crush purple, matches tool-block
    border / summary tag family).
  - Title-case "Subagent" with always-shown `#N` index assigned by
    insertion order (resets when sub finishes).
  - Hourglass `⏳` rotates 180° via `hg-flip` keyframe.
  - Animated `…` ellipsis loader (CSS-only `hive-dots` keyframe)
    after the description so you can see "still moving" even between
    `task_progress` events.
  - 1Hz tick keeps elapsed-time live.
  - **Idle detection**: if no event in 60s the row tints Zest, ⏳
    stops rotating, dots freeze — visual "stuck not slow" signal.
  - Multiple concurrent subagents stack as separate rows.

---

## [1.7.64] — 2026-04-25

### Fixed
- **Context %% bar showed 0% when prompt cache was warm.** Was using
  only `result.usage.input_tokens` (this turn's *new* tokens — `6`
  when cache served the rest). Now sums `input_tokens +
  cache_read_input_tokens + cache_creation_input_tokens` for the
  real loaded-context size. Auto-compact heuristic adjusted to use
  the same total.
- **Subagent prompts no longer render as fake user inputs.** Stream
  events with `parent_tool_use_id != null` (subagent's user/assistant
  turns relayed in parent stream) used to render as full UserMessage
  / AssistantMessage / ToolBlock with main-chat styling — the Task
  prompt to a subagent appeared as a Julep ❯ + Dolly bg bubble like
  the human typed it. Now: still rendered (so you can see what the
  subagent's doing) but wrapped in a Mochi-bordered indented dim-
  opacity container with a tiny `SUB` badge on the left. Click
  handlers (✓ / ✏ / ↺) suppressed inside subagent rows since they
  don't belong to the user's main thread.
- **`⏳` hourglass spinner now animates.** Was static text. Added a
  `hg-flip` CSS keyframe that rotates the glyph 180° every 2s so it
  visibly "tips" while the gradient text scrolls.

---

## [1.7.63] — 2026-04-25

### Added
- **Smart-startup auto `/compact`.** Every `chat:start` with
  `continueSession: true` now scans `~/.claude/projects/<cwd>/*.jsonl`
  for the latest session, reads its last `result.usage.input_tokens` /
  `modelUsage.contextWindow`, and if > 50% runs `/compact` via a
  brief PTY round-trip BEFORE the actual `--print --resume <sid>`
  spawn. Otherwise falls through to plain `-c` startup. Every Hive
  open of a long-lived agent gets auto-thinned context — no more
  cache-miss + huge-context hangs on resume.

### Changed
- Chat background `#170d2e` → `#150e24` to match `--sidebar-bg`
  (project list panel) in dark mode. Slightly less blue, warmer
  purple tone.

---

## [1.7.62] — 2026-04-25

### Added
- **Smart Resume button.** Closed-panel resume reads the session
  JSONL's last result event; if prior context > 50% runs `/compact`
  via PTY round-trip before re-spawning `--print --resume <sid>`,
  else just resumes. No more hangs from cache-miss on big sessions.
- **"Start with summary" button.** `/compact` + `--resume <sid>
  --fork-session` — new session-id with the compacted summary as
  seed context. Middle ground between full Resume and amnesia New.
- **`/compact` slash command** in the input box. PTY round-trip
  pattern: kill `--print` → spawn PTY `--resume <sid>` → write
  `/compact\r` → wait for prompt-return → kill PTY → respawn
  `--print --resume <sid>`.
- Closed-panel now shows THREE buttons: `↻ Resume / ≡ With summary
  / ⊕ New`, each labeled with its memory-persistence semantic.
- New `StartOpts.forkSession` flag wires `--fork-session` to the
  spawn. New IPCs: `chat:compact` / `chat:resumeSmart` /
  `chat:startWithSummary`.

### Fixed
- **Exit code `null` → `0`** when claude `--print` is killed by
  signal. The renderer's `useState<number|null>(null)` made the
  closed-panel never render because `exited !== null` stayed false.
  Coercing `null → 0` fixes the panel showing after close-confirm.

---

## [1.7.61] — 2026-04-25

### Changed
- **`--` separator suffix not prefix.** Pencil ✏ now appends
  `<content> --\\n` instead of `-- <content>\\n`. Caret lands on a
  fresh line after the quoted content, ready for the user's reply.

---

## [1.7.60] — 2026-04-25

### Removed
- Temporary `console.log` debug statements in `handleRespond` after
  v1.7.59's pointer-events fix verified working.

---

## [1.7.59] — 2026-04-25

### Fixed
- **Pencil ✏ click did nothing in v1.7.58.** The lucide SVG inside
  the `<button>` was capturing clicks before they bubbled to
  `onClick`. Adding `style={{ pointerEvents: 'none' }}` to both
  Check + Pencil SVGs lets clicks pass through to the parent button.
  Same fix applied to Check icon defensively.

---

## [1.7.58] — 2026-04-25

### Changed
- **Choice-row icons swapped to `lucide-react`** Check + Pencil
  components (`size={12}`, `strokeWidth` 2.4 / 2.2). Replaces the
  prior Unicode `✓` + emoji-y `✏`. Adds `lucide-react ^1.11.0` dep.

---

## [1.7.57] — 2026-04-25

### Changed
- Replaced Unicode `✏` (heavy emoji-style glyph) with a thin inline
  SVG pencil. Same Charple stroke. *(Subsequently swapped to
  lucide-react Pencil in v1.7.58.)*

---

## [1.7.56] — 2026-04-25

### Fixed
- **Choice-row border style restored.** v1.7.53 dropped the original
  v1.7.x choice-button border when adding the per-row ✓/✏ icons —
  rows became flat divs with no visual cue they were selectable.
  Border (1px Charcoal → Charple on hover) + 6px border-radius +
  6/12 padding restored. Hover still reveals the action icons; the
  whole row also tints Charple at 8% on hover for clarity.
- **InlineResult cap label** no longer concatenates lines + chars
  ("X more lines · Y more chars"). Caps are now strictly one-or-the-
  other: `lines > 12` truncates by lines, ELSE `chars > 800`
  truncates by chars. Whichever exceeds threshold first owns the
  truncation; never mix. Lines have priority — if both would fire
  in theory, the line cap runs and chars are ignored.

### Added
- **Subscription reset countdown next to each %% bar.** /usage TUI
  scrape now also extracts the "Resets in 4h 12m" / "Resets on
  Apr 30" string per section. ModelUsageBar renders it next to the
  corresponding %%:
    `5h ▰▰ 23% · in 4h 12m   7d ▰ 5% · in 6d 14h`
  String is verbatim from claude (could be relative or absolute
  depending on how /usage formats it).

---

## [1.7.55] — 2026-04-25

### Fixed
- **InlineResult collapse caps now apply cumulatively.** Old logic
  was `if byLines || byChars: pick one branch and slice`, which
  meant a `head -10` Bash result with 25 short lines × 25 chars =
  625 chars would slice to "first 600 chars" → ≈ 24 visible lines
  (slipping through the 12-line gate entirely). Now: trim by lines
  first (cap 12), then char-trim the line-trimmed result (cap 800).
  Whichever cap bites tighter wins. Per-tool 8-line Bash special
  case dropped — the new cumulative rule handles wide-line Bash
  correctly without needing a special threshold. Hidden label now
  reports both numbers when both fired (`X more lines · Y more chars`).

---

## [1.7.54] — 2026-04-25

### Refactored / Added
- Extracted structured-output parsing from `formatStructuredOutput`'s
  inline body into a new pure module `structured-format.ts` exposing
  `parseStructuredLine` / `parseStructuredOutput` / `glyphColor` plus
  the `StructuredLine` / `StructuredSegment` types. The renderer
  helper now only handles JSX → still does same thing visually.
- 19 new vitest cases covering: glyph color mapping (`✓ ✔ ●` →
  Julep, `✗ ❌` → Sriracha, `⚠` → Zest, fallback → Ash); heading
  detection (`=== Title ===` requires 3+ equals + surround whitespace,
  rejects `===title===`); blank line; mixed-script titles (CJK);
  inline glyph splitting + text segment ordering; multi-glyph lines
  with different colors; whitespace preservation; multi-line input
  parsing; realistic 8-task stem-regen sample. Total: 419 → 438.

---

## [1.7.53] — 2026-04-25

### Changed
- **Trailing list rendering** no longer assumes the list is a "pick
  one" question. stream-json doesn't distinguish a real choice
  question from a TODO / next-steps list — both are plain markdown.
  So instead of guessing, every numbered/lettered trailing list
  item now renders as a regular line with two hover-revealed
  action icons on the right:
    - **✓ (Julep)** — treat this row as my reply (existing onChoose
      behavior: re-send the raw line as a user message).
    - **✏ (Charple)** — quote this row into the input box prefixed
      with `-- ` so the user can append a free-form response, then
      hit Enter when ready.
  Hovering the row also shifts its background to a subtle Charple
  tint so it's clear which item the icons act on. Works whether
  claude is asking a real question OR dropping a next-steps list —
  same UI, no detection needed.

---

## [1.7.52] — 2026-04-25

### Fixed
- **Permission allow was rejected by claude with a Zod error** for any
  tool with non-trivial permission shape (Skill, custom MCP). v1.7.21
  changed the deny payload correctly but missed adding `behavior:
  "allow"` to the allow branch — sent `{updatedInput: ...}` alone.
  Both branches of the union require `behavior`. Symptom: ⚠ "Tool
  permission request failed: ZodError: invalid_union ..." in the
  timeline whenever the user clicked Allow on a Skill call. Fixed:
  allow now sends `{behavior: "allow", updatedInput: <input>}`.

### Added
- **Bullet-point styling** for markdown `<ul>` lists in HiveChat:
  `▸` Charple `#6B50FF` markers replacing the default browser disc.
  Matches the chat's other "next-tier" Charple accents (tool block
  border, summary tag, auto-compact divider). Numbered lists `<ol>`
  unchanged — the digit itself is information. Scoped via
  `.hive-chat-md` class so xterm Term + the rest of the app are
  unaffected.

---

## [1.7.51] — 2026-04-25

### Added
- **● Julep status dot on every assistant text reply** — symmetric to
  the Julep `❯` on user input. Tool calls keep their per-tool ●;
  this is for plain-text replies that previously had no visual
  marker.
- **`[SUMMARY]` tag** when the reply starts with a recognized
  summary marker (`Summary:` / `## Summary` / `**Summary**` /
  `总结：` / `结论:` / `小结` / `Final Report`, case-insensitive,
  with or without inline title). Tag is Julep-bordered uppercase
  badge; an optional title (text after the colon) renders as a
  Butter subtitle. Heading line is stripped from the body so the
  markdown content flows naturally below.
- 11 new vitest cases for the new `detectSummary` helper covering
  no-marker / plain prefix / `## Summary` / bold / Chinese variants
  / case-insensitivity / blank-line stripping / mid-text rejection.
  Total: 408 → 419.

### Changed
- **Agent panel R&D / Non-R&D card borders** changed from
  `border-border/50` (resolved to a near-invisible gray-purple) to
  solid Charple `#6B50FF` — same purple as the chat tool-block
  vertical line. Borders now read as deliberate frames, not
  accidental.

---

## [1.7.50] — 2026-04-25

### Changed
- **Close-session confirm is now a panel**, not a button-row. Click
  `close ✕` on the bottom bar → input area swaps to a Sriracha-bordered
  confirm panel with explanatory copy + `[Cancel] [OK · close session]`.
  Cancel reverts to the normal textarea. OK fires the actual stopChat
  → existing "session closed" + Start new session panel takes over.
  Same destination as v1.7.49 but the confirm UI is in the panel
  zone where the user is already looking, not crammed into the
  status bar.

---

## [1.7.49] — 2026-04-25

### Changed
- **Close session is now two-step.** First click on `close ✕` expands
  the button into `[cancel] [confirm close ✕]`; only the second click
  on confirm actually kills the subprocess. Confirming state
  auto-reverts after 4s of inactivity so a stray click can't strand
  the bar in confirm-mode. Killing a running session was too
  destructive for a single-click hit.

---

## [1.7.48] — 2026-04-25

### Added
- **Stop reason badge** on the result summary card. When
  `result.stop_reason !== 'end_turn'` the card label flips from
  `TURN COMPLETE` to `STOPPED: <reason>` with a colored left border:
  Sriracha for refusal / max_tokens / model_context_window_exceeded,
  Zest for pause_turn / tool_use, Squid for unknown. Refusals are
  now impossible to miss.
- **File-link click** in tool headers opens with default app via
  `shell.openPath`. Shift/Alt-click reveals in Finder. URLs (WebFetch
  / WebSearch) route to default browser. Existing `revealInFinder`
  handler kept untouched for compatibility.
- **Code-block copy button** on every fenced markdown code block.
  Hover reveals a Charcoal-bordered `📋 copy` button at the top-right;
  click → navigator.clipboard.writeText, badge swaps to Julep
  `✓ copied` for 1.5s, then fades.

### Backend
- New `fs:openPath` IPC + `window.api.fs.openPath(path)`. Calls
  `shell.openPath`; "" return = success, otherwise error string.

---

## [1.7.47] — 2026-04-25

### Fixed
- **`❯` prompt glyph color restored to Julep mint green** per
  `ui-preview-decorations.html` (the design contract). It had drifted
  to Dolly pink in a recent change — both the input box prompt and
  the sent-message bubble's prompt are now back to spec.

### Added
- **Structured Bash output formatting.** `=== Title ===` heading lines
  in tool results now render as BBQ-backed cards with a Charple left
  border. Inline glyphs get colored: `✓` `✔` `●` → Julep, `✗` `❌` →
  Sriracha, `⚠` → Zest. Other content passes through unchanged. Makes
  scripts that print `=== 8 tasks done ===` followed by `✓ id1  ✓
  id2` look like a proper summary rather than ASCII soup.

---

## [1.7.46] — 2026-04-25

### Added
- **Drag-and-drop file → input box** in HiveChat. Drop one or more
  files anywhere on the chat surface (from FilesPanel or Finder) and
  their absolute paths get appended to the textarea, quoted if the
  path contains spaces, separated by spaces, then the input is
  focused so you can keep typing. Plain-text drops (e.g. selected
  text from another editor) work too. Mirrors Terminal's existing
  drop behavior, just routed to the chat input instead of the PTY.

---

## [1.7.45] — 2026-04-25

### Fixed
- **Subscription %% (5h / 7d) silently went blank for every agent
  after v1.7.31's shared cache.** Root cause: I switched the cold-
  scrape PTY's `cwd` from each agent's project dir to `$HOME` to
  make the cache feel "global". But interactive `claude` gates input
  on a workspace-trust dialog the first time it sees an unfamiliar
  directory. `$HOME` had never been opened as a project → trust
  dialog → `/usage\r` never sent → 25s timeout → cache filled with
  `pct: null`. Every subsequent agent refresh hit that null cache.
  Fix: caller passes its `cwd` (an already-trusted agent project),
  and we skip caching a null result so the next refresh gets a
  fresh chance with potentially a different (trusted) cwd.

---

## [1.7.44] — 2026-04-25

### Changed
- Reordered ModelUsageBar: `model (1M) ctx 47% | 5h 23% 7d 5%   • streaming  close ✕`.
  Context %% lives next to `(1M)` because both describe "this session's
  context window"; subscription `5h` / `7d` are account-level and live
  on the other side of the `|`. Action buttons stay right-pushed.
- Removed the redundant `4h 12m left` ETA from the bottom bar — the
  RateLimitBar above the input already shows the same reset countdown.

---

## [1.7.43] — 2026-04-25

### Added
- **↺ Recall icon on each sent UserMessage bubble.** Hover over your
  past message → ↺ icon appears at the right → click → fills the input
  box with that text and focuses the textarea. Edit & resend.
  Replaces the ↑/↓ keyboard recall (chat-native: ↑ stays as plain
  textarea cursor navigation). The pure recall.ts helpers + 12 vitest
  cases stay in tree for potential keyboard re-enable later.
- **Long-running tool spinner** under the ToolBlock header when a
  `tool_use` has been issued for >5s without a matching `tool_result`.
  Same Charple→Dolly scrolling gradient as the thinking spinner.
  Verb adapts to tool: `shell still running…` (Bash), `subagent still
  running…` (Task / Agent), `tool still running…` (everything else).
  Silent for the first 5s so quick tools (1-3s) don't flash a spinner.
- **Auto-compact divider** in the timeline. Detected when
  `result.usage.input_tokens` drops by more than half (and ≥30K
  delta) — heuristic for "claude just summarized old turns to free
  context". Renders a Charple gradient bar with summary
  `── auto-compacted · N turns summarized · 180K → 35K ──`. Surfaces
  what was previously a silent event so the user knows the old
  conversation above is no longer in the model's literal context,
  just a summary.

---

## [1.7.42] — 2026-04-25

### Added
- **Stop button (■)** at the right of the input box. Appears only
  while claude is generating (`sending` or `thinking`). Click sends a
  `control_request {subtype: "interrupt"}` to claude on stdin —
  cancels the current turn (mid-thinking, mid-tool-call, mid-text)
  without ending the session. Discovered the protocol by grepping
  the claude binary for `sendControlRequest` patterns.
- **Context window % bar** in the bottom status bar:
  `ctx ▰▰▰▱▱▱▱▱ 47%`. Driven by the latest `result.usage.input_tokens`
  vs the parsed model context window (`1M` / `200K` from system/init).
  Color shifts Bok → Zest → Sriracha as it crosses 70% / 85%, so you
  see auto-compact coming. Hover for raw tokens.

### Backend
- `interruptSession(id)` + `chat:interrupt` IPC. Fire-and-forget; no
  ACK in stream-json land.

---

## [1.7.41] — 2026-04-25

### Fixed
- **Task tool header no longer dumps the full subagent prompt.**
  argSummary used to return `input.prompt` verbatim, which is often
  1k+ chars and reads as a noisy second copy of the user's own
  message that triggered the Task call. New `TaskHeader` component
  renders: `● Task [subagent_type] short-description-or-truncated-
  prompt`. Uses `input.description` (Task's purpose-built short
  field) when present, else truncates `prompt` to 120 chars with
  whitespace collapsed. `subagent_type` shown as a small Dolly badge.

---

## [1.7.40] — 2026-04-25

### Fixed
- **Voice input now reaches HiveChat input.** App.tsx mic was hard-
  writing transcripts to PTY (`window.api.pty.write`); when the user
  was in chat mode, xterm was hidden and transcripts vanished into a
  void. Now: App broadcasts a `hive:voice-final` CustomEvent. Terminal
  listens and writes to PTY only when `chatMode === false`. HiveChat
  listens and appends to its input box (smart whitespace separator so
  multiple voice segments stack naturally).
- Removed Terminal's stale `onTranscript` listener that was double-
  feeding the PTY (raw `final:` prefix was leaking into terminal output).

---

## [1.7.39] — 2026-04-25

### Changed
- Shortened "⏹ close session" → "close ✕" so it doesn't wrap to a
  second line in the bottom status bar on narrower windows. `nowrap`
  added so it never breaks again.

---

## [1.7.38] — 2026-04-25

### Changed
- Bumped HiveChat dark background from `#0f0a1a` → `#170d2e` (slightly
  more violet — same dark feel, more "Crush deep-violet" than
  "almost-black"). User pick after side-by-side.

---

## [1.7.37] — 2026-04-25

### Fixed
- **Markdown tables in Read results no longer get shredded.** Prism's
  markdown grammar emits multi-line tokens for tables (one token whose
  content includes `\n`), which prism-react-renderer's per-line splitter
  fragments — table rows scatter across rendered `<div>`s, every `|`
  ends up on its own line. Fix: `.md` / `.markdown` extensions fall
  through to `markup` (HTML grammar), which is effectively pass-through
  for markdown source without HTML tags. Source displays line-for-line.
  Regression guard added in `renderers-helpers.test.ts`.

---

## [1.7.36] — 2026-04-25

### Fixed
- **`/desktop` polite handover before killing remote-control PTY.**
  `resumeFromRemoteControl` was hard-killing the PTY without first
  releasing the server-side claim that `/remote-control` registered.
  Server thought the session was still mobile-owned → next `--resume`
  could land in stale / partial state and the mobile end might not
  release cleanly. Now: write `/desktop\r` to the PTY, wait 1.5s for
  the handover to settle, then kill + re-spawn `--print --resume <sid>`.

---

## [1.7.35] — 2026-04-25

### Fixed
- **HiveChat now locks to deep-purple `#0f0a1a` background** regardless
  of system / Hive theme. In light mode, `var(--bg-primary)` resolved
  to white and the entire Crush palette (Butter / Ash text + Charple /
  Dolly / Julep accents — all engineered for a dark base) collapsed
  into invisibility. xterm Term tab is unchanged (already dark via
  xterm.js's own theme config).

---

## [1.7.34] — 2026-04-25

### Refactored / Added
- Extract `summarizeFiles(files, cutoffMs)` from storage walker into a
  pure function so the bucketing logic (totals / main vs subagent /
  stale boundaries / topStale ranking) is unit-testable without
  touching the real filesystem.
- 10 new vitest cases covering empty input, total counting, main-vs-
  subagent split, mtime cutoff strict-`<` boundary (both directions),
  stale main/subagent split, topStale capped at 20 + descending sort,
  and a realistic mixed batch. Total: 397 → 407.

---

## [1.7.33] — 2026-04-25

### Fixed
- **Tighter collapse on Bash results.** InlineResult's gates were
  permissive enough that wide-but-few-line Bash output (11 lines × 80
  chars = 880) dodged both byLines (12) and byChars (1200) and dumped
  uncollapsed. Bash / BashOutput now collapse at 8 lines / 600 chars;
  other tools keep gentler caps.

---

## [1.7.32] — 2026-04-25

### Added
- **Built-in cleanup for `~/.claude/projects`** in App Settings →
  Storage. Slider 1-90 days, default 15. Shows total + breakdown
  (main sessions vs subagent transcripts), live size delta as the
  slider moves, two-click delete (Delete → Confirm) so a misclick
  can't nuke things, post-delete summary.
- Verified subagent JSONLs (`subagents/agent-*.jsonl`) are sidechain
  transcripts that Claude's `/resume` picker filters out
  (`isSidechain=true` in binary strings) — safe to delete.

---

## [1.7.31] — 2026-04-25

### Performance
- **Shared `/usage` cache** across all HiveChat sessions. Subscription %%
  is account-scoped — N agents see the same numbers — so spawning N
  PTY scrapes per refresh was wasteful. Now: one process-wide cache
  (TTL 30s) + in-flight promise dedup. Concurrent callers all await
  the same scrape; warm-cache callers return instantly with no PTY.
  Net effect with N agents: 1 PTY for the cold burst (was N), 0 PTY
  during the 30s warm window (was N).

---

## [1.7.30] — 2026-04-25

### Added
- **⏹ Close session button** in the bottom status bar — kills the
  `claude --print` subprocess while keeping the full timeline visible,
  so the user can step away without burning API.
- **⊕ Start new session panel** appears in place of the input area when
  the subprocess has exited (user-initiated or natural). Spawns a fresh
  session with the same agent (no `-c`, no `--resume`); adds a `── new
  session ──` divider to the timeline so the context boundary is clear.
- Close button hidden when not applicable (already closed / in remote-
  control mode) so it never does the wrong thing.

---

## [1.7.29] — 2026-04-25

### Added
- **`/remote-control` round-trip.** Typing `/remote-control` in HiveChat
  triggers a session-scoped slash-command handler that:
  1. Kills the current `--print` subprocess
  2. Spawns node-pty `claude --resume <claude_sid>` (interactive TUI)
  3. Writes `/remote-control\r` after the prompt settles
  4. Forwards PTY stdout to the renderer so pairing URL / QR are visible
  5. Shows a Dolly-bordered pairing panel with a **"↺ Resume session
     here"** button in place of the textarea
  6. Click → kills PTY, re-spawns `--print --resume <sid>`, replay
     picks up any mobile-driven turns
- Backend plumbing generalizes to other session-scoped slashes
  (`/clear`, `/compact`, `/model`) — just add them to the renderer's
  intercept list with the right PTY input.

### Changed
- `ChatSession` gained `mode: 'print' | 'rc'`, `rcPty?`, `claudeSid`,
  `startOpts` fields.
- `sendUserMessage` / `respondPermission` now refuse when
  `mode !== 'print'`.
- `startChat` accepts a new `resumeSid` opt for explicit
  `--resume <sid>` semantics.

---

## [1.7.28] — 2026-04-25

### Added
- **Load older messages** button at the top of HiveChat when a session has
  more JSONL history than the live 500-entry cap. Fetches prior events in
  batches from `~/.claude/projects/<cwd>/<sid>.jsonl` and prepends them to
  the timeline atomically (no scroll flicker).
  - Backend: `replaySessionHistory` now takes `limit=500` and records a
    `(replayFile, replayedFrom)` cursor on the session.
  - New `loadOlderHistory` + `chat:loadOlder` IPC; `chat:prepend:<id>`
    broadcast channel.
- **26 new vitest cases** covering `flatten.ts` (14) and `recall.ts` (12).
  Total cases: 371 → 397.

### Fixed
- `DiffPanel` (Edit / MultiEdit tools) now honours
  `DEFAULT_EXPANDED_LINES = 12` with a **Show N more lines / Collapse**
  toggle. Previously dumped all rows (140+ for a large edit) to the DOM.

### Refactored
- Extracted `flattenHistoricalEvents` (event → TimelineEntry) and the
  `recallUp` / `recallDown` / `pushAfterSend` state machine into pure
  modules (`flatten.ts`, `recall.ts`) so they're unit-testable without a DOM.

---

## [1.7.27] — 2026-04-25

### Fixed
- **HiveChat sticky mount.** Switching agents or flipping Term↔Chat used
  to unmount HiveChat → `useEffect` cleanup killed the underlying
  `claude --print` subprocess → returning burned an API turn on resume
  and dropped any in-flight thinking. Now HiveChat stays mounted for the
  Terminal's lifetime and visibility is CSS-driven, matching xterm. One
  live `claude` per agent-with-chat-open — which is the whole point of
  Hive's multi-agent orchestration.

---

## [1.7.26] — 2026-04-25

### Added
- **Timeline cap (500 entries)** in HiveChat with a subtle "N earlier
  messages trimmed" hint. Prevents runaway React state on very long
  sessions; JSONL on disk remains the source of truth.
- **30-day retention** for `~/.hive/chat-logs/*.jsonl`. A sweep runs once
  on main-process startup; `~/.claude/projects` (Claude Code's own
  persistence) is never touched.

---

## [1.7.25] — 2026-04-25

### Added
- **↑/↓ recall** for sent user messages (bash-style). Stores a 100-entry
  ring; `↑` at the first line of the textarea (or while already browsing)
  steps back, `↓` walks forward with draft restoration past the newest.
  IME composition still short-circuits early.

### Changed
- **Softer user-message bubble.** Replaced the solid Dolly background
  (eye-burning) with a 1px Dolly border + `rgba(255,96,255,0.14)` tint +
  solid Dolly `❯` + Butter text — same design language as the input box.

---

## [1.7.24] — 2026-04-25

### Added
- **README: HiveChat section** announcing the new Crush-styled React chat
  mode with bullets covering streaming typewriter, colored ToolBlocks,
  Edit diff panel, syntax highlighting, clickable choices (numbered +
  letter), permission modal, real subscription %%, session resume,
  redaction, thinking spinner, IME-safe enter, 371 tests.

### Changed
- **Journey deck** (`docs/slides-hivechat-journey.html`) extended through
  v1.7.23: timeline adds v1.6.6 → v1.7.23; *What's shipped today* slide
  refreshed; *Next up* shuffled to reflect what shipped; Lesson #6 added
  (silent subprocess hang = missing handshake reply — the v1.7.18 lost
  afternoon). Roadmap marks HiveChat + real subscription %% done; adds
  session-scoped slash commands (`/remote-control`, `/clear`, `/compact`,
  `/model`) with the planned `--print → PTY --resume → --print` round-trip.

---

## [1.7.23] — 2026-04-24

### Changed
- **Thinking spinner** uses a `Charple → Dolly` scrolling gradient
  (`background-clip: text` + 400% `background-size` + keyframes), verified
  against Crush's `makeGradientRamp` source.

---

## [1.7.22] — 2026-04-24

### Changed
- **Sent user messages** rendered with a solid Dolly background + Butter
  text so they're visually distinct from the input box. *(Reverted to a
  softer alpha-tinted version in v1.7.25 after user feedback.)*

---

## [1.7.21] — 2026-04-24

### Fixed
- **Permission schema** recovered from a captured log — allow =
  `{updatedInput: <record>}`, deny = `{behavior: 'deny', message: <string>}`.
  Fixed the silent subprocess hang introduced in v1.7.18.
- **Letter choices** (`A）不修` / `B）先修`) now rendered as clickable
  buttons. Regex upgraded to match `(\d+|[A-Za-z])` with ascii or fullwidth
  parens, allowing zero space between marker and CJK label.
- **File-tool colors** aligned to preview: Read / Edit / Grep = Julep
  green (file-touching), Bash = Malibu blue (commands).

---

## [1.7.20] — 2026-04-24

### Added
- **Thinking spinner** — `✳ Blanching… 3s` (verb cycles through a list,
  glyph rotates, elapsed counter ticks) shown at the bottom of the
  timeline from `message_start` until the first `text_delta` or
  `message_stop`.

---

## [1.7.19] — 2026-04-24

### Added
- **MCP tool cards** — `mcp__<server>__<function>` split into a
  color-coded server pill + function name row.
- **Result summary card** at the end of each assistant turn — cost,
  duration, tokens, cache reads.
- **Allow & remember** — permission modal writes `ToolName(pattern)` into
  `~/.claude/settings.json` `permissions.allow` so future calls bypass.
- **Slash-command pill** — `/compact`, `/clear`, etc. render as rounded
  Dolly pills with a `⚡` glyph.

---

## [1.7.18] — 2026-04-24

### Fixed
- **Permission modal handshake** re-wired — `--permission-prompt-tool stdio`
  requires a `control_response` reply on stdin for every `control_request`
  on stdout. Earlier attempts hung the subprocess. (Full schema fix
  landed in v1.7.21.)

---

## [1.7.16] — 2026-04-23

### Fixed
- Rebase output now flows into the timeline as `system` entries rather
  than a pinned box above the input.

---

## [1.7.15] — 2026-04-23

### Added / Changed
- **FilesPanel footer** respects `streamingMode` (redacts path when on).
- **Shared `shortenPath`** utility unified across Chat, Terminal, and
  FilesPanel.

---

## [1.7.14] — 2026-04-23

### Added
- Initial **vitest coverage** for hive-chat pure helpers.

---

## [1.7.13] — 2026-04-23

### Changed
- Shorter % bars in the usage row; dropped "in 5h block" text so the
  streaming-mode toggle fits on one line.

---

## [1.7.12] — 2026-04-23

### Changed
- Swapped Charple↔Dolly: input/user messages use Charple accents,
  tool-block borders use Dolly.

---

## [1.7.11] — 2026-04-23

### Fixed
- Cleaner status bars — dropped cost/burn from the top row; moved the
  "waiting for first message" placeholder above the input.

---

## [1.7.10] — 2026-04-23

### Fixed
- No more outer horizontal scrollbar on the whole timeline
  (`overflowY: auto, overflowX: hidden`; wide content scrolls inside its
  own block).
- Streaming-mode toggle always visible in the status bar.

---

## [1.7.9] — 2026-04-23

### Added
- **Streaming-mode toggle** in the status bar — flips between live
  token-by-token rendering and batch snapshots.
- **Dynamic user redaction** — screen-only masking of username +
  configurable secret patterns at runtime via `configureRedact`.
- **Secret masking** — Bearer tokens, Basic auth, common API-key shapes.

---

## [1.7.8] — 2026-04-23

### Added / Fixed
- **Screen redact** — `meiyang → m****g` et al. on-screen only (no JSONL
  mutation).
- Fixed a **duplicate-render bug** where the same assistant message
  appeared twice (stream_event vs cumulative assistant snapshot keying).

---

## [1.7.7] — 2026-04-22

### Added / Fixed
- **Syntax highlighting** in Read / Bash results via
  `prism-react-renderer` with a Crush theme.
- **Typing perf** — `React.memo` + `useMemo` + `useCallback` across the
  timeline; typing latency on large sessions drops from 1s+ to
  near-instant.
- **Smart collapse** on long tool results (12-line default).

---

## [1.7.6] — 2026-04-22

### Added
- **Error tool result** rendering with Sriracha text + background tint.
- **Read panel with line numbers** — gutter-aligned, clickable file path
  opens in Finder.

---

## [1.7.5] — 2026-04-22

### Added
- **Session resume replays JSONL history** when `continueSession` is on.
  Reads `~/.claude/projects/<cwd-slug>/<sid>.jsonl` and emits past
  user/assistant turns as `_historical: true` events.
- **Tilde path display** for paths under `$HOME`.

---

## [1.7.4] — 2026-04-22

### Added
- **Crush-styled markdown tables** rendered by `react-markdown` +
  `remark-gfm`.
- **Diff gutter line numbers** in the Edit diff panel.

---

## [1.7.3] — 2026-04-22

### Fixed
- **IME-safe Enter** — no accidental send mid-pinyin composition.
- **Event-driven usage refresh** — `/usage` scrape fires on `message_stop`
  (30s debounce), not on an idle timer.

---

## [1.7.2] — 2026-04-22

### Added
- **Real subscription %%** via node-pty + `@xterm/headless` scraping of
  the interactive `/usage` TUI. Replaces previous guesses.

---

## [1.7.1] — 2026-04-22

### Added
- **ccusage-backed usage bar** (local, reads `~/.claude/sessions/`).
- `--include-hook-events` + `--permission-prompt-tool stdio` wired.

---

## [1.7.0] — 2026-04-22

### Added
- **Streaming typewriter** — hook into `content_block_delta` for live
  token-by-token text.
- **Edit diff panel** — before/after in Julep-plus / Sriracha-minus split.
- **Inline-code fix** — `react-markdown` v10 dropped the `inline` prop;
  detect via className / newline instead.

---

## [1.6.6] — 2026-04-21

### Added
- Usage % via `/usage`; Dolly progress bars; resume indicator in the
  empty-state hint.

---

## [1.6.5] — 2026-04-21

### Changed
- **Chat = default mode** (Term stays as fallback).
- Term startup flags mirrored onto Chat (`-c`, rebase-on-start).
- Hive-native deep-purple (`#0f0a1a`) background.

---

## [1.6.4] — 2026-04-21

### Added
- **Input box grows with content** (autosize textarea, 20–200px).
- **Markdown rendering** via `react-markdown`.
- **Clickable numbered choices** — `1. … 2. … 3. …` inline options.

---

## [1.6.3] — 2026-04-21

### Fixed
- **Dolly-bordered ToolBlock** wraps call + result together so the bar
  spans both.

---

## [1.6.2] — 2026-04-21

### Added
- **Status bars** — rate-limit row above input, model/usage row below.

---

## [1.6.1] — 2026-04-20

### Fixed
- **HiveChat schema accuracy** — dedup by `msg.id`, drop `thinking`
  blocks, auto-capture to `/tmp/claude-json.log` for iteration.

---

## [1.6.0] — 2026-04-20

### Added
- **HiveChat POC** — structured JSON chat mode backed by
  `claude --print --input-format stream-json --output-format stream-json
  --include-partial-messages`. Pretty-mode decoration path suspended
  (see `pretty-term/SUSPENDED.md`).

---

## [1.5.1] — 2026-04-18

### Added
- **Crush color remap** (24-bit SGR → Crush palette) + persistent
  user-input highlight in xterm decorations.

---

## [1.5.0] — 2026-04-18

### Changed
- **Pretty mode = xterm + Crush decoration overlays** (dead end; replaced
  by HiveChat in v1.6.0).

---

## [1.4.0] — 2026-04-17

### Changed
- **PrettyTerm rebuilt on `@xterm/headless`** + split into modules.

---

## [1.3.1] — 2026-04-17

### Fixed
- **CJK double-width** + **IME** for PrettyTerm.

---

## [1.3.0] — 2026-04-17

### Added
- **PrettyTerm** — Crush-styled React terminal with full interactivity
  (dead end; kept for reference).

---

## [1.2.0] — 2026-04-16

### Added
- **ClaudeTerm** — React-rendered terminal as xterm.js alternative
  (dead end).

---

## [0.8.0] — 2026-04-10

### Added
- Task-group gate reform + stuck detection for multi-agent orchestration.

---

[Unreleased]: https://github.com/nocodevit/hive/compare/v1.7.64...HEAD
[1.7.64]: https://github.com/nocodevit/hive/compare/v1.7.63...v1.7.64
[1.7.63]: https://github.com/nocodevit/hive/compare/v1.7.62...v1.7.63
[1.7.62]: https://github.com/nocodevit/hive/compare/v1.7.61...v1.7.62
[1.7.61]: https://github.com/nocodevit/hive/compare/v1.7.60...v1.7.61
[1.7.60]: https://github.com/nocodevit/hive/compare/v1.7.59...v1.7.60
[1.7.59]: https://github.com/nocodevit/hive/compare/v1.7.58...v1.7.59
[1.7.58]: https://github.com/nocodevit/hive/compare/v1.7.57...v1.7.58
[1.7.57]: https://github.com/nocodevit/hive/compare/v1.7.56...v1.7.57
[1.7.56]: https://github.com/nocodevit/hive/compare/v1.7.55...v1.7.56
[1.7.55]: https://github.com/nocodevit/hive/compare/v1.7.54...v1.7.55
[1.7.54]: https://github.com/nocodevit/hive/compare/v1.7.53...v1.7.54
[1.7.53]: https://github.com/nocodevit/hive/compare/v1.7.52...v1.7.53
[1.7.52]: https://github.com/nocodevit/hive/compare/v1.7.51...v1.7.52
[1.7.51]: https://github.com/nocodevit/hive/compare/v1.7.50...v1.7.51
[1.7.50]: https://github.com/nocodevit/hive/compare/v1.7.49...v1.7.50
[1.7.49]: https://github.com/nocodevit/hive/compare/v1.7.48...v1.7.49
[1.7.48]: https://github.com/nocodevit/hive/compare/v1.7.47...v1.7.48
[1.7.47]: https://github.com/nocodevit/hive/compare/v1.7.46...v1.7.47
[1.7.46]: https://github.com/nocodevit/hive/compare/v1.7.45...v1.7.46
[1.7.45]: https://github.com/nocodevit/hive/compare/v1.7.44...v1.7.45
[1.7.44]: https://github.com/nocodevit/hive/compare/v1.7.43...v1.7.44
[1.7.43]: https://github.com/nocodevit/hive/compare/v1.7.42...v1.7.43
[1.7.42]: https://github.com/nocodevit/hive/compare/v1.7.41...v1.7.42
[1.7.41]: https://github.com/nocodevit/hive/compare/v1.7.40...v1.7.41
[1.7.40]: https://github.com/nocodevit/hive/compare/v1.7.39...v1.7.40
[1.7.39]: https://github.com/nocodevit/hive/compare/v1.7.38...v1.7.39
[1.7.38]: https://github.com/nocodevit/hive/compare/v1.7.37...v1.7.38
[1.7.37]: https://github.com/nocodevit/hive/compare/v1.7.36...v1.7.37
[1.7.36]: https://github.com/nocodevit/hive/compare/v1.7.35...v1.7.36
[1.7.35]: https://github.com/nocodevit/hive/compare/v1.7.34...v1.7.35
[1.7.34]: https://github.com/nocodevit/hive/compare/v1.7.33...v1.7.34
[1.7.33]: https://github.com/nocodevit/hive/compare/v1.7.32...v1.7.33
[1.7.32]: https://github.com/nocodevit/hive/compare/v1.7.31...v1.7.32
[1.7.31]: https://github.com/nocodevit/hive/compare/v1.7.30...v1.7.31
[1.7.30]: https://github.com/nocodevit/hive/compare/v1.7.29...v1.7.30
[1.7.29]: https://github.com/nocodevit/hive/compare/v1.7.28...v1.7.29
[1.7.28]: https://github.com/nocodevit/hive/compare/v1.7.27...v1.7.28
[1.7.27]: https://github.com/nocodevit/hive/compare/v1.7.26...v1.7.27
[1.7.26]: https://github.com/nocodevit/hive/compare/v1.7.25...v1.7.26
[1.7.25]: https://github.com/nocodevit/hive/compare/v1.7.24...v1.7.25
[1.7.24]: https://github.com/nocodevit/hive/compare/v1.7.23...v1.7.24
[1.7.23]: https://github.com/nocodevit/hive/compare/v1.7.22...v1.7.23
[1.7.22]: https://github.com/nocodevit/hive/compare/v1.7.21...v1.7.22
[1.7.21]: https://github.com/nocodevit/hive/compare/v1.7.20...v1.7.21
[1.7.20]: https://github.com/nocodevit/hive/compare/v1.7.19...v1.7.20
[1.7.19]: https://github.com/nocodevit/hive/compare/v1.7.18...v1.7.19
[1.7.18]: https://github.com/nocodevit/hive/compare/v1.7.16...v1.7.18
[1.7.16]: https://github.com/nocodevit/hive/compare/v1.7.15...v1.7.16
[1.7.15]: https://github.com/nocodevit/hive/compare/v1.7.14...v1.7.15
[1.7.14]: https://github.com/nocodevit/hive/compare/v1.7.13...v1.7.14
[1.7.13]: https://github.com/nocodevit/hive/compare/v1.7.12...v1.7.13
[1.7.12]: https://github.com/nocodevit/hive/compare/v1.7.11...v1.7.12
[1.7.11]: https://github.com/nocodevit/hive/compare/v1.7.10...v1.7.11
[1.7.10]: https://github.com/nocodevit/hive/compare/v1.7.9...v1.7.10
[1.7.9]: https://github.com/nocodevit/hive/compare/v1.7.8...v1.7.9
[1.7.8]: https://github.com/nocodevit/hive/compare/v1.7.7...v1.7.8
[1.7.7]: https://github.com/nocodevit/hive/compare/v1.7.6...v1.7.7
[1.7.6]: https://github.com/nocodevit/hive/compare/v1.7.5...v1.7.6
[1.7.5]: https://github.com/nocodevit/hive/compare/v1.7.4...v1.7.5
[1.7.4]: https://github.com/nocodevit/hive/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/nocodevit/hive/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/nocodevit/hive/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/nocodevit/hive/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/nocodevit/hive/compare/v1.6.6...v1.7.0
[1.6.6]: https://github.com/nocodevit/hive/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/nocodevit/hive/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/nocodevit/hive/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/nocodevit/hive/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/nocodevit/hive/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/nocodevit/hive/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/nocodevit/hive/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/nocodevit/hive/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/nocodevit/hive/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/nocodevit/hive/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/nocodevit/hive/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nocodevit/hive/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/nocodevit/hive/compare/v0.8.0...v1.2.0
[0.8.0]: https://github.com/nocodevit/hive/releases/tag/v0.8.0
