import { spawn } from 'node:child_process'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerm } from '@xterm/headless'
import { claudeBin } from './claude-env'
import { releasePty, spawnPty } from './ptyRegistry'

/**
 * Hard ceiling on how long we wait for `ccusage blocks --json` to finish.
 * Issue #7 observation: on a 790MB / 1183-file `~/.claude/projects/`
 * history, ccusage takes ~12s at 100%+ CPU because it scans every jsonl
 * from scratch with zero caching. The pre-fix value (10s) was BELOW that
 * runtime — we killed ccusage right before it would have returned, then
 * the unstored null result triggered another spawn on the next refresh,
 * pegging a core indefinitely. 60s gives 5x headroom; the outer
 * UsageCache (5min TTL) means we tolerate this latency on cold scrapes.
 */
const CCUSAGE_TIMEOUT_MS = 60_000

/**
 * Query usage via `ccusage blocks --json`. Reads ~/.claude/sessions/* and
 * aggregates into 5-hour billing windows, so no extra API traffic.
 * Returns the active block's cost, burn rate, and projection.
 */
export async function queryUsageViaCcusage(): Promise<{
  costUSD?: number
  burnPerHour?: number
  projectedUSD?: number
  remainingMinutes?: number
  totalTokens?: number
} | null> {
  return new Promise(resolve => {
    let settled = false
    const finish = (v: any) => { if (settled) return; settled = true; resolve(v) }
    try {
      // detached:true puts ccusage in its own process group so a SIGTERM
      // to -child.pid kills the whole tree on timeout. Without this, our
      // child.kill() only signals the npm/node shim and the real worker
      // keeps scanning jsonl files, draining CPU after we've moved on.
      const child = spawn('ccusage', ['blocks', '--json'], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
      })
      let out = ''
      let killTimer: NodeJS.Timeout | null = null
      const cleanupTimer = () => { if (killTimer) { clearTimeout(killTimer); killTimer = null } }
      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
      child.on('error', () => { cleanupTimer(); finish(null) })
      child.on('exit', () => {
        cleanupTimer()
        try {
          const data = JSON.parse(out)
          const active = (data.blocks || []).find((b: any) => b.isActive)
          if (!active) return finish(null)
          finish({
            costUSD: active.costUSD,
            burnPerHour: active.burnRate?.costPerHour,
            projectedUSD: active.projection?.totalCost,
            remainingMinutes: active.projection?.remainingMinutes,
            totalTokens: active.totalTokens
          })
        } catch {
          finish(null)
        }
      })
      killTimer = setTimeout(() => {
        try {
          // Negative pid = process-group kill. Falls back to single-pid
          // kill if the group send fails (group leader may already be
          // gone). Both attempts swallow errors — we're abandoning the
          // result either way.
          if (child.pid) {
            try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch {} }
          }
        } catch {}
        finish(null)
      }, CCUSAGE_TIMEOUT_MS)
    } catch {
      finish(null)
    }
  })
}

export interface UsagePctResult {
  fiveHour?: number
  sevenDay?: number
  fiveHourReset?: string
  sevenDayReset?: string
}

/**
 * Parse the two TUI formats that carry subscription %%. Pure — safe to
 * unit test with hand-crafted grids.
 *
 * Formats:
 *   OLD (< 2.1.x): "Current session ... 23% used" / "Current week ... 5% used"
 *                  plus optional "Resets in 4h 12m" / "Resets on Apr 30" tail
 *   NEW (2.1.x+):  inline prompt bar "5h: ░░░░░░░░░░ 23% | 7d: 5%" — no
 *                  /usage command needed; claude prints it under every prompt
 *
 * Returns null iff neither format matched. Partial matches (only 5h, or
 * only 7d) return with the missing side undefined — the ModelUsageBar
 * renders `—` for undefined and shows what we do have.
 */
