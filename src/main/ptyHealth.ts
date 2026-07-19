/**
 * Self-monitoring for pseudo-terminal exhaustion.
 *
 * macOS caps concurrently-allocated PTYs at `kern.tty.ptmx_max` (511 by
 * default). Hitting it makes every subsequent spawn fail with:
 *
 *     Could not create a new process and open a pseudo-tty.
 *
 * The failure mode that motivated this module is brutal to diagnose: one
 * leaked fd per spawn, ~7 days of uptime to reach the ceiling, an error
 * message that names neither fds nor the leaking call site, and nothing in the
 * app measuring the resource. Unit tests and e2e structurally cannot catch a
 * leak whose feedback delay is a week.
 *
 * So measure it. All logic here is pure or dependency-injected — the real
 * syscalls live in the `Deps` a caller passes in.
 */

export type Watermark = 'ok' | 'warn' | 'critical'

/** macOS encodes st_rdev as (major << 24) | minor. */
export function rdevMajor(rdev: number): number {
  return (rdev >>> 24) & 0xff
}

/**
 * `warn` at half the ceiling, `critical` at 80%. The gap matters: at 80% of
 * 511 there are still ~100 spawns of headroom, which on a 5-minute poll is
 * hours of warning before anything actually breaks.
 */
export function classifyWatermark(open: number, max: number): Watermark {
  if (max <= 0) return 'ok'
  const ratio = open / max
  if (ratio >= 0.8) return 'critical'
  if (ratio >= 0.5) return 'warn'
  return 'ok'
}

export interface PtmxDeps {
  /** fd numbers currently open in this process — `/dev/fd` on macOS. */
  listFds: () => string[]
  /** rdev of an open fd, or null if it can't be stat'd (fd raced closed). */
  fstatRdev: (fd: number) => number | null
  /** rdev of /dev/ptmx, used to learn the pty major at runtime. */
  ptmxRdev: () => number
}

/**
 * Count this process's open pty master fds.
 *
 * Returns null when the platform doesn't expose what we need, so callers can
 * skip the check rather than act on a bogus zero.
 */
export function countOpenPtmxFds(deps: PtmxDeps): number | null {
  let major: number
  try {
    major = rdevMajor(deps.ptmxRdev())
  } catch {
    return null
  }
  let fds: string[]
  try {
    fds = deps.listFds()
  } catch {
    return null
  }
  let count = 0
  for (const entry of fds) {
    const fd = Number(entry)
    if (!Number.isInteger(fd)) continue
    const rdev = deps.fstatRdev(fd)
    if (rdev === null) continue
    if (rdevMajor(rdev) === major) count++
  }
  return count
}

export interface PtyHealthReport {
  open: number
  max: number
  level: Watermark
  registered: number
  /** Spawns we registered but never released, oldest first. Attribution. */
  suspects: { label: string; ageMs: number }[]
}

/**
 * Build a report. `registered` coming in far below `open` is the signature of
 * a leak: fds outliving the handles that own them.
 */
export function buildHealthReport(
  open: number,
  max: number,
  handles: { label: string; spawnedAt: number }[],
  now: number
): PtyHealthReport {
  const byAge = [...handles].sort((a, b) => a.spawnedAt - b.spawnedAt)
  return {
    open,
    max,
    level: classifyWatermark(open, max),
    registered: handles.length,
    suspects: byAge.slice(0, 10).map(h => ({ label: h.label, ageMs: now - h.spawnedAt }))
  }
}

export function formatHealthReport(r: PtyHealthReport): string {
  const pct = r.max > 0 ? Math.round((r.open / r.max) * 100) : 0
  const head = `[pty-health] ${r.open}/${r.max} ptmx fds (${pct}%) · ${r.registered} registered`
  if (r.level === 'ok') return head
  const leaked = r.open - r.registered
  const top = r.suspects
    .map(s => `${s.label}@${Math.round(s.ageMs / 1000)}s`)
    .join(', ')
  return `${head} · level=${r.level} · ~${leaked} fd(s) with no live handle · oldest: ${top || 'none'}`
}
