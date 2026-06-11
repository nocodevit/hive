// Gate for the Term pane's claude auto-run. Historically the launch fired on
// mount, so EVERY agent booted two claude processes — one for HiveChat
// (claude --print) and a second for a Term tab the user never opened. On an
// 8GB machine that doubled memory for no benefit.
//
// This returns true only when it's worth ASKING the main process "does this
// terminal already have a live claude session?" (see pty.hasAgentSession).
// The actual create-vs-reuse decision is then: launch only if no session is
// alive — so a session is created on first Term-open and reused thereafter,
// and recreated if it was exited. `launching` debounces the brief window
// between writing the command and claude appearing in the process table.
export function shouldCheckAgentSession(o: {
  autoRunClaude: boolean
  hasStartupCommand: boolean
  chatMode: boolean
  ptyReady: boolean
  launching: boolean
}): boolean {
  // startupCommand owns the boot path; never run the default claude command.
  return o.autoRunClaude && !o.hasStartupCommand && !o.chatMode && o.ptyReady && !o.launching
}

// Builds the shell command the Term pane writes to the PTY to start the agent's
// claude session. Mirrors the mount-time command that used to live inline in
// Terminal.tsx so behavior is identical — only the timing moved.
export function buildTerminalClaudeCmd(o: {
  agentId: string
  agentName: string
  continueSession?: boolean
  rebaseOnStart?: boolean
}): string {
  const base = `claude --agent hive-${o.agentId} -n "${o.agentName}"`
  const claudeCmd = o.continueSession ? `${base} -c` : base
  if (!o.rebaseOnStart) return claudeCmd
  const rebaseCmd =
    `git fetch origin 2>/dev/null && BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && [ -n "$BASE" ] && echo "⏳ Rebasing from origin/$BASE..." && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"`
  return `${rebaseCmd} && ${claudeCmd}`
}
