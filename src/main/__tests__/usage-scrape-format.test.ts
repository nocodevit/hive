import { describe, it, expect } from 'vitest'
import { scrapeUsageFromGrid, isSettingsWarningVisible } from '../chat-usage-query'

/**
 * scrapeUsageFromGrid MUST parse ONLY the /usage-command's aggregate
 * output — never the inline prompt bar.
 *
 * The inline bar `[Opus 5 (1M context)] 5h: N% | 7d: M%` is per-model.
 * Users on a Fable-heavy account see the Opus bar at 0% while their
 * real weekly is 56%. v1.7.155 read the inline bar as a fast path and
 * shipped a 0/0 lie into ModelUsageBar — regressed 1.7.159 back to
 * always sending /usage explicitly and parsing "Current session …" +
 * "Current week (all models) …".
 */
describe('scrapeUsageFromGrid — /usage aggregate output', () => {
  it('parses Current session: N% used (the primary 5h source)', () => {
    const grid = [
      'You are currently using your subscription to power your Claude Code usage',
      '',
      'Current session: 17% used · resets Aug 13 at 1:39pm (Asia/Singapore)',
      'Current week (all models): 56% used · resets Aug 16 at 12:59am (Asia/Singapore)',
      'Current week (Fable): 2% used · resets Aug 16 at 12:59am (Asia/Singapore)'
    ].join('\n')
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHour).toBe(17)
    expect(r.sevenDay).toBe(56)
  })

  it('MUST pick (all models) weekly, NOT (Fable) weekly — order matters', () => {
    // The exact live grid the user hit 2026-08-13: 56% aggregate but the
    // Fable slice was only 2%. If the regex matches "Current week (Fable)"
    // first it reports 2 and users see a wildly wrong number.
    const grid = 'Current week (all models): 56% used · resets X\nCurrent week (Fable): 2% used · resets X'
    const r = scrapeUsageFromGrid(grid)!
    expect(r.sevenDay).toBe(56)
    expect(r.sevenDay).not.toBe(2)
  })

  it('extracts reset countdown from the "resets Aug 13 at 1:39pm" tail', () => {
    const grid = [
      'Current session: 17% used · resets Aug 13 at 1:39pm (Asia/Singapore)',
      'Current week (all models): 56% used · resets Aug 16 at 12:59am (Asia/Singapore)'
    ].join('\n')
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHourReset).toBe('Aug 13 at 1:39pm')
    expect(r.sevenDayReset).toBe('Aug 16 at 12:59am')
  })

  it('extracts the older "Resets in 4h 12m" form (pre-2.1.x /usage)', () => {
    const grid = [
      'Current session',
      '  23% used',
      '  Resets in 4h 12m',
      'Current week',
      '  5% used',
      '  Resets in 6d 14h'
    ].join('\n')
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHourReset).toBe('4h 12m')
    expect(r.sevenDayReset).toBe('6d 14h')
  })

  it('returns 5h-only when only Current session is present (partial render)', () => {
    const grid = 'Current session: 12% used · resets Aug 13 at 1:39pm'
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHour).toBe(12)
    expect(r.sevenDay).toBeUndefined()
  })
})

describe('scrapeUsageFromGrid — MUST return null (never read per-model inline bar)', () => {
  it('inline prompt bar ALONE returns null — that number is per-model, not aggregate', () => {
    // v1.7.155 shipped a regex that matched this and returned {fiveHour:0, sevenDay:0}
    // for real users whose aggregate was 17/56. Regression guard.
    expect(scrapeUsageFromGrid('[Opus 5 (1M context)] 5h: ░░░░░░░░░░ 0% | 7d: 0%')).toBeNull()
  })

  it('inline bar at high per-model % is STILL wrong data — return null', () => {
    expect(scrapeUsageFromGrid('[Opus 5] 5h: ██████████ 97% | 7d: ███████░░░ 71%')).toBeNull()
  })

  it('inline bar SHARED with the /usage response — must pick aggregate, ignore inline', () => {
    // Realistic grid after /usage lands: both are on screen simultaneously.
    // Old code would have returned min-of-both or first-match, either way
    // could pick the inline bar's 0. The Current-only regex picks 17.
    const grid = [
      'Current session: 17% used · resets Aug 13 at 1:39pm',
      'Current week (all models): 56% used · resets Aug 16',
      '',
      '[Opus 5 (1M context)] 5h: ░░░░ 0% | 7d: 0%'
    ].join('\n')
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHour).toBe(17)
    expect(r.sevenDay).toBe(56)
  })

  it('empty grid → null', () => {
    expect(scrapeUsageFromGrid('')).toBeNull()
  })

  it('random terminal noise with no Current-{session,week} lines → null', () => {
    expect(scrapeUsageFromGrid('Welcome to claude\n\n❯ hello\n\n')).toBeNull()
  })

  it('Settings Warning menu (no percentages) → null', () => {
    const warning = [
      '  ⚠ Settings Warning',
      '  ├ Invalid rule ...',
      '  ❯ 1. Continue',
      '    2. Exit and fix manually',
      '  Enter to confirm · Esc to cancel'
    ].join('\n')
    expect(scrapeUsageFromGrid(warning)).toBeNull()
  })
})

describe('isSettingsWarningVisible', () => {
  it('true when "Enter to confirm" is present (the actionable menu line)', () => {
    expect(isSettingsWarningVisible('  Enter to confirm · Esc to cancel')).toBe(true)
  })

  it('true when "Exit and fix manually" is present (menu option 3)', () => {
    expect(isSettingsWarningVisible('    3. Exit and fix manually')).toBe(true)
  })

  it('false on a normal prompt', () => {
    expect(isSettingsWarningVisible('❯ Try "how do I log an error?"')).toBe(false)
  })

  it('false on empty grid', () => {
    expect(isSettingsWarningVisible('')).toBe(false)
  })

  it('false on the inline usage bar (must not collide with warning detection)', () => {
    expect(isSettingsWarningVisible('[Opus 5] 5h: ░░░ 0% | 7d: 0%')).toBe(false)
  })
})
