# Manual test plan

Cases that can't be unit- or e2e-tested (network, real installers, GUI dialogs,
keychain). Each entry: why it's untestable + reproducer steps.

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
