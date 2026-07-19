# Manual test plan

Cases that can't be unit- or e2e-tested (network, real installers, GUI dialogs,
keychain). Each entry: why it's untestable + reproducer steps.

## Chat resume auth failures are now logged (`_meta` spawn/stderr/exit)

**Why untestable:** real Anthropic-API auth outcomes (a transient
`403 Request not allowed`, an expired OAuth token, keychain access) depend on the
live server + the macOS login keychain — none reproducible in CI. The pure part
(the exact `claude --print … --resume <sid>` argv we spawn AND log verbatim) is
`buildChatArgs` in `src/main/chat.ts`, unit-tested in
`src/main/__tests__/chat-args.test.ts`. The forensic spawn/stderr/exit records
are written in `startChat`'s spawn path.

**Background (the observability gap this closes):** the session log file is only
created on the first *stdout* stream-json event. If claude exits BEFORE any
stdout — e.g. an auth rejection prints to stderr and the process exits non-zero —
the failure left ZERO trace (no log file, stderr only flashed in the renderer).
A user hit `403 Request not allowed` across all agents on resume with nothing in
the logs to explain it. We now write a `{_meta:"spawn",command,args,cwd}` record
immediately at spawn, and tee stderr + exit(code/signal)/spawn_error into the log.

**Verified facts about keychain auth (do NOT re-derive the wrong way):**
- claude reads the OAuth token from the login keychain fine in any process that
  has the user's **securityd session** (`SECURITYSESSIONID` set) — which a
  Finder/Dock/launchd-launched Hive.app DOES have (verified: PID had
  `SECURITYSESSIONID` + launchd parent). The binary version is irrelevant
  (v16/v18/v22 all behave identically).
- The ONLY way to make keychain reads fail is to strip the security session,
  e.g. `env -i` in a test harness. **`env -i` is therefore an INVALID
  reproduction of Hive's real environment** — it manufactures a "Not logged in"
  that the real app never sees. Don't use it to "prove" an auth bug.
- `~/.claude/.credentials.json` is a legitimate fallback claude reads when the
  keychain is unreadable, but it is NOT required when the security session is
  present.

**Reproducer (confirm a resume actually authenticates):**

1. With the security session intact (a normal Terminal, NOT `env -i`), strip the
   Claude-Desktop host-managed vars so claude is forced onto keychain OAuth:
   `( unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST CLAUDE_CODE_ENTRYPOINT; claude --print --output-format json --resume <sid> -p "say OK" )`
   → must return `"result":"OK","is_error":false","apiKeySource":"none"`.
2. In Hive: open any agent with a prior session, click **Resume** — chat must
   stream a reply. A new `~/.hive/chat-logs/<id>-<ts>.jsonl` appears whose first
   line is `{"_meta":"spawn",...}`; on any failure it also contains
   `_meta:"stderr"` / `_meta:"exit"` capturing the real error (e.g. a 403).

## Sign-in modal is always escapable + 403 never asks to sign in (`auth:cancel`)

**Why untestable (the GUI/OAuth parts):** `auth:cancel` SIGTERMs a real
`claude auth login` child and the modal flow drives the macOS browser OAuth
hand-off — neither runs in CI. The *pure* parts are unit-tested:
`dismissActionForAuthState` (`dismiss-auth-state.test.ts`) proves every non-idle
state is dismissable and that only `in-progress` kills the child;
`classifyResultError` (`classify-result-error.test.ts`) proves a
`403 Request not allowed` classifies as `region_blocked`, not `auth_expired`;
and `ResultSummaryCard` (`result-summary-card.test.tsx`) proves a 403 renders
NO Sign-in button even when a handler is wired, while a 401 does.

**Background (the Cutis incident):** a country/IP change made Anthropic return
`403 Request not allowed`, which the CLI mislabels `error:"authentication_failed"`.
Hive used to (a) pop the sign-in modal for it — useless, re-login can't fix a geo
block — and (b) the `in-progress` modal had no Cancel button, so a login that
never completes trapped the user forever.

