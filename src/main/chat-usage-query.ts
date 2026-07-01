import { spawn } from 'node:child_process'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerm } from '@xterm/headless'
import { claudeBin } from './claude-env'

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

/**
 * Spawn a headless interactive `claude` under a PTY, pipe every byte
 * into `@xterm/headless` so the terminal state machine handles ANSI
 * cursor moves / erase / scroll correctly, then read the TUI's grid as
 * clean text and extract "Current session … NN% used" and
 * "Current week … NN% used" lines.
 *
 * This is the only way to surface the real subscription-tier %% that
 * /usage shows — stream-json doesn't carry them, and --print /usage is
 * short-circuited to a synthetic canned reply. Uses xterm-headless so
 * TUI redraws don't break the regex.
 */
export async function queryUsagePctViaPty(cwd?: string): Promise<{ fiveHour?: number; sevenDay?: number; fiveHourReset?: string; sevenDayReset?: string } | null> {
  return new Promise(resolve => {
    let done = false
    let child: pty.IPty | null = null
    const finish = (v: { fiveHour?: number; sevenDay?: number; fiveHourReset?: string; sevenDayReset?: string } | null) => {
      if (done) return
      done = true
      try { child?.kill() } catch {}
      resolve(v)
    }

    try {
      // Force a fresh session id so this PTY scrape can never accidentally
      // attach to an agent's live session (especially Tracy's).
      const freshSessionId = require('crypto').randomUUID()
      child = pty.spawn(claudeBin(), ['--session-id', freshSessionId], {
        name: 'xterm-256color',
        cols: 160, rows: 50,
        cwd: cwd || process.env.HOME || '/',
        env: process.env as any
      })
    } catch {
      return finish(null)
    }

    const term = new HeadlessTerm({ cols: 160, rows: 50, scrollback: 1000, allowProposedApi: true })
    let sent = false
    let promptSeenAt = 0
    let scrapeTimer: NodeJS.Timeout | null = null

    const dumpGrid = (): string => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (line) lines.push(line.translateToString(true))
      }
      return lines.join('\n')
    }

    const tryScrape = () => {
      const text = dumpGrid()
      // Match BOTH old (`Current session ... 23% used`) and new
      // (`5h: ░░░░░░░░░░ 23% | 7d: 5%`) formats. claude refactored
      // /usage TUI in v2.1.x to a compact inline string and our old
      // regex stopped matching → 25s timeout → null pct → ModelUsageBar
      // displayed `—` instead of an actual percentage.
      const fiveOld = text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/)
      const fiveNew = text.match(/\b5h\b\s*:\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
      const sevenOld = text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/)
      const sevenNew = text.match(/\b7d\b\s*:?\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
      const weekly = text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i)
      const five = fiveOld || fiveNew
      const seven = sevenOld || sevenNew || weekly
      // Reset countdown — old format only; new inline format omits
      // resets entirely, so we surface undefined and ModelUsageBar
      // simply skips the "· in 4h 12m" suffix.
      const sessionReset = text.match(/Current session[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
      const weekReset = text.match(/Current week[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i)
      if (five || seven) {
        finish({
          fiveHour: five ? parseInt(five[1], 10) : undefined,
          sevenDay: seven ? parseInt(seven[1], 10) : undefined,
          fiveHourReset: sessionReset ? sessionReset[1].trim() : undefined,
          sevenDayReset: weekReset ? weekReset[1].trim() : undefined
        })
      }
    }

    let warningHandled = false
    child.onData((d: string) => {
      term.write(d, () => {
        const grid = dumpGrid()
        // Settings.json warning page: claude renders a "1. Continue /
        // 2. Exit and fix manually" menu before the real TUI prompt.
        // The `❯` glyph in that menu used to fool prompt detection,
        // making us write `/usage` into the menu (where it's eaten as
        // input) and the real prompt never gets it. Detect the warning
        // and send Enter once to acknowledge → real prompt appears.
        if (!warningHandled && /Settings\s+Warning|Exit and fix manually|Enter to confirm/i.test(grid)) {
          warningHandled = true
          setTimeout(() => { try { child?.write('\r') } catch {} }, 200)
          return
        }
        // Stage 1: wait for prompt glyph → send /usage. Require the
        // model name banner to be present so we know we're past any
        // settings/warning screen. Match both old format ("Opus 4.7" /
        // "Sonnet 4.6") and new hyphenated format ("claude-sonnet-4-6" /
        // "claude-opus-4-7") introduced in claude 2.1.x.
        if (!sent) {
          const hasModelBanner = /(Opus|Sonnet|Haiku)\s+\d|claude-(?:opus|sonnet|haiku)/i.test(grid)
          const firstTen = grid.split('\n').slice(0, 20).join('\n')
          if (hasModelBanner && (firstTen.includes('❯') || /^\s*>\s/m.test(firstTen))) {
            sent = true
            promptSeenAt = Date.now()
            setTimeout(() => { try { child?.write('/usage\r') } catch {} }, 500)
          }
          return
        }
        // Stage 2: after /usage, let the TUI settle a moment then scrape.
        if (Date.now() - promptSeenAt < 700) return
        if (scrapeTimer) clearTimeout(scrapeTimer)
        scrapeTimer = setTimeout(tryScrape, 300)
      })
    })
    child.onExit(() => finish(null))

    setTimeout(() => finish(null), 25000)
  })
}
