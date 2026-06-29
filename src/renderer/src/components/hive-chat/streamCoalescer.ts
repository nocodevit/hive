/**
 * Frame-coalescer for high-frequency streaming UI updates. Kept DOM-free so
 * the batching logic is unit-testable (the requestAnimationFrame wiring at the
 * call site is GUI / UNTESTABLE).
 *
 * Why this exists: `claude --print --output-format stream-json` emits a
 * `content_block_delta` every few tokens. HiveChat previously did a full
 * `replaceEntry` on each one, which re-renders the streaming row and re-parses
 * the WHOLE accumulated message through ReactMarkdown + remark-gfm + prism on
 * every delta. That is O(N²) per message (a length-N message streamed in ~N/4
 * deltas re-parses prefixes summing to ~N²/8 chars) and runs once per active
 * agent — the renderer process pegged a CPU core whenever several agents
 * streamed at once.
 *
 * This coalesces all deltas that land within one animation frame into a single
 * flush, so markdown re-parses at ~display-refresh rate (~60fps) instead of
 * per-token, with no visible difference in the output.
 */

/** Injectable scheduler so tests can drive frames deterministically. In the
 * renderer this is `requestAnimationFrame` / `cancelAnimationFrame`. */
export interface FrameScheduler {
  raf: (cb: () => void) => number
  caf: (handle: number) => void
}

export interface FrameCoalescer {
  /** Request that `flush` run on the next frame. Repeated calls before the
   *  frame fires collapse to a single flush; the most recent `flush` wins
   *  (callers pass a closure that drains shared pending state, so identity
   *  doesn't matter — the latest call always sees the freshest state). */
  schedule(flush: () => void): void
  /** Run any pending flush synchronously now and drop the queued frame. Used
   *  at block / message boundaries so ordering and final text are exact even
   *  if no frame has fired yet (e.g. window hidden → rAF paused). */
  flushNow(): void
  /** Drop any pending flush without running it (teardown / unmount). */
  cancel(): void
}

export function createFrameCoalescer(sched: FrameScheduler): FrameCoalescer {
  let handle: number | null = null
  let pending: (() => void) | null = null

  const fire = () => {
    handle = null
    const f = pending
    pending = null
    if (f) f()
  }

  return {
    schedule(flush: () => void) {
      pending = flush
      if (handle === null) handle = sched.raf(fire)
    },
    flushNow() {
      if (handle !== null) {
        sched.caf(handle)
        handle = null
      }
      const f = pending
      pending = null
      if (f) f()
    },
    cancel() {
      if (handle !== null) {
        sched.caf(handle)
        handle = null
      }
      pending = null
    }
  }
}
