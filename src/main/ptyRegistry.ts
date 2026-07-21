import * as pty from 'node-pty'
import { disposePty } from './ptyDispose'
import { snapshotPtmxFds, reclaimOrphanPtyFds } from './ptyFdReclaim'

/**
 * The ONLY place allowed to call `pty.spawn()`.
 *
 * Before this existed, three call sites each spawned and tore down their own
 * PTY. Every teardown used `kill()`, which signals the child but never closes
 * the master fd — so all three leaked, and a fix applied to one site (6d46fb7,
 * which hardened process teardown in `killProcessTree`) silently left the other
 * two, and the fd half of its own site, unfixed.
 *
 * Routing every spawn through here means a new call site inherits correct
 * disposal by construction instead of by the author remembering. The
 * `pty-spawn-containment` test fails the build if `pty.spawn(` reappears
 * outside this file.
 */

export interface PtyHandle {
  term: pty.IPty
  label: string
  spawnedAt: number
}

const live = new Map<pty.IPty, PtyHandle>()

/**
 * Spawn a PTY and register it. `label` is diagnostic only — it shows up in
 * `livePtyHandles()` so a leak can be attributed to a call site rather than
 * to an anonymous fd number.
 */
export function spawnPty(
  label: string,
  file: string,
  args: string[] | string,
  options: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions,
  now: () => number = Date.now
): pty.IPty {
  // node-pty leaks one /dev/ptmx master fd per spawn (a dup made by
  // tty.ReadStream that it never closes). Snapshot ptmx fds immediately
  // before the spawn and close the new orphan immediately after, in the same
  // synchronous tick — see ptyFdReclaim.ts. Nothing may be awaited between
  // these two calls or a concurrent spawn's fd could be misattributed.
  const ptmxBefore = snapshotPtmxFds()
  const term = pty.spawn(file, args as string[], options)
  try {
    reclaimOrphanPtyFds(ptmxBefore, (term as unknown as { _fd?: number })._fd)
  } catch {
    /* fd reclaim is best-effort; never let it break a spawn */
  }
  live.set(term, { term, label, spawnedAt: now() })
  // Drop the registry reference when the child exits on its own. This does NOT
  // release the fd — only releasePty()/disposePty() does — but it keeps
  // livePtyHandles() honest about which spawns are still ours to tear down.
  try {
    term.onExit(() => { live.delete(term) })
  } catch {
    /* a stubbed pty in tests may not implement onExit */
  }
  return term
}

/** Unregister and fully release a PTY, master fd included. */
export function releasePty(term: pty.IPty | null | undefined): void {
  if (!term) return
  live.delete(term)
  disposePty(term)
}

/** Snapshot of PTYs this process spawned and has not yet released. */
export function livePtyHandles(): PtyHandle[] {
  return Array.from(live.values())
}

export function livePtyCount(): number {
  return live.size
}

/** Test seam — the registry is module-level state shared across suites. */
export function __resetRegistryForTests(): void {
  live.clear()
}
