// Decides whether the Terminal pane should auto-launch its own `claude --agent`
// subprocess. Historically this fired on mount, which meant EVERY agent booted
// two claude processes — one for HiveChat (claude --print) and a second for the
// Term pane the user never opened. On an 8GB machine that doubled memory for no
// benefit. The fix: only auto-run when the user is actually on the Term tab
// (chatMode === false). See Terminal.tsx for the effect that consumes this.
export function shouldAutoRunClaude(o: {
  autoRunClaude: boolean
  hasStartupCommand: boolean
  chatMode: boolean
  alreadyRan: boolean
  ptyReady: boolean
}): boolean {
  // startupCommand takes precedence and is handled on its own path; if present
  // we never run the default claude command here.
  return o.autoRunClaude && !o.hasStartupCommand && !o.chatMode && !o.alreadyRan && o.ptyReady
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
