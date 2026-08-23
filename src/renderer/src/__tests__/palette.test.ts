// @vitest-environment jsdom
//
// Palette module tests — the module is small but load-bearing (settings
// UI enumerates PALETTES, applies data-palette). A missing entry or a
// swatch typo would silently render an empty-looking picker.

import { describe, it, expect } from 'vitest'
import { PALETTES, PALETTE_META, type Palette } from '../palette'

describe('palette', () => {
  it('lists the three shipped palettes in the expected order', () => {
    expect(PALETTES).toEqual(['neon-purple', 'tech-blue', 'future-pink'])
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
