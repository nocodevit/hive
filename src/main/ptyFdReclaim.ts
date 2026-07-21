import { statSync, readdirSync, fstatSync, closeSync } from 'node:fs'

/**
 * Close the orphan pty master fd that node-pty leaks on every spawn.
 *
 * Empirically (node-pty 1.1.0, macOS): a single `pty.spawn()` opens TWO fds
 * pointing at `/dev/ptmx` — `term._fd`, plus a second, adjacent fd that
 * `tty.ReadStream` dups internally. node-pty tracks only `_fd`: `destroy()`
 * closes it and SIGHUPs the child, but the dup is never referenced again and
 * never closed by `kill()`, `destroy()`, `dispose()`, or the child exiting.
 * So every spawn permanently leaks one `/dev/ptmx` fd, the process reaches
 * `kern.tty.ptmx_max` (511, system-wide) after enough spawns, and all further
 * PTY creation — everywhere on the machine — fails with "Could not create a
 * new process and open a pseudo-tty."
 *
 * This was proven the hard way: a fix that relied on `destroy()` (v1.7.152)
 * did NOT stop the leak, because `destroy()` closes `_fd` and leaves the dup.
 * A loop of spawn+destroy climbed 1 fd per iteration without bound; the same
 * loop with `reclaimOrphanPtyFds()` stays flat at zero.
 *
 * The dup is closed at spawn time, synchronously, in the same tick as the
 * spawn: at that instant the newly-appeared ptmx fd that is not `_fd` is
 * unambiguously this pty's leaked dup, with no window for another part of the
 * process to have reused the number. node-pty never touches it, so closing it
 * does not affect the pty (verified: data still flows, destroy still works).
 */

export interface FdReclaimDeps {
  /** rdev of /dev/ptmx, to learn the pty device major at runtime. */
  ptmxRdev: () => number
  /** fd numbers currently open in this process. `/dev/fd` on macOS/Linux. */
  listFds: () => string[]
  /** rdev of an open fd, or null if it can't be stat'd. */
  fstatRdev: (fd: number) => number | null
  /** Close an fd. Must swallow EBADF (already closed). */
  close: (fd: number) => void
}

/** macOS/Linux encode st_rdev as (major << 24) | minor. */
function major(rdev: number): number {
  return (rdev >>> 24) & 0xff
}

/** The process's own fds that point at the pty master device. */
export function ownPtmxFds(deps: FdReclaimDeps): number[] {
  let ptmxMajor: number
  try {
    ptmxMajor = major(deps.ptmxRdev())
  } catch {
    return []
  }
  let entries: string[]
  try {
    entries = deps.listFds()
  } catch {
    return []
  }
  const out: number[] = []
  for (const entry of entries) {
    const fd = Number(entry)
    if (!Number.isInteger(fd)) continue
    const rdev = deps.fstatRdev(fd)
    if (rdev === null) continue
    if (major(rdev) === ptmxMajor) out.push(fd)
  }
  return out
}

/**
 * Given the ptmx fds open BEFORE a spawn and the pty's own `_fd`, close any
 * ptmx fd that appeared during the spawn and is not `_fd`. Returns the fds it
 * closed (for logging/testing). Pure but for the injected `close`.
 */
export function reclaimNewOrphans(
  before: number[],
  keepFd: number | undefined,
  deps: FdReclaimDeps
): number[] {
  const beforeSet = new Set(before)
  const after = ownPtmxFds(deps)
  const closed: number[] = []
  for (const fd of after) {
    if (beforeSet.has(fd)) continue // already existed — not ours
    if (fd === keepFd) continue // the pty's real master — node-pty owns it
    deps.close(fd)
    closed.push(fd)
  }
  return closed
}

const realDeps: FdReclaimDeps = {
  ptmxRdev: () => statSync('/dev/ptmx').rdev,
  listFds: () => readdirSync('/dev/fd'),
  fstatRdev: (fd) => {
    try {
      return fstatSync(fd).rdev
    } catch {
      return null
    }
  },
  close: (fd) => {
    try {
      closeSync(fd)
    } catch {
      /* EBADF — node-pty already closed it; fine */
    }
  }
}

/**
 * Snapshot ptmx fds before a spawn. Call synchronously, immediately before
 * `pty.spawn()`, with nothing awaited in between.
 */
export function snapshotPtmxFds(deps: FdReclaimDeps = realDeps): number[] {
  return ownPtmxFds(deps)
}

/**
 * Close the orphan dup left by a spawn. Call synchronously, immediately after
 * `pty.spawn()` returns, passing the snapshot from before it and the pty's
 * `_fd`. No-op on Windows (ConPTY has no unix fds).
 */
export function reclaimOrphanPtyFds(
  before: number[],
  keepFd: number | undefined,
  deps: FdReclaimDeps = realDeps
): number[] {
  if (process.platform === 'win32') return []
  return reclaimNewOrphans(before, keepFd, deps)
}
