import { describe, expect, it } from 'vitest'
import { glyphColor, parseStructuredLine, parseStructuredOutput } from '../structured-format'
import { CRUSH } from '../crush-styles'

describe('glyphColor', () => {
  it('Julep for ✓ / ✔ / ●', () => {
    expect(glyphColor('✓')).toBe(CRUSH.Julep)
    expect(glyphColor('✔')).toBe(CRUSH.Julep)
    expect(glyphColor('●')).toBe(CRUSH.Julep)
  })
  it('Sriracha for ✗ / ❌', () => {
    expect(glyphColor('✗')).toBe(CRUSH.Sriracha)
    expect(glyphColor('❌')).toBe(CRUSH.Sriracha)
  })
  it('Zest for ⚠', () => {
    expect(glyphColor('⚠')).toBe(CRUSH.Zest)
  })
  it('Ash for unknown', () => {
    expect(glyphColor('x')).toBe(CRUSH.Ash)
    expect(glyphColor('')).toBe(CRUSH.Ash)
  })
})

describe('parseStructuredLine', () => {
  it('detects heading with === Title === pattern', () => {
    expect(parseStructuredLine('=== 8 tasks done ===')).toEqual({
      type: 'heading',
      title: '8 tasks done'
    })
  })

  it('requires 3+ equals on each side', () => {
    expect(parseStructuredLine('== title ==').type).toBe('line')
    expect(parseStructuredLine('=== title ===').type).toBe('heading')
    expect(parseStructuredLine('==== title ====').type).toBe('heading')
  })

  it('does not match heading without surrounding whitespace', () => {
    expect(parseStructuredLine('===title===').type).toBe('line')
  })

  it('captures heading title with mixed-script content', () => {
    expect(parseStructuredLine('=== 8 道 stem-regen ===')).toMatchObject({
      type: 'heading',
      title: '8 道 stem-regen'
    })
  })

  it('returns blank for empty / whitespace-only line', () => {
    expect(parseStructuredLine('').type).toBe('blank')
  })

  it('plain text becomes a single text segment', () => {
    const r = parseStructuredLine('just plain text')
    expect(r).toMatchObject({
      type: 'line',
      segments: [{ type: 'text', content: 'just plain text' }]
    })
  })

  it('inline ✓ glyph colored Julep, surrounding text preserved', () => {
    const r = parseStructuredLine('✓ 0e28b19d  ✓ 1132ada4')
    expect(r.type).toBe('line')
    if (r.type !== 'line') return
    expect(r.segments).toEqual([
      { type: 'glyph', content: '✓', color: CRUSH.Julep },
      { type: 'text', content: ' 0e28b19d  ' },
      { type: 'glyph', content: '✓', color: CRUSH.Julep },
      { type: 'text', content: ' 1132ada4' }
    ])
  })

  it('handles ✗ and ❌ as Sriracha glyphs', () => {
    const r = parseStructuredLine('build failed ✗ tests ❌')
    expect(r.type).toBe('line')
    if (r.type !== 'line') return
    const glyphs = r.segments.filter(s => s.type === 'glyph')
    expect(glyphs).toHaveLength(2)
    expect(glyphs.every(g => g.type === 'glyph' && g.color === CRUSH.Sriracha)).toBe(true)
  })

  it('handles ⚠ as Zest', () => {
    const r = parseStructuredLine('⚠ 1 file unchanged')
    expect(r.type).toBe('line')
    if (r.type !== 'line') return
    expect(r.segments[0]).toEqual({ type: 'glyph', content: '⚠', color: CRUSH.Zest })
  })

  it('mixed glyphs in one line each get their own color', () => {
    const r = parseStructuredLine('✓ ok  ✗ fail  ⚠ warn  ● note')
    expect(r.type).toBe('line')
    if (r.type !== 'line') return
    const glyphs = r.segments.filter(s => s.type === 'glyph') as Extract<typeof r.segments[number], { type: 'glyph' }>[]
    expect(glyphs.map(g => g.color)).toEqual([
      CRUSH.Julep, CRUSH.Sriracha, CRUSH.Zest, CRUSH.Julep
    ])
  })

  it('text-only line preserves whitespace', () => {
    expect(parseStructuredLine('   indented text  ')).toMatchObject({
      type: 'line',
      segments: [{ type: 'text', content: '   indented text  ' }]
    })
  })
})

describe('parseStructuredOutput', () => {
  it('splits on \\n and parses each line independently', () => {
    const out = parseStructuredOutput('=== Section 1 ===\n✓ first item\n✗ second item\n\n=== Section 2 ===\nplain')
    expect(out.length).toBe(6)
    expect(out[0]).toEqual({ type: 'heading', title: 'Section 1' })
    expect(out[3].type).toBe('blank')
    expect(out[4]).toEqual({ type: 'heading', title: 'Section 2' })
    expect(out[5].type).toBe('line')
  })

  it('empty input returns one blank line', () => {
    expect(parseStructuredOutput('')).toEqual([{ type: 'blank' }])
  })

  it('preserves order across many lines', () => {
    const out = parseStructuredOutput('a\nb\nc')
    expect(out.map(l => l.type === 'line' ? (l.segments[0] as any).content : null)).toEqual(['a', 'b', 'c'])
  })

  it('realistic sample: 8 stem-regen tasks', () => {
    const sample = '=== 8 道 stem-regen ===\n✓ 0e28b19d  ✓ 1132ada4  ✓ 81d92685  ✓ 82ba8490\n✓ 835e350d  ✓ a4607fd5  ✓ bb2fb356  ✓ bd966e69'
    const out = parseStructuredOutput(sample)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ type: 'heading', title: '8 道 stem-regen' })
    if (out[1].type !== 'line') throw new Error('expected line')
    const glyphs1 = out[1].segments.filter(s => s.type === 'glyph')
    expect(glyphs1).toHaveLength(4)
    expect(glyphs1.every(g => g.type === 'glyph' && g.color === CRUSH.Julep)).toBe(true)
  })
})
