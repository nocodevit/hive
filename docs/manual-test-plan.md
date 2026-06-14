# Manual test plan

Cases that can't be unit- or e2e-tested (network, real installers, GUI dialogs,
keychain). Each entry: why it's untestable + reproducer steps.

## Chat resume "Not logged in" in Hive's clean launchd env

**Why untestable:** depends on the macOS login keychain ACL + the minimal
environment a Finder/Dock-launched app inherits from launchd — neither is
reproducible in CI. The pure part (the exact `claude --print … --resume <sid>`
argv we spawn and log) is `buildChatArgs` in `src/main/chat.ts`, unit-tested in
`src/main/__tests__/chat-args.test.ts`. The forensic spawn/stderr/exit records
that make this failure visible are written in `startChat`'s spawn path.

**Background (the bug this guards against):** Claude Code stores its OAuth token
in the login keychain, whose ACL authorises only the specific binary that saved
it. If that binary is swapped (e.g. a CLI upgrade re-points `~/.local/bin/claude`
to a new path) the new binary can't read the keychain in headless `--print` mode
(no GUI prompt) and claude returns `Not logged in · Please run /login` /
`authentication_failed`, then exits before any stream-json. Hive's spawned claude
runs in launchd's minimal env with no Claude-Desktop host-managed auth, so it
hits this on EVERY agent resume. The fallback that fixes it: a populated
`~/.claude/.credentials.json` (read regardless of keychain ACL or env).

**Reproducer:**

1. Confirm creds are present: `ls -l ~/.claude/.credentials.json` exists and is
   valid JSON with `claudeAiOauth.refreshToken`. If missing, export from keychain:
   `security find-generic-password -s "Claude Code-credentials" -w > ~/.claude/.credentials.json && chmod 600 ~/.claude/.credentials.json`.
2. Simulate Hive's env and resume a real session:
   `env -i HOME="$HOME" PATH="$HOME/.local/bin:/usr/bin:/bin" claude --print --output-format json --resume <sid> -p "say OK"`
   → must return `"result":"OK","is_error":false`. If it returns
   `"Not logged in"`, the creds file is missing/stale (re-do step 1).
3. In Hive: open any agent with a prior session, click **Resume**. The chat must
   stream a reply, not flash an auth error. A new
   `~/.hive/chat-logs/<id>-<ts>.jsonl` appears whose first line is
   `{"_meta":"spawn",...}` and, on failure, contains `_meta:"stderr"` / `_meta:"exit"`.

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
