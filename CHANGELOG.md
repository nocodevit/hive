# Changelog

All notable changes per released version. Entries mirror the `(vX.Y.Z)` tag
in the git commit title; dates are the commit date.

This log was back-filled from git history at v1.7.28.

---

## [Unreleased]

### Added
- *nothing yet*

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

[Unreleased]: https://github.com/nocodevit/hive/compare/v1.7.48...HEAD
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
