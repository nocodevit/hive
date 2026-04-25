import { describe, expect, it } from 'vitest'
import { crushifyColors, crushifyRgb, CRUSH_ACCENTS } from '../crushify-colors'

describe('crushifyRgb', () => {
  it('snaps exact Crush accent colors to themselves', () => {
    for (const accent of CRUSH_ACCENTS) {
      const [r, g, b] = accent.rgb
      expect(crushifyRgb(r, g, b)).toEqual(accent.rgb)
    }
  })

  it('snaps a muted red to a red-family Crush accent', () => {
    // Pale/muted red → nearest by HSL hue is Sriracha or Bright-Red.
    const [R, G, B] = crushifyRgb(200, 80, 100)
    // Must be one of the red-family accents (hue-distance-dominated).
    const reds = new Set(['Sriracha', 'Bright-Red'].map(n =>
      CRUSH_ACCENTS.find(a => a.name === n)!.rgb.join(',')))
    expect(reds.has([R, G, B].join(','))).toBe(true)
  })

  it('snaps a muted purple to a purple-family Crush accent', () => {
    const [R, G, B] = crushifyRgb(130, 100, 220)
    const purples = new Set(['Charple', 'Violet', 'Mochi'].map(n =>
      CRUSH_ACCENTS.find(a => a.name === n)!.rgb.join(',')))
    expect(purples.has([R, G, B].join(','))).toBe(true)
  })

  it('returns a tuple of three 0-255 integers', () => {
    const rgb = crushifyRgb(12, 34, 56)
    expect(rgb).toHaveLength(3)
    for (const v of rgb) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })
})

describe('crushifyColors — SGR rewriting', () => {
  it('returns input unchanged when there are no CSI sequences', () => {
    expect(crushifyColors('hello world')).toBe('hello world')
    expect(crushifyColors('')).toBe('')
  })

  it('rewrites a 24-bit foreground SGR to a Crush accent SGR', () => {
    const input = '\x1b[38;2;200;80;100mhello\x1b[0m'
    const out = crushifyColors(input)
    // Structural check: still a 38;2;R;G;B SGR, followed by the same body.
    expect(out).toMatch(/^\x1b\[38;2;\d+;\d+;\d+mhello\x1b\[0m$/)
    // The RGB must correspond to one of the Crush accents.
    const match = out.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m/)
    expect(match).not.toBeNull()
    const rgb = [Number(match![1]), Number(match![2]), Number(match![3])]
    const accentRgbs = CRUSH_ACCENTS.map(a => a.rgb.join(','))
    expect(accentRgbs).toContain(rgb.join(','))
  })

  it('rewrites a 24-bit background SGR to a Crush accent', () => {
    const input = '\x1b[48;2;120;30;50mHI\x1b[0m'
    const out = crushifyColors(input)
    expect(out).toMatch(/^\x1b\[48;2;\d+;\d+;\d+mHI\x1b\[0m$/)
    const match = out.match(/^\x1b\[48;2;(\d+);(\d+);(\d+)m/)
    const rgb = [Number(match![1]), Number(match![2]), Number(match![3])]
    expect(CRUSH_ACCENTS.map(a => a.rgb.join(','))).toContain(rgb.join(','))
  })

  it('leaves non-24-bit SGR sequences intact', () => {
    const input = '\x1b[31mred\x1b[0mplain\x1b[1mbold\x1b[0m'
    expect(crushifyColors(input)).toBe(input)
  })

  it('only rewrites 38;2 and 48;2 — palette SGR (38;5) is untouched', () => {
    const input = '\x1b[38;5;196mpalette-red\x1b[0m'
    expect(crushifyColors(input)).toBe(input)
  })

  it('preserves surrounding literal text exactly', () => {
    const input = 'before \x1b[38;2;255;96;255m MID \x1b[0m after'
    const out = crushifyColors(input)
    expect(out.startsWith('before ')).toBe(true)
    expect(out.includes(' MID ')).toBe(true)
    expect(out.endsWith(' after')).toBe(true)
  })

  it('rewrites multiple SGR sequences in a single pass', () => {
    const input =
      '\x1b[38;2;200;80;100mA\x1b[38;2;80;200;120mB\x1b[48;2;50;50;200mC\x1b[0m'
    const out = crushifyColors(input)
    const rgbMatches = Array.from(out.matchAll(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/g))
    expect(rgbMatches).toHaveLength(3)
    const accentRgbs = new Set(CRUSH_ACCENTS.map(a => a.rgb.join(',')))
    for (const m of rgbMatches) {
      expect(accentRgbs.has([m[1], m[2], m[3]].join(','))).toBe(true)
    }
  })
})
