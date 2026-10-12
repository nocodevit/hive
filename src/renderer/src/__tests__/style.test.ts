// @vitest-environment jsdom
//
// v2.9.0 Style module — Style is orthogonal to Palette. A style may
// restrict which palettes it supports (applyStyle then coerces); since
// v2.25.0 none does: Prime accepts Future Pink too.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  STYLES, STYLE_META, type Style,
  loadStyle, applyStyle,
  PALETTES,
} from '../palette'

describe('Style module', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-style')
    document.documentElement.removeAttribute('data-palette')
  })

  it('lists the two shipped styles in expected order', () => {
    expect(STYLES).toEqual(['accent', 'prime'])
  })

  it('every style has metadata + compatible palette set', () => {
    for (const id of STYLES) {
      expect(STYLE_META[id]).toBeDefined()
      expect(STYLE_META[id].id).toBe(id)
      expect(STYLE_META[id].compatiblePalettes.length).toBeGreaterThan(0)
      for (const p of STYLE_META[id].compatiblePalettes) {
        expect(PALETTES).toContain(p)
      }
    }
  })

  it('every style supports every palette, Prime + Future Pink included', () => {
    for (const id of STYLES) expect([...STYLE_META[id].compatiblePalettes]).toEqual([...PALETTES])
  })

  it('loadStyle defaults to accent when nothing saved', () => {
    expect(loadStyle()).toBe('accent')
  })

  it('loadStyle returns the saved value when it is a known style', () => {
    localStorage.setItem('hive:style', 'prime')
    expect(loadStyle()).toBe('prime')
  })

  it('loadStyle ignores unknown / stale values', () => {
    localStorage.setItem('hive:style', 'retro-cyberpunk')
    expect(loadStyle()).toBe('accent')
  })

  it('applyStyle sets data-style attribute for non-default styles', () => {
    applyStyle('prime', 'neon-purple')
    expect(document.documentElement.getAttribute('data-style')).toBe('prime')
    expect(localStorage.getItem('hive:style')).toBe('prime')
  })

  it('applyStyle removes data-style for default (accent)', () => {
    applyStyle('prime', 'neon-purple')
    applyStyle('accent', 'neon-purple')
    expect(document.documentElement.hasAttribute('data-style')).toBe(false)
    expect(localStorage.getItem('hive:style')).toBe('accent')
  })

  it('applyStyle keeps Future Pink when switching to Prime', () => {
    localStorage.setItem('hive:palette', 'future-pink')
    document.documentElement.setAttribute('data-palette', 'future-pink')
    const returned = applyStyle('prime', 'future-pink')
    expect(returned).toBe('future-pink')
    expect(document.documentElement.getAttribute('data-palette')).toBe('future-pink')
    expect(document.documentElement.getAttribute('data-style')).toBe('prime')
  })

  it('applyStyle leaves compatible palette alone', () => {
    document.documentElement.setAttribute('data-palette', 'tech-blue')
    const returned = applyStyle('prime', 'tech-blue')
    expect(returned).toBe('tech-blue')
    expect(document.documentElement.getAttribute('data-palette')).toBe('tech-blue')
  })

  it('round-trip: applyStyle → loadStyle preserves', () => {
    applyStyle('prime', 'neon-purple')
    expect(loadStyle()).toBe('prime')
  })

  it('type-narrows correctly at runtime', () => {
    const s: Style = 'prime'
    expect(STYLES).toContain(s)
  })
})
