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

export interface UsageCacheOpts<CC, PCT> {
  ttlMs: number
  fetchCc: () => Promise<CC | null>
  fetchPct: () => Promise<PCT | null>
  /** Override for tests. */
  now?: () => number
}

export class UsageCache<CC, PCT> {
  private cache: UsageCacheValue<CC, PCT> | null = null
  private inFlight: Promise<UsageCacheValue<CC, PCT>> | null = null
  private now: () => number

  constructor(private opts: UsageCacheOpts<CC, PCT>) {
    this.now = opts.now ?? (() => Date.now())
  }

  async get(): Promise<UsageCacheValue<CC, PCT>> {
    if (this.cache && this.now() - this.cache.ts < this.opts.ttlMs) return this.cache
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
      this.inFlight = null
      return value
    })()
    return this.inFlight
  }

  /** Test seam. Drops cache + clears in-flight tracker. */
  reset(): void {
    this.cache = null
    this.inFlight = null
  }
}
