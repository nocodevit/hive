// Reap orphaned Hive chat `claude` children left behind by a previous Hive
// instance that died WITHOUT running cleanup — a crash, an OOM/jetsam kill, or a
// hard SIGKILL, none of which can run JS. Those `claude --print` children get
// reparented to launchd (ppid 1) and keep running for days, draining memory. On
// a small/shared machine that feeds a vicious cycle: memory pressure → Hive dies
// silently → its children orphan → they hold memory → more pressure → more
// deaths → more orphans. Cleanup on quit (chat.ts killAllChatChildren) handles
// the graceful case; this handles everything else, on the NEXT launch.
//
// Only the parsing/selection here is unit-tested; the actual signal-sending in
// index.ts is UNTESTABLE (real pids) and covered by docs/manual-test-plan.md.

export interface PsRow {
  pid: number
  ppid: number
  command: string
}

/** Parse `ps -Ao pid=,ppid=,command=` output into rows (blank/short lines skipped). */
export function parsePsForReap(psOutput: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of psOutput.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] })
  }
  return rows
}

/**
 * True when a command line is a Hive **chat** `claude --print` child. Keyed on
 * `--include-hook-events`, which Hive's buildChatArgs always passes and which the
 * Claude Desktop app and a plain terminal `claude` do NOT — so this can never
 * match a non-Hive claude (critical: we must never kill the user's other claude
 * sessions). The `--print` + stdio permission-prompt markers add belt-and-braces.
 */
export function isHiveChatClaude(command: string): boolean {
  return (
    command.includes('claude') &&
    command.includes('--print') &&
    command.includes('--include-hook-events') &&
    command.includes('--permission-prompt-tool stdio')
  )
}

/**
 * Pids of ORPHANED (ppid === 1) Hive chat claude children to reap at startup.
 * ppid === 1 is the safety guarantee: the process's parent Hive is already dead,
 * so this can never touch a live instance's active children (those have the live
 * Hive as their ppid). `selfPid` is excluded defensively.
 */
export function orphanedHiveClaudePids(rows: readonly PsRow[], selfPid: number): number[] {
  return rows
    .filter((r) => r.ppid === 1 && r.pid !== selfPid && isHiveChatClaude(r.command))
    .map((r) => r.pid)
}
