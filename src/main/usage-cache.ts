/**
 * Single-flight + TTL cache for the shared usage scrape.
 *
 * Why this exists (Issue #7):
 *   `ccusage blocks --json` scans ALL `~/.claude/projects/*.jsonl` on every
 *   invocation with zero caching of its own. On a 790MB / 1183-file history
 *   it takes ~12s at 100%+ CPU. Pre-fix, Hive:
 *     1. only cached when `pct` was truthy → if the PTY scrape failed,
 *        every refresh re-spawned ccusage from scratch
 *     2. used a 30s TTL → on a slow box the ratio of ccusage-runtime to
 *        cache-window pegged a core continuously
 *
 * Contract:
 *   - At most one in-flight fetch at a time across all callers (single-flight)
 *   - Cache result for `ttlMs`, even when both fetches return null —
 *     prevents thundering-herd re-spawns when the source is broken
 *   - Fetcher exceptions are swallowed → caller always gets a value object,
 *     not a rejection. Account-level usage failure must never crash chat.
 */

export interface UsageCacheValue<CC, PCT> {
  cc: CC | null
  pct: PCT | null
  ts: number
}

/** Injected fs so persistence is unit-testable without touching disk. */
export interface UsageFs {
  readFileSync: (path: string) => string
  writeFileSync: (path: string, data: string) => void
}

export interface UsageCacheOpts<CC, PCT> {
  ttlMs: number
  fetchCc: () => Promise<CC | null>
  fetchPct: () => Promise<PCT | null>
  /** Override for tests. */
  now?: () => number
  /**
   * When set, the last scraped value is written here and re-loaded on the next
   * construction, so the 5h/7d usage bars survive a restart instead of blanking
   * until the next scrape. The loaded value is served ONCE immediately (even if
   * past TTL) while a fresh scrape runs in the background — stale-while-
   * revalidate, scoped to the disk seed so normal TTL semantics are unchanged.
   */
  persistPath?: string
  /** fs seam for persistPath; defaults to node fs at the call site. */
  fs?: UsageFs
}

/**
 * Parse a persisted cache file into a value, or null when absent/corrupt/shape-
 * invalid — a bad file must never break startup, just skip the seed. Pure.
 */
export function parsePersistedUsage<CC, PCT>(text: string): UsageCacheValue<CC, PCT> | null {
  try {
    const o = JSON.parse(text)
    if (o && typeof o.ts === 'number' && 'cc' in o && 'pct' in o) {
      return { cc: o.cc ?? null, pct: o.pct ?? null, ts: o.ts }
    }
  } catch {
    /* corrupt/missing — no seed */
  }
  return null
}

/**
 * Deterministic, collision-resistant filename for a per-cwd usage cache. The
 * cache key is a cwd path (unsafe as a filename), so hash it. Pure/testable.
 */
export function usageCacheFilename(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return `usage-${(hash >>> 0).toString(36)}.json`
}

export class UsageCache<CC, PCT> {
  private cache: UsageCacheValue<CC, PCT> | null = null
  private inFlight: Promise<UsageCacheValue<CC, PCT>> | null = null
  private now: () => number
  // The current cache came from disk and hasn't been revalidated yet: serve it
  // once for display, then let a background scrape replace it.
  private fromDisk = false

  constructor(private opts: UsageCacheOpts<CC, PCT>) {
    this.now = opts.now ?? (() => Date.now())
    if (opts.persistPath && opts.fs) {
      try {
        const seed = parsePersistedUsage<CC, PCT>(opts.fs.readFileSync(opts.persistPath))
        if (seed) {
          this.cache = seed
          this.fromDisk = true
        }
      } catch {
        /* no persisted file yet */
      }
    }
  }

  async get(): Promise<UsageCacheValue<CC, PCT>> {
    // Fresh, revalidated cache within TTL → serve it.
    if (this.cache && !this.fromDisk && this.now() - this.cache.ts < this.opts.ttlMs) return this.cache
    // Disk seed → serve immediately (bars show after restart) and revalidate in
    // the background exactly once. Clearing fromDisk first prevents re-entry.
    if (this.cache && this.fromDisk) {
      const seed = this.cache
      this.fromDisk = false
      void this.startFetch()
      return seed
    }
    return this.startFetch()
  }

  private startFetch(): Promise<UsageCacheValue<CC, PCT>> {
    if (this.inFlight) return this.inFlight
    this.inFlight = (async () => {
      const [cc, pct] = await Promise.all([
        this.opts.fetchCc().catch(() => null),
        this.opts.fetchPct().catch(() => null)
      ])
      const value: UsageCacheValue<CC, PCT> = { cc, pct, ts: this.now() }
      // ALWAYS cache — even all-null — to prevent thundering-herd ccusage
      // spawns when the underlying source is failing. Issue #7.
      this.cache = value
      this.fromDisk = false
      this.inFlight = null
      if (this.opts.persistPath && this.opts.fs) {
        try { this.opts.fs.writeFileSync(this.opts.persistPath, JSON.stringify(value)) } catch { /* best-effort */ }
      }
      return value
    })()
    return this.inFlight
  }

  /** Test seam. Drops cache + clears in-flight tracker. */
  reset(): void {
    this.cache = null
    this.inFlight = null
    this.fromDisk = false
  }
}