**Reproducer:**

1. **403 path:** force a region block (e.g. run from a blocked country / VPN) and
   send a message in an agent. The result card must read **REGION BLOCKED** with
   the real `403 Request not allowed` text and restart-Hive guidance — and
   **no Sign-in button**. The sign-in modal must NOT appear.
2. **401 / escape path:** trigger a genuine auth expiry (or click the inline
   **Sign in →** on a 401 card). When the sign-in modal is `in-progress`, press
   **Esc** OR click **Cancel** — the modal closes immediately and the hung
   `claude auth login` child is gone (`ps aux | grep "auth login"` shows none).
3. **Single browser open:** when sign-in starts, the claude.ai page must open in
   the browser **exactly once**, not twice. (`claude auth login` echoes the URL
   on both stdout and stderr; `authUrlToOpen` dedupes by URL so
   `shell.openExternal` fires once. Pure dedupe covered by
   `src/main/__tests__/authUrl.test.ts`; the actual browser launch is GUI.)

## Claude CLI gate — "Install for me" (`claude:install`)

**Why untestable:** the handler runs the official installer
(`curl -fsSL https://claude.ai/install.sh | bash`), which hits the network and
writes a binary to `~/.local/bin`. CI can't run it without actually installing.
The renderer-side flow (button states, output streaming, success/failure
branching) is covered by `src/renderer/src/components/__tests__/claude-gate.test.tsx`;
the headless status short-circuit is covered by `e2e/app.spec.ts`.

**Reproducer (on a machine where `claude` is NOT on PATH):**

1. Ensure `claude` is not runnable: `which claude` returns nothing (temporarily
   rename it if needed).
2. Launch Hive. The ClaudeGate screen ("Claude Code CLI not found") should
   appear instead of the main three-column UI.
3. Click **Copy** — the install command lands on the clipboard.
4. Click **Install for me** — the button shows "Installing…", installer output
   streams into the log panel below.
5. On success, the gate disappears and the normal Hive UI loads.
6. On failure (e.g. no network), the gate stays and shows the
   "still isn't runnable" hint; **Continue anyway** still lets you into the app.

## Quit cleanup kills wedged children (`killProcessTree`)

**Why untestable:** the helper sends real OS signals (`SIGTERM`/`SIGKILL`) to
live pids and reads the live process table via `ps` — it can't run in CI without
spawning real processes and signalling them. The pure part (collecting a shell's
descendant pids from `ps` output) is `collectDescendantPids` in
`src/main/ptyProcessTree.ts`, unit-tested in
`src/main/__tests__/ptyProcessTree.test.ts`.

**Background:** node-pty's `term.kill()` only signals the login shell. A healthy
`claude` child exits when its tty closes, but a *wedged* claude (busy-loop,
ignoring SIGHUP) survives, gets orphaned to launchd (PPID 1), and spins at ~99%
CPU forever. `killProcessTree` snapshots the shell subtree, SIGTERMs every
descendant, then SIGKILLs anything still alive after 2s.

**Reproducer:**

1. Launch Hive, open an agent, click **Term** so a `claude --agent` session
   starts. Confirm `ps -Ao pid,ppid,command | grep "claude --agent"` shows it as
   a descendant of the Term shell.
2. (Optional, to simulate the wedge) `kill -STOP <claude-pid>` so it ignores
   signals — mimics the busy-loop that won't process SIGHUP.
3. Quit Hive (Cmd-Q) or close the window.
4. Within ~2s, `ps aux | grep "claude --agent"` shows **no** surviving claude —
   neither the shell nor the (stopped) claude is left orphaned with PPID 1. Before
   this fix, the claude would persist with PPID 1 at high CPU.

## Term claude reuse vs recreate (`pty:hasAgentSession`)

