import { describe, expect, it } from 'vitest'
import { parseUserCommand, argSummary, fmtMs, fmtK } from '../renderers'

describe('parseUserCommand', () => {
  it('parses pure slash-command invocation', () => {
    const raw =
      '<command-name>/clear</command-name><command-message>clear</command-message><command-args></command-args>'
    const out = parseUserCommand(raw)
    expect(out.kind).toBe('command')
    if (out.kind !== 'command') throw new Error('unreachable')
    expect(out.command).toBe('clear')
    expect(out.args).toBe('')
  })

  it('parses slash-command with args', () => {
    const raw =
      '<command-name>/run</command-name><command-message>run</command-message><command-args>--fast foo</command-args>'
    const out = parseUserCommand(raw)
    expect(out.kind).toBe('command')
    if (out.kind !== 'command') throw new Error('unreachable')
    expect(out.command).toBe('run')
    expect(out.args).toBe('--fast foo')
  })

  it('strips leading slashes from the command name', () => {
    const raw =
      '<command-name>//foo</command-name><command-args></command-args>'
    const out = parseUserCommand(raw)
    if (out.kind !== 'command') throw new Error('expected command')
    expect(out.command).toBe('foo')
  })

  it('returns text when the command tags are surrounded by other prose', () => {
    const raw =
      'hello <command-name>/clear</command-name><command-args></command-args> and then some more text'
    const out = parseUserCommand(raw)
    expect(out.kind).toBe('text')
    if (out.kind !== 'text') throw new Error('unreachable')
    expect(out.text).toBe(raw)
  })

  it('returns text for plain text with no tags', () => {
    const raw = 'just a normal user message'
    const out = parseUserCommand(raw)
    expect(out.kind).toBe('text')
    if (out.kind !== 'text') throw new Error('unreachable')
    expect(out.text).toBe(raw)
  })

  it('missing args tag yields empty args', () => {
    const raw = '<command-name>/bar</command-name><command-message>bar</command-message>'
    const out = parseUserCommand(raw)
    if (out.kind !== 'command') throw new Error('expected command')
    expect(out.args).toBe('')
  })

  it('treats local-command-stdout between tags as pure command', () => {
    const raw =
      '<command-name>/foo</command-name><command-args>x</command-args><local-command-stdout>stdout</local-command-stdout>'
    const out = parseUserCommand(raw)
    if (out.kind !== 'command') throw new Error('expected command')
    expect(out.command).toBe('foo')
    expect(out.args).toBe('x')
  })
})

describe('argSummary', () => {
  it('prefers command over other fields', () => {
    expect(argSummary({ command: 'ls', file_path: '/foo', pattern: 'x' })).toBe('ls')
  })

  it('falls back to file_path when command missing', () => {
    expect(argSummary({ file_path: '/a/b.ts' })).toBe('/a/b.ts')
  })

  it('falls back to path when file_path missing', () => {
    expect(argSummary({ path: '/a/b' })).toBe('/a/b')
  })

  it('falls back to pattern', () => {
    expect(argSummary({ pattern: 'foo.*' })).toBe('foo.*')
  })

  it('falls back to url', () => {
    expect(argSummary({ url: 'https://example.com' })).toBe('https://example.com')
  })

  it('falls back to prompt', () => {
    expect(argSummary({ prompt: 'hello' })).toBe('hello')
  })

  it('falls back to description', () => {
    expect(argSummary({ description: 'a task' })).toBe('a task')
  })

  it('JSON-stringifies when no preferred keys are present', () => {
    const out = argSummary({ foo: 1, bar: 'x' })
    expect(out).toBe(JSON.stringify({ foo: 1, bar: 'x' }))
  })

  it('truncates JSON stringify to 120 chars', () => {
    const big: Record<string, unknown> = {}
    for (let i = 0; i < 50; i++) big[`k${i}`] = 'x'.repeat(50)
    const out = argSummary(big)
    expect(out.length).toBe(120)
  })

  it('skips empty-string preferred fields and continues fallback', () => {
    expect(argSummary({ command: '', file_path: '/real' })).toBe('/real')
  })

  it('preference order: command > file_path > path > pattern > url > prompt > description', () => {
    expect(argSummary({ path: '/p', pattern: 'p' })).toBe('/p')
    expect(argSummary({ pattern: 'p', url: 'u' })).toBe('p')
    expect(argSummary({ url: 'u', prompt: 'pr' })).toBe('u')
    expect(argSummary({ prompt: 'pr', description: 'd' })).toBe('pr')
  })
})

describe('fmtMs', () => {
  it('returns empty string for undefined', () => {
    expect(fmtMs(undefined)).toBe('')
  })

  it('formats sub-second as ms', () => {
    expect(fmtMs(0)).toBe('0ms')
    expect(fmtMs(1)).toBe('1ms')
    expect(fmtMs(999)).toBe('999ms')
  })

  it('formats under a minute as seconds (1 decimal)', () => {
    expect(fmtMs(1000)).toBe('1.0s')
    expect(fmtMs(1500)).toBe('1.5s')
    expect(fmtMs(59999)).toBe('60.0s')
  })

  it('formats one-minute-and-up as Xm Ys', () => {
    expect(fmtMs(60000)).toBe('1m 0s')
    expect(fmtMs(61000)).toBe('1m 1s')
    expect(fmtMs(125000)).toBe('2m 5s')
  })
})

describe('fmtK', () => {
  it('returns em-dash for undefined', () => {
    expect(fmtK(undefined)).toBe('—')
  })

  it('returns raw digits under 1000', () => {
    expect(fmtK(0)).toBe('0')
    expect(fmtK(1)).toBe('1')
    expect(fmtK(999)).toBe('999')
  })

  it('formats >= 1000 as X.Xk', () => {
    expect(fmtK(1000)).toBe('1.0k')
    expect(fmtK(1500)).toBe('1.5k')
    expect(fmtK(12345)).toBe('12.3k')
    expect(fmtK(100000)).toBe('100.0k')
  })
})
