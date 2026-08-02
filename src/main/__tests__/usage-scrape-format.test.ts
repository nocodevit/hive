import { describe, it, expect } from 'vitest'
import { scrapeUsageFromGrid, isSettingsWarningVisible } from '../chat-usage-query'

describe('scrapeUsageFromGrid — NEW inline format (claude 2.1.x+)', () => {
  it('parses "5h: ░░░ 23% | 7d: 5%" printed on the prompt line', () => {
    const grid = '[Opus 5 (1M context)] 5h: ░░░░░░░░░░ 23% | 7d: 5%   /rc'
    expect(scrapeUsageFromGrid(grid)).toEqual({
      fiveHour: 23,
      sevenDay: 5,
      fiveHourReset: undefined,
      sevenDayReset: undefined
    })
  })

  it('parses at 0% (both bars empty) — the exact case that motivated this rewrite', () => {
    const grid = '  [Opus 5 (1M context)] 5h: ░░░░░░░░░░ 0% | 7d: 0%                     '
    expect(scrapeUsageFromGrid(grid)).toEqual({
      fiveHour: 0,
      sevenDay: 0,
      fiveHourReset: undefined,
      sevenDayReset: undefined
    })
  })

  it('parses at high usage — bars are filled with variety of glyphs', () => {
    const grid = '5h: ██████████ 97% | 7d: ███████░░░ 71%'
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHour).toBe(97)
    expect(r.sevenDay).toBe(71)
  })

  it('returns 5h-only when only 5h is present (partial render mid-stream)', () => {
    const grid = '5h: ░░░ 12%'
    expect(scrapeUsageFromGrid(grid)).toEqual({
      fiveHour: 12, sevenDay: undefined, fiveHourReset: undefined, sevenDayReset: undefined
    })
  })
})

describe('scrapeUsageFromGrid — OLD /usage TUI format (pre-2.1.x)', () => {
  it('parses "Current session: 2% used" plus "Current week (all models): 6% used"', () => {
    const grid = [
      'You are currently using your subscription to power your Claude Code usage',
      '',
      'Current session: 2% used · resets Jul 27 at 5:30am (Asia/Singapore)',
      'Current week (all models): 6% used · resets Aug 2 at 1am (Asia/Singapore)',
      'Current week (Fable): 0% used'
    ].join('\n')
    const r = scrapeUsageFromGrid(grid)!
    expect(r.fiveHour).toBe(2)
    expect(r.sevenDay).toBe(6)
  })

  it('extracts "Resets in 4h 12m" reset string in old format', () => {
    const grid = [
      'Current session',
      '',
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
})

describe('scrapeUsageFromGrid — nothing matches', () => {
  it('returns null when grid is empty', () => {
    expect(scrapeUsageFromGrid('')).toBeNull()
  })

  it('returns null on random terminal noise with no usage bar', () => {
    expect(scrapeUsageFromGrid('Welcome to claude\n\n❯ hello\n\n')).toBeNull()
  })

  it('returns null on the Settings Warning menu (no percentages yet)', () => {
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
