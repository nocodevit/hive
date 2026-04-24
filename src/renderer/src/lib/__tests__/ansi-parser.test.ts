import { describe, expect, it } from 'vitest'
import { AnsiParser } from '../ansi-parser'

function rowText(parser: AnsiParser, row: number): string {
  return parser.rowToText(parser.buffer[row])
}

describe('AnsiParser — basics', () => {
  it('plain chars land in grid', () => {
    const p = new AnsiParser(5, 10)
    p.feed('hi')
    expect(rowText(p, 0)).toBe('hi')
    expect(p.cursor.col).toBe(2)
  })

  it('CR resets column, LF drops a line', () => {
    const p = new AnsiParser(5, 10)
    p.feed('abc\r\nxyz')
    expect(rowText(p, 0)).toBe('abc')
    expect(rowText(p, 1)).toBe('xyz')
  })

  it('bare LF does NOT reset column (POSIX behavior; PTY cooked mode handles translation)', () => {
    const p = new AnsiParser(5, 10)
    p.feed('abc\nX')
    // After 'abc' cursor at (0,3). LF → (1,3). Write X at col 3.
    expect(p.buffer[1][3].char).toBe('X')
  })

  it('backspace moves cursor left', () => {
    const p = new AnsiParser(5, 10)
    p.feed('abc\bZ')
    expect(rowText(p, 0)).toBe('abZ')
  })

  it('tab aligns to next 8-col stop', () => {
    const p = new AnsiParser(5, 40)
    p.feed('ab\tz')
    // after 'ab' col=2, tab jumps to 8, 'z' lands at col 8
    expect(p.buffer[0][8].char).toBe('z')
  })
})

describe('AnsiParser — CSI cursor', () => {
  it('CR + erase-line overwrites same row (spinner pattern)', () => {
    const p = new AnsiParser(5, 20)
    p.feed('line one\r\nold\r\x1b[2Knew')
    expect(rowText(p, 0)).toBe('line one')
    expect(rowText(p, 1)).toBe('new')
  })

  it('CSI A (up) + erase-line + new content — spinner frame', () => {
    const p = new AnsiParser(5, 20)
    p.feed('spin 1')
    p.feed('\x1b[1G\x1b[2Kspin 2')
    expect(rowText(p, 0)).toBe('spin 2')
  })

  it('CSI H sets cursor to (1,1) (zero-indexed 0,0)', () => {
    const p = new AnsiParser(5, 10)
    p.feed('\x1b[3;5H')
    expect(p.cursor.row).toBe(2)
    expect(p.cursor.col).toBe(4)
  })
})

describe('AnsiParser — SGR colors', () => {
  it('applies basic foreground color', () => {
    const p = new AnsiParser(3, 10)
    p.feed('\x1b[31mR\x1b[0mN')
    expect(p.buffer[0][0].fg).toBe('#EB4268') // Crush red
    expect(p.buffer[0][1].fg).toBeUndefined()
  })

  it('applies RGB 24-bit color (Claude Code native format)', () => {
    const p = new AnsiParser(3, 10)
    p.feed('\x1b[38;2;215;118;87mB')
    expect(p.buffer[0][0].fg).toBe('rgb(215,118,87)')
  })

  it('bold + dim attribute tracking', () => {
    const p = new AnsiParser(3, 10)
    p.feed('\x1b[1mA\x1b[22mB')
    expect(p.buffer[0][0].bold).toBe(true)
    expect(p.buffer[0][1].bold).toBeUndefined()
  })

  it('reset clears all attrs', () => {
    const p = new AnsiParser(3, 10)
    p.feed('\x1b[1;31;42mX\x1b[0mY')
    expect(p.buffer[0][0].bold).toBe(true)
    expect(p.buffer[0][0].fg).toBeDefined()
    expect(p.buffer[0][1].bold).toBeUndefined()
    expect(p.buffer[0][1].fg).toBeUndefined()
  })
})

describe('AnsiParser — Claude Code spinner pattern (Blanching…)', () => {
  // Real fixture from /tmp/claude-output.log — Claude Code uses cursor absolute
  // positioning + [?2026 synchronized output to repaint a thinking spinner in place.
  it('absolute-positioned spinner frames do not scroll the grid', () => {
    const p = new AnsiParser(30, 100)
    p.feed('system ready\r\n')
    p.feed('first message\r\n')

    // Move to middle of viewport (H = cursor position)
    p.feed('\x1b[10;1H')

    // Spinner frames: each erases the line then writes the new glyph + text.
    // In real Claude output the navigation uses up/down relative moves; here we use
    // absolute positioning via CSI H, which is semantically equivalent (same row).
    const frame = (glyph: string) =>
      `\x1b[10;1H\x1b[2K${glyph} Blanching… still thinking`
    p.feed(frame('·'))
    p.feed(frame('✢'))
    p.feed(frame('✶'))

    // Scrollback should still be empty — grid didn't scroll (nothing overflowed)
    expect(p.scrollback.length).toBe(0)
    // First two text rows survive
    expect(p.rowToText(p.buffer[0]).includes('system ready')).toBe(true)
    expect(p.rowToText(p.buffer[1]).includes('first message')).toBe(true)
    // Spinner row (10) has current glyph, previous frames overwritten
    expect(p.rowToText(p.buffer[9])).toBe('✶ Blanching… still thinking')
    // Only ONE row contains Blanching — three frames collapsed to one
    const blanchCount = p.buffer.filter(r => p.rowToText(r).includes('Blanching')).length
    expect(blanchCount).toBe(1)
  })
})

describe('AnsiParser — scrollback', () => {
  it('evicts rows to scrollback when cursor overflows bottom', () => {
    const p = new AnsiParser(3, 10)
    p.feed('a\r\nb\r\nc\r\nd\r\ne')
    expect(p.scrollback.length).toBe(2)
    expect(p.rowToText(p.scrollback[0])).toBe('a')
    expect(p.rowToText(p.scrollback[1])).toBe('b')
    expect(p.rowToText(p.buffer[0])).toBe('c')
    expect(p.rowToText(p.buffer[2])).toBe('e')
  })

  it('scrollback is capped at scrollbackLimit', () => {
    const p = new AnsiParser(3, 10, 5)
    for (let i = 0; i < 20; i++) p.feed(`line${i}\r\n`)
    expect(p.scrollback.length).toBeLessThanOrEqual(5)
  })
})

describe('AnsiParser — resize', () => {
  it('resize preserves visible text row content (simple truncate/pad)', () => {
    const p = new AnsiParser(5, 10)
    p.feed('hello\r\nworld')
    p.resize(5, 20)
    expect(p.rowToText(p.buffer[0])).toBe('hello')
    expect(p.rowToText(p.buffer[1])).toBe('world')
    p.resize(5, 3)
    expect(p.rowToText(p.buffer[0])).toBe('hel')
  })
})
