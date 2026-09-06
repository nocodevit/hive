// Rebase-on-start command + timeout, hardened so a stalled `git fetch` can never
// hang Hive. Root cause of the "resume 卡死": startChat ran `git fetch origin`
// via execSync with NO timeout and NO low-speed guard, so a network stall — a
// large, long-overdue fetch on a memory-thrashing machine — blocked the fetch
// AND the synchronous execSync (which runs on the Electron main thread) forever,
// freezing the whole app and trapping the resume before the agent could spawn.
//
// Two independent guards:
//  1. git self-aborts when the transfer drops below ~1KB/s for 30s
//     (http.lowSpeedLimit / http.lowSpeedTime), so a real stall ends in ~30s.
//  2. execSync gets a hard timeout backstop (below) for what the low-speed guard
//     can't see — a hung TCP connect / DNS lookup before any transfer starts.
// On either, the caller reports "rebase skipped" and spawns the agent on its
// current branch: a resume must NEVER be blocked by fetch trouble.

/**
 * Hard backstop for the synchronous fetch+rebase. Generous enough for a
 * legitimately large fetch that IS progressing, tight enough that a dead
 * connection can't freeze the main process for long.
 */
export const REBASE_ON_START_TIMEOUT_MS = 120_000

/**
 * The bash command Hive runs before a rebase-on-start spawn. The `-c http.*`
 * flags make `git fetch` self-abort on a stalled transfer instead of hanging
 * indefinitely; the rest is unchanged — rebase onto the first of
 * develop/main/master the remote has, else skip.
 */
export function buildRebaseOnStartCommand(): string {
  return (
    'git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch origin 2>&1 && ' +
    'BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && ' +
    '[ -n "$BASE" ] && echo "⏳ Rebasing onto origin/$BASE" && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"'
  )
}

/**
 * Classify an execSync failure from the rebase-on-start command. A timeout
 * (Node sets `code: 'ETIMEDOUT'` and kills with `killSignal`) or the kill signal
 * itself means the fetch stalled and was aborted — that is a SKIP (spawn anyway
 * on the current branch), not a hard error. Anything else is a real rebase
 * failure worth surfacing verbatim.
 */
export function isFetchTimeout(err: { code?: unknown; signal?: unknown } | null | undefined): boolean {
  if (!err) return false
  return err.code === 'ETIMEDOUT' || err.signal === 'SIGKILL' || err.signal === 'SIGTERM'
}
