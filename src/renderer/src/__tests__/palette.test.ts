// @vitest-environment jsdom
//
// Palette module tests — the module is small but load-bearing (settings
// UI enumerates PALETTES, applies data-palette). A missing entry or a
// swatch typo would silently render an empty-looking picker.

import { describe, it, expect, beforeEach } from 'vitest'
import { PALETTES, PALETTE_META, type Palette, loadPalette, applyPalette, availablePalettes, halloweenTakeover, isHalloweenSeason } from '../palette'

describe('palette', () => {
  it('lists the shipped palettes in the expected order (Halloween is the seasonal one)', () => {
    expect(PALETTES).toEqual(['neon-purple', 'tech-blue', 'future-pink', 'halloween'])
  })

  it('has a metadata entry for every listed palette', () => {
    for (const id of PALETTES) {
      const meta = PALETTE_META[id]
      expect(meta, `palette meta missing for ${id}`).toBeDefined()
      expect(meta.id).toBe(id)
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.tagline.length).toBeGreaterThan(0)
    }
  })

  it('every swatch is a well-formed 6-digit hex color', () => {
    for (const id of PALETTES) {
      expect(PALETTE_META[id].swatch).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('PALETTE_META has no extra keys beyond PALETTES', () => {
    // Guards against a stale entry after a palette gets removed —
    // stale rows would render as ghost buttons in the settings picker.
    const metaKeys = Object.keys(PALETTE_META).sort()
    const expected = [...PALETTES].sort()
    expect(metaKeys).toEqual(expected)
  })

  it('narrows correctly for `Palette` type at runtime', () => {
    // Sanity: the tuple derives Palette correctly.
    const p: Palette = 'tech-blue'
    expect(PALETTES).toContain(p)
  })
})

describe('loadPalette / applyPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-palette')
  })

  it('defaults to neon-purple when nothing saved', () => {
    expect(loadPalette()).toBe('neon-purple')
  })

  it('returns the saved palette when it is a known value', () => {
    localStorage.setItem('hive:palette', 'future-pink')
    expect(loadPalette()).toBe('future-pink')
  })

  it('ignores unknown or stale saved values', () => {
    // Simulates a downgrade or a rogue write from an old build.
    localStorage.setItem('hive:palette', 'retro-orange')
    expect(loadPalette()).toBe('neon-purple')
  })

  it('applyPalette sets data-palette attribute for non-default palettes', () => {
    applyPalette('tech-blue')
    expect(document.documentElement.getAttribute('data-palette')).toBe('tech-blue')
    expect(localStorage.getItem('hive:palette')).toBe('tech-blue')
  })

  it('applyPalette REMOVES data-palette attribute for the default palette', () => {
    // First set something so the attr exists, then apply default and expect removal.
    applyPalette('future-pink')
    expect(document.documentElement.getAttribute('data-palette')).toBe('future-pink')
    applyPalette('neon-purple')
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
    // But localStorage still records the choice so load returns the right default.
    expect(localStorage.getItem('hive:palette')).toBe('neon-purple')
  })

  it('load→apply→load round-trip preserves the palette', () => {
    applyPalette('tech-blue')
    expect(loadPalette()).toBe('tech-blue')
  })
})

describe('🎃 Halloween, a limited skin', () => {
  beforeEach(() => localStorage.clear())
  const oct27 = new Date(2026, 9, 27), nov2 = new Date(2026, 10, 2, 23), nov3 = new Date(2026, 10, 3), oct23 = new Date(2026, 9, 23)

  it('is in season Oct 24 – Nov 2 only, and only then in the picker', () => {
    expect([oct23, new Date(2026, 9, 24), oct27, nov2, nov3].map(d => isHalloweenSeason(d))).toEqual([false, true, true, true, false])
    expect(availablePalettes(oct27)).toContain('halloween')
    expect(availablePalettes(nov3)).not.toContain('halloween')
  })

  it('puts itself on once per season and remembers what it replaced; the owner can switch back', () => {
    expect(halloweenTakeover('tech-blue', oct27)).toBe('halloween')
    applyPalette('halloween')
    applyPalette('future-pink')
    expect(halloweenTakeover('future-pink', oct27)).toBe('future-pink')
    expect(halloweenTakeover('neon-purple', nov3)).toBe('neon-purple')
  })

  it('after the season it hands back the palette from before', () => {
    halloweenTakeover('tech-blue', oct27)
    applyPalette('halloween')
    expect(loadPalette(oct27)).toBe('halloween')
    expect(loadPalette(nov3)).toBe('tech-blue')
    expect(localStorage.getItem('hive:palette')).toBe('tech-blue')
  })

  it('next year it comes back once more', () => {
    halloweenTakeover('tech-blue', oct27)
    expect(halloweenTakeover('tech-blue', new Date(2027, 9, 25))).toBe('halloween')
  })
})
