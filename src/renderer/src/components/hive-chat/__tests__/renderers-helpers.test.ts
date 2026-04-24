import { describe, expect, it } from 'vitest'
import { langFromPath, stripReadPrefix, extractTrailingChoices } from '../renderers'

describe('langFromPath', () => {
  it('maps TS/TSX/JS/JSX correctly', () => {
    expect(langFromPath('foo.ts')).toBe('tsx')
    expect(langFromPath('foo.tsx')).toBe('tsx')
    expect(langFromPath('foo.js')).toBe('jsx')
    expect(langFromPath('foo.jsx')).toBe('jsx')
    expect(langFromPath('foo.mjs')).toBe('jsx')
  })

  it('maps common languages', () => {
    expect(langFromPath('a.py')).toBe('python')
    expect(langFromPath('a.rs')).toBe('rust')
    expect(langFromPath('a.go')).toBe('go')
    expect(langFromPath('a.sql')).toBe('sql')
    expect(langFromPath('a.sh')).toBe('bash')
    expect(langFromPath('a.yaml')).toBe('yaml')
    expect(langFromPath('a.json')).toBe('json')
    expect(langFromPath('a.css')).toBe('css')
    expect(langFromPath('a.md')).toBe('markdown')
  })

  it('falls back to markup for unknown / missing extension', () => {
    expect(langFromPath('foo.unknown')).toBe('markup')
    expect(langFromPath('README')).toBe('markup')
    expect(langFromPath(undefined)).toBe('markup')
    expect(langFromPath('')).toBe('markup')
  })

  it('is case-insensitive on the extension', () => {
    expect(langFromPath('FOO.TS')).toBe('tsx')
    expect(langFromPath('path/to/Foo.Py')).toBe('python')
  })
})

describe('stripReadPrefix', () => {
  it('strips `N\\t` prefix from each line and returns first line number', () => {
    const input = '1\tfirst\n2\tsecond\n3\tthird'
    const out = stripReadPrefix(input)
    expect(out.startLine).toBe(1)
    expect(out.content).toBe('first\nsecond\nthird')
  })

  it('respects offset — startLine is the first N found', () => {
    const input = '42\tfourtytwo\n43\tfortythree'
    expect(stripReadPrefix(input).startLine).toBe(42)
    expect(stripReadPrefix(input).content).toBe('fourtytwo\nfortythree')
  })

  it('returns the original text and startLine=1 when no prefix is present', () => {
    const input = 'plain text\nno prefix'
    const out = stripReadPrefix(input)
    expect(out.content).toBe(input)
    expect(out.startLine).toBe(1)
  })

  it('keeps lines without prefix when mixed with prefixed lines', () => {
    // Claude sometimes mixes — e.g. blank trailer. Keep non-prefixed as-is.
    const input = '1\tfoo\n2\tbar\n'
    expect(stripReadPrefix(input).content).toBe('foo\nbar\n')
  })

  it('preserves content that contains tabs', () => {
    const input = '1\tfoo\tbar\n2\tbaz'
    expect(stripReadPrefix(input).content).toBe('foo\tbar\nbaz')
  })
})

describe('extractTrailingChoices', () => {
  it('peels off a trailing numbered list', () => {
    const text = 'Where do you want to pick up?\n\n1. Resume from summary\n2. Start over\n3. Something else'
    const out = extractTrailingChoices(text)
    expect(out).not.toBeNull()
    expect(out!.body).toBe('Where do you want to pick up?')
    expect(out!.choices).toHaveLength(3)
    expect(out!.choices[0]).toMatchObject({ num: 1, label: 'Resume from summary' })
    expect(out!.choices[2]).toMatchObject({ num: 3, label: 'Something else' })
  })

  it('returns null when fewer than 2 numbered lines at tail', () => {
    expect(extractTrailingChoices('Some text\n\n1. Only one')).toBeNull()
    expect(extractTrailingChoices('Plain prose, no list at end.')).toBeNull()
  })

  it('keeps non-numbered trailing paragraphs', () => {
    // Text that ends without numbered items returns null.
    expect(extractTrailingChoices('Here are steps:\n1. First\n2. Second\n\nDone.')).toBeNull()
  })

  it('handles markdown inside choice labels', () => {
    const text = 'Pick:\n1. **Option A** (default)\n2. *Option B*'
    const out = extractTrailingChoices(text)
    expect(out).not.toBeNull()
    expect(out!.choices[0].label).toBe('**Option A** (default)')
    expect(out!.choices[1].label).toBe('*Option B*')
  })

  it('detects lists with leading whitespace', () => {
    const text = 'Pick:\n  1. A\n  2. B'
    const out = extractTrailingChoices(text)
    expect(out).not.toBeNull()
    expect(out!.choices).toHaveLength(2)
  })

  it('strips trailing blank lines from body', () => {
    const text = 'Hello\n\n\n1. A\n2. B'
    const out = extractTrailingChoices(text)
    expect(out!.body).toBe('Hello')
  })
})
