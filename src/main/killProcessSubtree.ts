import { execFileSync } from 'node:child_process'
import { parsePsRows, collectDescendantPids } from './ptyProcessTree'

export interface KillSubtreeDeps {
  /** Return `ps -Ao pid=,ppid=,command=` stdout. Overridable in tests. */
  snapshotPs?: () => string
  /** Send one signal to one pid. Overridable in tests. */
  kill?: (pid: number, signal: NodeJS.Signals) => void
  /** Schedule the SIGKILL escalation. Overridable in tests. */
  schedule?: (fn: () => void, ms: number) => { unref?: () => void }
}

const defaultSnapshotPs = (): string =>
  execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], {
    encoding: 'utf-8',
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024
  })

/**
 * Kill an entire process subtree rooted at `rootPid` — the ONE shared teardown
 * for both the PTY side (index.ts `killProcessTree`) and the chat
 * `claude --print` side (chat.ts `killChatChildTree`). Each of those used to
 * carry its own copy of this logic, which is exactly how the chat side silently
 * skipped the descendant walk and leaked tsc/node/vitest orphans (99%-CPU,
 * reparented to launchd) whenever a session was closed.
 *
 * Steps: (1) snapshot `rootPid`'s descendants via `ps` — scoped to this pid's
 * subtree, never a global pgrep, so we never touch a sibling session's tree or
 * the Claude *Desktop* helper processes; (2) run `killRoot()` — the caller
 * decides HOW to signal the root (node-pty `destroy`, `ChildProcess.kill`, or a
 * plain `process.kill`); (3) SIGTERM every descendant; (4) SIGKILL any survivor
 * after `graceMs`. Best-effort throughout — a vanished pid is never an error.
 *
 * Only the descendant-selection is pure (that lives in ptyProcessTree.ts and is
 * unit-tested there); the signal-sending here is exercised via injected `deps`.
 */
export function killProcessSubtree(
  rootPid: number | undefined,
  killRoot: () => void,
  graceMs = 2000,
  deps: KillSubtreeDeps = {}
): void {
  const snapshotPs = deps.snapshotPs ?? defaultSnapshotPs
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal))
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms))

  let descendants: number[] = []
  if (typeof rootPid === 'number') {
    try {
      descendants = collectDescendantPids(parsePsRows(snapshotPs()), rootPid)
    } catch {
      // ps failed (vanishingly rare) — still signal the root below.
    }
  }

  try { killRoot() } catch { /* already gone */ }
  for (const pid of descendants) {
    try { kill(pid, 'SIGTERM') } catch { /* gone */ }
  }
  if (descendants.length) {
    const timer = schedule(() => {
      for (const pid of descendants) {
        try { kill(pid, 'SIGKILL') } catch { /* gone */ }
      }
    }, graceMs)
    timer?.unref?.()
  }
}