export function scrapeUsageFromGrid(text: string): UsagePctResult | null {
  const fiveOld = text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/)
  const fiveNew = text.match(/\b5h\b\s*:\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
  const sevenOld = text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/)
  const sevenNew = text.match(/\b7d\b\s*:?\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
  const weekly = text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i)
  const five = fiveOld || fiveNew
  const seven = sevenOld || sevenNew || weekly
  if (!five && !seven) return null
  const sessionReset = text.match(/Current session[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
  const weekReset = text.match(/Current week[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
  return {
    fiveHour: five ? parseInt(five[1], 10) : undefined,
    sevenDay: seven ? parseInt(seven[1], 10) : undefined,
    fiveHourReset: sessionReset ? sessionReset[1].trim() : undefined,
    sevenDayReset: weekReset ? weekReset[1].trim() : undefined
  }
}

/**
 * True when claude 2.1.x's Settings Warning menu ("1. Continue / 2. Fix
 * with Claude / 3. Exit and fix manually") is still on screen. When it
 * is, the real prompt is hidden and the inline 5h/7d bar hasn't rendered
 * yet — we must dismiss the menu before scraping can succeed.
 *
 * The warning appears whenever ~/.claude/settings.json contains invalid
 * entries claude rejects on startup (e.g. `permissions.allow` rules with
 * `(undefined)` args, a deprecated shape). Old code sent Enter exactly
 * once, 200ms after first sighting; the menu wasn't stable yet so the
 * keystroke was discarded, and the scrape then timed out at 25s. Real
 * behaviour observed on 2026-07-27 with 44 invalid MCP rules.
 */
export function isSettingsWarningVisible(text: string): boolean {
  return /Exit and fix manually|Enter to confirm/i.test(text)
}

/**
 * Spawn a headless interactive `claude` under a PTY, pipe every byte
 * into `@xterm/headless` so the terminal state machine handles ANSI
 * cursor moves / erase / scroll correctly, then read the TUI's grid.
 *
 * Strategy:
 *   1. If the Settings Warning menu is showing, send Enter and RETRY
 *      every 1500ms up to 5 times (waits for the menu to become stable
 *      before giving up). One-shot Enter is not enough — claude 2.1.x
 *      renders the menu in stages and swallows keystrokes sent too
 *      early. See isSettingsWarningVisible for the failure mode.
 *   2. Fast path: try scrapeUsageFromGrid on every incoming chunk. In
 *      claude 2.1.x the "5h: ░░░ N% | 7d: M%" bar is printed under
 *      every prompt, so we get the number without ever sending /usage
 *      (saves a full API turn per poll).
 *   3. Fallback for old claude: wait for prompt glyph, send /usage,
 *      then scrape "Current session … N% used" / "Current week …".
 */
export async function queryUsagePctViaPty(cwd?: string): Promise<UsagePctResult | null> {
  return new Promise(resolve => {
    let done = false
    let child: pty.IPty | null = null
    let sent = false
    let promptSeenAt = 0
    let scrapeTimer: NodeJS.Timeout | null = null
    let warningRetries = 0
    let warningRetryTimer: NodeJS.Timeout | null = null
    const MAX_WARNING_RETRIES = 5

    const finish = (v: UsagePctResult | null) => {
      if (done) return
      done = true
      if (warningRetryTimer) { clearTimeout(warningRetryTimer); warningRetryTimer = null }
      if (scrapeTimer) { clearTimeout(scrapeTimer); scrapeTimer = null }
      releasePty(child)
      resolve(v)
    }

    try {
      // Force a fresh session id so this PTY scrape can never accidentally
      // attach to an agent's live session (especially Tracy's).
      const freshSessionId = require('crypto').randomUUID()
      child = spawnPty('usage-scrape', claudeBin(), ['--session-id', freshSessionId], {
        name: 'xterm-256color',
        cols: 160, rows: 50,
        cwd: cwd || process.env.HOME || '/',
        env: process.env as any
      })
    } catch {
      return finish(null)
    }

    const term = new HeadlessTerm({ cols: 160, rows: 50, scrollback: 1000, allowProposedApi: true })

    const dumpGrid = (): string => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (line) lines.push(line.translateToString(true))
      }
      return lines.join('\n')
    }

    // Repeatedly hit Enter until the Settings Warning menu is gone. See
    // isSettingsWarningVisible for why one shot isn't enough.
    const scheduleWarningRetry = () => {
      if (warningRetryTimer) return
      warningRetryTimer = setTimeout(() => {
        warningRetryTimer = null
        if (done) return
        if (!isSettingsWarningVisible(dumpGrid())) return
        if (warningRetries >= MAX_WARNING_RETRIES) return
        warningRetries++
        try { child?.write('\r') } catch {}
        scheduleWarningRetry()
      }, 1500)
    }

    child.onData((d: string) => {
      term.write(d, () => {
        const grid = dumpGrid()
        // Fast path — 2.1.x prints "5h: ░░░ N% | 7d: M%" under every
        // prompt, so as soon as it's on screen we're done. No /usage
        // command, no extra API turn.
        const fast = scrapeUsageFromGrid(grid)
        if (fast) return finish(fast)
        // A. Settings Warning menu still on screen → dismiss and retry.
        //    Blocks the prompt from rendering, so nothing else can
        //    progress until this is cleared.
        if (isSettingsWarningVisible(grid)) {
          if (warningRetries === 0) {
            warningRetries = 1
            setTimeout(() => { try { child?.write('\r') } catch {} }, 500)
            scheduleWarningRetry()
          }
          return
        }
        // B. Fallback for pre-2.1.x claude: prompt visible but no
        //    inline bar → send /usage and scrape the "Current session
        //    … N% used" output. Model banner check avoids sending
        //    /usage into a stray warning/settings screen.
        if (!sent) {
          const hasModelBanner = /(Opus|Sonnet|Haiku)\s+\d|claude-(?:opus|sonnet|haiku)/i.test(grid)
          // 2.1.x scrolls the model banner + prompt past line 20 when
          // the warning list is long, so search the whole grid, not just
          // the first 20 lines. The fast path above already caught the
          // common case; this only matters for old claude where /usage
          // must be typed.
          if (hasModelBanner && (grid.includes('❯') || /^\s*>\s/m.test(grid))) {
            sent = true
            promptSeenAt = Date.now()
            setTimeout(() => { try { child?.write('/usage\r') } catch {} }, 500)
          }
          return
        }
        // C. After /usage, let the TUI settle then scrape old-format output.
        if (Date.now() - promptSeenAt < 700) return
        if (scrapeTimer) clearTimeout(scrapeTimer)
        scrapeTimer = setTimeout(() => {
          const result = scrapeUsageFromGrid(dumpGrid())
          if (result) finish(result)
        }, 300)
      })
    })
    child.onExit(() => finish(null))

    setTimeout(() => finish(null), 25000)
  })
}
