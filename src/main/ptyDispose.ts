import * as pty from 'node-pty'

/**
 * Signal a PTY's child and close its tracked master fd (`term._fd`).
 *
 * `kill()` ONLY does `process.kill(pid, 'SIGHUP')`. `destroy()` additionally
 * calls `_socket.destroy()` (closing `_fd`) and SIGHUPs the shell once the
 * socket closes, so it subsumes `kill()`. It isn't on node-pty's public
 * `IPty` interface, hence the cast; the `kill()` fallback covers a future
 * version that drops it.
 *
 * IMPORTANT — this is NOT the whole leak fix. Empirically (node-pty 1.1.0,
 * macOS) a spawn opens TWO `/dev/ptmx` fds: `_fd`, plus an adjacent dup that
 * `tty.ReadStream` makes and node-pty never tracks or closes. `destroy()`
 * closes `_fd` and leaves the dup — a spawn+destroy loop still leaks one fd
 * per iteration (this is exactly why the v1.7.152 destroy()-only fix did not
 * work). The dup is reclaimed at spawn time in ptyRegistry.ts via
 * ptyFdReclaim.ts; this function only handles `_fd` and the child signal.
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
