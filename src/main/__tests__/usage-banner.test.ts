import { describe, it, expect } from 'vitest'

/**
 * Tests for the /usage PTY scrape model banner detection regex.
 * Fix: claude 2.1.x changed banner from "Sonnet 4.6" (space) to
 * "claude-sonnet-4-6" (hyphenated). The old regex stopped matching,
 * causing the 25s scrape timeout and %% never rendering in ModelUsageBar.
 */
const BANNER_RE = /(Opus|Sonnet|Haiku)\s+\d|claude-(?:opus|sonnet|haiku)/i

describe('hasModelBanner regex', () => {
  describe('old format — "Model N.N" (pre-2.1.x)', () => {
    it('matches "Sonnet 4.6"', () => {
      expect(BANNER_RE.test('✦ Sonnet 4.6 · context 12%')).toBe(true)
    })
    it('matches "Opus 4.7"', () => {
      expect(BANNER_RE.test(' Opus 4.7  ❯')).toBe(true)
    })
    it('matches "Haiku 4.5"', () => {
      expect(BANNER_RE.test('Haiku 4.5')).toBe(true)
    })
  })

  describe('new hyphenated format — "claude-model-N-N" (2.1.x+)', () => {
    it('matches "claude-sonnet-4-6"', () => {
      expect(BANNER_RE.test('◆ claude-sonnet-4-6 · ...')).toBe(true)
    })
    it('matches "claude-opus-4-7"', () => {
      expect(BANNER_RE.test('claude-opus-4-7')).toBe(true)
    })
    it('matches "claude-haiku-4-5"', () => {
      expect(BANNER_RE.test('claude-haiku-4-5')).toBe(true)
    })
    it('matches uppercase prefix variant', () => {
      expect(BANNER_RE.test('Claude-Sonnet-4-6')).toBe(true)
    })
  })

  describe('non-model text — should NOT match', () => {
    it('rejects settings warning screen', () => {
      expect(BANNER_RE.test('Settings Warning\nExit and fix manually\n❯')).toBe(false)
    })
    it('rejects empty string', () => {
      expect(BANNER_RE.test('')).toBe(false)
    })
    it('rejects plain prompt', () => {
      expect(BANNER_RE.test('❯')).toBe(false)
    })
    it('rejects model API id without claude- prefix', () => {
      // bare "sonnet" without prefix or old "Sonnet N" format should not match
      expect(BANNER_RE.test('sonnet-4-6')).toBe(false)
    })
  })
})

/**
 * Tests for the /usage output scrape regex.
 * Validates both old TUI format and new compact inline format.
 */
describe('/usage scrape regexes', () => {
  const fiveNew = (text: string) => text.match(/\b5h\b\s*:\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
  const sevenNew = (text: string) => text.match(/\b7d\b\s*:?\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/)
  const fiveOld = (text: string) => text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/)
  const sevenOld = (text: string) => text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/)

  it('parses new compact 5h format', () => {
    const m = fiveNew('5h: ░░░░░░░░░░ 23%')
    expect(m?.[1]).toBe('23')
  })

  it('parses new compact 7d format', () => {
    const m = sevenNew('7d: ██░░░░░░░░ 5%')
    expect(m?.[1]).toBe('5')
  })

  it('parses inline combined format "5h: ███ 72% | 7d: 5%"', () => {
    const text = '5h: ███░░░░░░░ 72% | 7d: 5%'
    expect(fiveNew(text)?.[1]).toBe('72')
    expect(sevenNew(text)?.[1]).toBe('5')
  })

  it('parses old verbose 5h format', () => {
    const text = 'Current session\n72% used'
    expect(fiveOld(text)?.[1]).toBe('72')
  })

  it('parses old verbose 7d format', () => {
    const text = 'Current week\n5% used'
    expect(sevenOld(text)?.[1]).toBe('5')
  })

  it('returns null for missing data', () => {
    expect(fiveNew('no usage here')).toBeNull()
    expect(sevenNew('no usage here')).toBeNull()
  })
})
