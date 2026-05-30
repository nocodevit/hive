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
