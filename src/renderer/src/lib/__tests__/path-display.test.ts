import { describe, expect, it } from 'vitest'
import { shortenPath } from '../path-display'

describe('shortenPath', () => {
  it('returns empty string for undefined', () => {
    expect(shortenPath(undefined)).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('')
  })

  it('substitutes $HOME with ~ when prefix matches (explicit homeGuess)', () => {
    expect(shortenPath('/Users/meiyang/Projects/foo', '/Users/meiyang'))
      .toBe('~/Projects/foo')
  })

  it('infers /Users/<name> prefix when homeGuess is missing', () => {
    expect(shortenPath('/Users/meiyang/Projects/foo')).toBe('~/Projects/foo')
  })

  it('leaves paths outside home untouched', () => {
    expect(shortenPath('/etc/hosts', '/Users/meiyang')).toBe('/etc/hosts')
  })

  it('returns the path as-is when it has 5 or fewer segments', () => {
    expect(shortenPath('/Users/meiyang/a/b/c')).toBe('~/a/b/c')
  })

  it('elides middle segments when deeper than 5', () => {
    // Absolute path with 6+ segments under home.
    // parts (no empties) = ['~', 'Projects', 'hive', 'src', 'renderer', 'src', 'lib']
    // parts.length > 5 so elide: [head='~', parts[1]='Projects', '…', parts[-2]='src', parts[-1]='lib']
    expect(shortenPath('/Users/meiyang/Projects/hive/src/renderer/src/lib'))
      .toBe('~/Projects/…/src/lib')
  })

  it('works without a home prefix (absolute path, deep)', () => {
    // No homeGuess, path doesn't start with /Users/<name>.
    // parts = ['etc', 'a', 'b', 'c', 'd', 'e']  → length 6 > 5 → elide.
    // head = '' (not starting with ~), so [parts[1]='a', '…', parts[-2]='d', parts[-1]='e'].join('/')
    expect(shortenPath('/etc/a/b/c/d/e')).toBe('a/…/d/e')
  })

  it('preserves path when homeGuess does not match prefix', () => {
    expect(shortenPath('/opt/foo/bar', '/Users/meiyang')).toBe('/opt/foo/bar')
  })

  it('preserves depth-5 home path without eliding', () => {
    // ~/a/b/c/d  ← parts = ['~','a','b','c','d'] length 5, NOT > 5.
    expect(shortenPath('/Users/meiyang/a/b/c/d')).toBe('~/a/b/c/d')
  })
})
