import { describe, expect, it } from 'vitest'
import { TerminalCore } from '../terminal-core'

/** Synchronously feed + wait for flush. xterm batches writes; the only
 * reliable way to read buffer state post-write is via the flush callback. */
function feedSync(core: TerminalCore, data: string): Promise<void> {
  return new Promise(resolve => core.feed(data, resolve))
}

describe('TerminalCore — basics (via @xterm/headless)', () => {
  it('plain chars land at expected positions', async () => {
    const core = new TerminalCore(5, 10)
    await feedSync(core, 'hi')
    expect(core.rowToText(core.getRow(0))).toBe('hi')
    expect(core.cursor.col).toBe(2)
  })

  it('CR + LF moves to next line column 0 (PTY cooked)', async () => {
    const core = new TerminalCore(5, 10)
    await feedSync(core, 'abc\r\nxyz')
    expect(core.rowToText(core.getRow(0))).toBe('abc')
    expect(core.rowToText(core.getRow(1))).toBe('xyz')
  })

  it('SGR basic foreground colors come through (palette)', async () => {
    const core = new TerminalCore(3, 10)
    await feedSync(core, '\x1b[31mR\x1b[0mN')
    const row = core.getRow(0)
    expect(row[0].fg).toBe('#EB4268') // Crush red
    expect(row[1].fg).toBeUndefined()
  })

  it('SGR 24-bit RGB comes through as rgb() string', async () => {
    const core = new TerminalCore(3, 10)
    await feedSync(core, '\x1b[38;2;215;118;87mB')
    expect(core.getRow(0)[0].fg).toBe('rgb(215,118,87)')
  })

  it('bold attribute is preserved', async () => {
    const core = new TerminalCore(3, 10)
    await feedSync(core, '\x1b[1mA\x1b[22mB')
    expect(core.getRow(0)[0].bold).toBe(true)
    expect(core.getRow(0)[1].bold).toBeUndefined()
  })
})

describe('TerminalCore — CJK double-width (via unicode11)', () => {
  it('CJK char occupies 2 cells; continuation cell marked', async () => {
    const core = new TerminalCore(3, 10)
    await feedSync(core, 'a你b')
    const row = core.getRow(0)
    expect(row[0].char).toBe('a')
    expect(row[1].char).toBe('你')
    expect(row[2].cont).toBe(true)
    expect(row[3].char).toBe('b')
    expect(core.cursor.col).toBe(4)
  })

  it('rowToText skips continuation cells and returns the original string', async () => {
    const core = new TerminalCore(3, 20)
    await feedSync(core, '❯ 你好 world')
    expect(core.rowToText(core.getRow(0))).toBe('❯ 你好 world')
    // Logical cursor column = 1(❯) + 1(sp) + 2(你) + 2(好) + 1(sp) + 5(world) = 12
    expect(core.cursor.col).toBe(12)
  })

  it('mixed CJK + ASCII stays aligned across multiple rows', async () => {
    const core = new TerminalCore(10, 40)
    await feedSync(core, '❯ 你好 world\r\n答复：继续 work 完成了\r\n')
    expect(core.rowToText(core.getRow(0))).toBe('❯ 你好 world')
    expect(core.rowToText(core.getRow(1))).toBe('答复：继续 work 完成了')
  })
})

describe('TerminalCore — spinner in-place repaint', () => {
  it('absolute-positioned spinner frames do not scroll the grid', async () => {
    const core = new TerminalCore(30, 100)
    await feedSync(core, 'system ready\r\nfirst message\r\n')

    const frame = (glyph: string) =>
      `\x1b[10;1H\x1b[2K${glyph} Blanching… still thinking`
    await feedSync(core, frame('·'))
    await feedSync(core, frame('✢'))
    await feedSync(core, frame('✶'))

    expect(core.scrollbackLength).toBe(0)
    expect(core.rowToText(core.getRow(0)).includes('system ready')).toBe(true)
    expect(core.rowToText(core.getRow(1)).includes('first message')).toBe(true)
    expect(core.rowToText(core.getRow(9))).toBe('✶ Blanching… still thinking')
    const rows = core.getRows(0, 30)
    const blanchCount = rows.filter(r => core.rowToText(r).includes('Blanching')).length
    expect(blanchCount).toBe(1)
  })
})

describe('TerminalCore — scrollback', () => {
  it('rows scroll off into scrollback when cursor overflows bottom', async () => {
    const core = new TerminalCore(3, 10)
    await feedSync(core, 'a\r\nb\r\nc\r\nd\r\ne')
    expect(core.scrollbackLength).toBe(2)
    expect(core.rowToText(core.getRow(0))).toBe('a')
    expect(core.rowToText(core.getRow(1))).toBe('b')
    expect(core.rowToText(core.getRow(2))).toBe('c') // first visible row
    expect(core.rowToText(core.getRow(4))).toBe('e')
  })

  it('scrollback is capped at the configured limit', async () => {
    const core = new TerminalCore(3, 10, 5)
    for (let i = 0; i < 20; i++) await feedSync(core, `line${i}\r\n`)
    // scrollbackLength + rows should not exceed limit + rows by much
    expect(core.scrollbackLength).toBeLessThanOrEqual(5)
  })
})

describe('TerminalCore — resize', () => {
  it('resize changes reported rows/cols', async () => {
    const core = new TerminalCore(5, 10)
    await feedSync(core, 'hello\r\nworld')
    core.resize(5, 20)
    expect(core.cols).toBe(20)
    expect(core.rowToText(core.getRow(0))).toBe('hello')
  })
})
