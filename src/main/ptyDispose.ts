import * as pty from 'node-pty'

/**
 * Release a PTY's master file descriptor.
 *
 * node-pty's `kill()` ONLY does `process.kill(pid, 'SIGHUP')` — it never
 * touches the fd. The master fd is closed exclusively by `destroy()`
 * (`_socket.destroy()` + `_writeStream.dispose()`), or incidentally by the
 * native onexit path IF the child actually exits and node-pty observes it.
 *
 * Every teardown site used to call `kill()` alone, so any child that ignored
 * SIGHUP — or exited without node-pty seeing it — leaked one `/dev/ptmx` fd
 * forever. macOS caps these at `kern.tty.ptmx_max` (511 by default), and the
 * main process hit exactly 511 open ptmx fds after ~7 days of uptime, at which
 * point every new spawn failed with:
 *
 *     Could not create a new process and open a pseudo-tty.
 *
 * `destroy()` also SIGHUPs the shell once the socket closes, so it subsumes
 * `kill()`. It isn't on node-pty's public `IPty` interface, hence the cast;
 * the `kill()` fallback covers a future version that drops it.
 */
export function disposePty(term: pty.IPty | null | undefined): void {
  if (!term) return
  const destroy = (term as unknown as { destroy?: () => void }).destroy
  if (typeof destroy === 'function') {
    try {
      destroy.call(term)
      return
    } catch {
      /* fall through to kill() */
    }
  }
  try {
    term.kill()
  } catch {
    /* already dead */
  }
}