**Why untestable:** the IPC handler shells out to live `ps` and reads a
node-pty handle's pid — it can't run in CI without mocking electron + node-pty +
the process table. The decision logic (parsing `ps` output and walking the
shell's descendant tree for a live `claude` CLI, while ignoring the capital-C
Claude Desktop app) is fully unit-tested in
`src/main/__tests__/ptyProcessTree.test.ts`; the renderer gate that decides when
to query is covered by `src/renderer/src/__tests__/terminalAutoRun.test.ts`.

**Reproducer (an agent whose Terminal auto-runs claude):**

1. Launch Hive, open an agent. It stays on the **Chat** view by default — confirm
   `ps aux | grep "claude --agent"` shows **no** Term claude yet (only Chat's
   `claude --print`). This is the double-claude fix.
2. Click the **Term** tab. A `claude --agent hive-…` session starts in the shell.
3. Switch to **Chat** and back to **Term** a few times — no new claude spawns;
   the same session is reused (`ps` count stays flat).
4. In the Term, exit claude (Ctrl-C / `/exit`) so the shell returns to a prompt.
5. Switch to **Chat**, wait >3s, switch back to **Term** — claude is **recreated**
   (a fresh `claude --agent` session starts), because the live session check finds
   none running.

## PTY master fd release + ptmx watermark (`ptyRegistry`, `startPtyHealthMonitor`)

**Why this is here:** node-pty's `kill()` only sends SIGHUP; it never closes the
PTY master fd. Only `destroy()` does. Every teardown site used `kill()` alone, so
each spawn whose child ignored SIGHUP — or exited without node-pty observing it —
leaked one `/dev/ptmx` fd permanently. macOS caps these at `kern.tty.ptmx_max`
(511), and a 7-day-old main process was observed holding exactly 511 with only 14
live children; every subsequent spawn failed with *"Could not create a new process
and open a pseudo-tty."*

The fd count is a live OS resource, and the leak took a week of uptime to surface,
so neither vitest nor Playwright can observe it. `disposePty`, `spawnPty`,
`releasePty`, and every pure part of the health probe (major extraction, watermark
thresholds, fd counting against injected deps, report formatting) ARE unit-tested
in `src/main/__tests__/pty{Dispose,Registry,Health}.test.ts`. Containment is
enforced by `ptySpawnContainment.test.ts`. What remains manual is only the live
`/dev/fd` + `sysctl` read and the real accumulate-over-time behaviour.

**Reproducer (fd count must stay flat, not climb):**

1. Launch Hive. Note its pid: `pgrep -f 'Hive.app/Contents/MacOS/Hive'`.
2. Baseline the master fd count:
   `lsof -p <pid> | grep -c ptmx` — expect a small number (roughly one per open
   terminal, plus any in-flight usage scrape).
3. Open and close ~10 Terminal panes, and open/close a Chat session with
   remote-control (which spawns `chat-rc`) a few times.
4. Re-run the `lsof` count. It must return to approximately the step-2 baseline.
   **Pre-fix it climbed monotonically and never came back down.**
5. Leave Hive running ≥30 min so the 5-minute usage poll spawns several
   `usage-scrape` PTYs. Count again — still flat.
6. Confirm the ceiling is what you think it is: `sysctl -n kern.tty.ptmx_max`
   (511 by default).

**Watermark monitor:**

7. The monitor runs at boot and every 10 min, and logs **only** when unhealthy
   (≥50% of the ceiling = `warn`, ≥80% = `critical`), so a healthy run is silent
   by design — absence of a log line is a pass, not a missing feature.
8. To see it fire without a real leak, temporarily lower the ceiling:
   `sudo sysctl -w kern.tty.ptmx_max=20`, restart Hive, open a few terminals, and
   watch for `[pty-health] N/20 ptmx fds … level=warn` in the console. The line
   reports open vs registered fds and the oldest live handle labels
   (`terminal`, `chat-rc`, `usage-scrape`) so a future leak names its own call
   site. **Restore afterwards:** `sudo sysctl -w kern.tty.ptmx_max=511`.
