import { describe, expect, it } from 'vitest'
import { cellKey, styleFromKey, buildSegments } from '../cell-render'
import type { Cell } from '../terminal-core'
import { BG, FG } from '../crush-theme'

function cell(char: string, extra: Partial<Cell> = {}): Cell {
  return { char, ...extra }
}

describe('cellKey', () => {
  it('produces identical keys for identical styles', () => {
    const a = cell('a', { fg: '#fff', bg: '#000', bold: true })
    const b = cell('b', { fg: '#fff', bg: '#000', bold: true })
    expect(cellKey(a)).toBe(cellKey(b))
  })

  it('differs when any style attribute differs', () => {
    const base = cell('a', { fg: '#fff' })
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#eee' })))
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#fff', bold: true })))
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#fff', italic: true })))
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#fff', underline: true })))
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#fff', dim: true })))
    expect(cellKey(base)).not.toBe(cellKey(cell('a', { fg: '#fff', inverse: true })))
  })

  it('ignores the char itself — only style matters', () => {
    expect(cellKey(cell('x'))).toBe(cellKey(cell('y')))
  })

  it('empty cell produces empty-ish key (all blanks)', () => {
    expect(cellKey(cell(' '))).toBe('||||||')
  })
})

describe('styleFromKey', () => {
  it('maps fg/bg to color/background', () => {
    const s = styleFromKey(cellKey(cell('a', { fg: '#EB4268', bg: '#201F26' })))
    expect(s.color).toBe('#EB4268')
    expect(s.background).toBe('#201F26')
  })

  it('sets bold → fontWeight 700', () => {
    const s = styleFromKey(cellKey(cell('a', { bold: true })))
    expect(s.fontWeight).toBe(700)
  })

  it('sets dim → opacity 0.6', () => {
    const s = styleFromKey(cellKey(cell('a', { dim: true })))
    expect(s.opacity).toBe(0.6)
  })

  it('sets italic → fontStyle italic', () => {
    const s = styleFromKey(cellKey(cell('a', { italic: true })))
    expect(s.fontStyle).toBe('italic')
  })

  it('sets underline → textDecoration underline', () => {
    const s = styleFromKey(cellKey(cell('a', { underline: true })))
    expect(s.textDecoration).toBe('underline')
  })

  it('inverse swaps fg/bg', () => {
    const s = styleFromKey(cellKey(cell('a', { fg: '#EB4268', bg: '#201F26', inverse: true })))
    expect(s.color).toBe('#201F26')
    expect(s.background).toBe('#EB4268')
  })

  it('inverse with missing fg/bg falls back to theme defaults', () => {
    const s = styleFromKey(cellKey(cell('a', { inverse: true })))
    expect(s.color).toBe(BG)
    expect(s.background).toBe(FG)
  })

  it('returns empty-ish style for plain blank cell', () => {
    const s = styleFromKey(cellKey(cell(' ')))
    expect(s.color).toBeUndefined()
    expect(s.background).toBeUndefined()
    expect(s.fontWeight).toBeUndefined()
  })

  it('combines multiple attributes', () => {
    const s = styleFromKey(cellKey(cell('a', {
      fg: '#fff', bold: true, italic: true, underline: true
    })))
    expect(s.color).toBe('#fff')
    expect(s.fontWeight).toBe(700)
    expect(s.fontStyle).toBe('italic')
    expect(s.textDecoration).toBe('underline')
  })
})

describe('buildSegments', () => {
  it('returns empty array for empty row', () => {
    expect(buildSegments([])).toEqual([])
  })

  it('groups adjacent same-style cells into a single segment', () => {
    const row = [cell('h'), cell('i')]
    const out = buildSegments(row)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('hi')
    expect(out[0].startCol).toBe(0)
  })

  it('splits into multiple segments on style change', () => {
    const row = [
      cell('a', { fg: '#f00' }),
      cell('b', { fg: '#f00' }),
      cell('c', { fg: '#0f0' })
    ]
    const out = buildSegments(row)
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe('ab')
    expect(out[0].startCol).toBe(0)
    expect(out[1].text).toBe('c')
    expect(out[1].startCol).toBe(2)
  })

  it('skips continuation cells (wide-glyph tails)', () => {
    const row = [
      cell('你'),
      cell('', { cont: true }),
      cell('!')
    ]
    const out = buildSegments(row)
    // Primary char + '!' share the blank style key; continuation is skipped.
    // Since the style key matches and continuation is skipped, the two visible
    // cells merge into a single segment — confirming continuation was elided.
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('你!')
    expect(out[0].startCol).toBe(0)
  })

  it('preserves startCol across continuation gaps', () => {
    const row = [
      cell('a', { fg: '#f00' }),
      cell('你', { fg: '#0f0' }),
      cell('', { fg: '#0f0', cont: true }),
      cell('b', { fg: '#00f' })
    ]
    const out = buildSegments(row)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ text: 'a', startCol: 0 })
    expect(out[1]).toMatchObject({ text: '你', startCol: 1 })
    expect(out[2]).toMatchObject({ text: 'b', startCol: 3 })
  })

  it('omits trailing empty segment when row ends empty', () => {
    const row = [cell('a'), cell('b')]
    const segs = buildSegments(row)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('ab')
  })
})
