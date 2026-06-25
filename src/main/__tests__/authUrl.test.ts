import { describe, expect, it } from 'vitest'
import { authUrlToOpen } from '../authUrl'

describe('authUrlToOpen', () => {
  it('returns the URL on first sight', () => {
    const opened = new Set<string>()
    expect(authUrlToOpen('Visit https://claude.ai/oauth/authorize?code=abc to sign in', opened))
      .toBe('https://claude.ai/oauth/authorize?code=abc')
  })

  it('THE double-open bug: same URL on stdout then stderr opens only once', () => {
    // claude prints the sign-in URL on BOTH streams. Simulate the handler:
    // the caller records what it opened, so the second identical chunk is a
    // no-op and the browser is launched exactly once.
    const opened = new Set<string>()
    const line = 'Open this URL: https://claude.ai/oauth/authorize?code=xyz'

    const first = authUrlToOpen(line, opened)
    expect(first).toBe('https://claude.ai/oauth/authorize?code=xyz')
    opened.add(first!) // caller records the open

    // identical content arrives again on the other stream
    expect(authUrlToOpen(line, opened)).toBeNull()
  })

  it('returns null when there is no URL', () => {
    expect(authUrlToOpen('Waiting for authentication…', new Set())).toBeNull()
    expect(authUrlToOpen('', new Set())).toBeNull()
  })

  it('stops at whitespace / quotes / brackets so we open a clean URL', () => {
    expect(authUrlToOpen('see "https://claude.ai/x?y=1" now', new Set()))
      .toBe('https://claude.ai/x?y=1')
    expect(authUrlToOpen('(https://claude.ai/a) trailing', new Set()))
      .toBe('https://claude.ai/a')
  })

  it('a genuinely different URL still opens (dedupe is per-URL, not all-or-nothing)', () => {
    const opened = new Set<string>(['https://claude.ai/first'])
    expect(authUrlToOpen('next https://claude.ai/second', opened))
      .toBe('https://claude.ai/second')
  })
})
