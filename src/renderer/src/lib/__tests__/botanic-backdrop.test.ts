// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { BACKDROPS, loadBackdrop, saveBackdrop, nextBackdrop, onBackdrop } from '../botanic-backdrop'

beforeEach(() => localStorage.clear())

describe('Botanic dark garden photos', () => {
  it('four photos; starts on the first; an unknown saved id falls back to it', () => {
    expect(BACKDROPS.map(b => b.id)).toEqual(['jungle', 'understory', 'canopy', 'leaves'])
    expect(loadBackdrop()).toBe('jungle')
    localStorage.setItem('hive:botanic-backdrop', 'monstera')
    expect(loadBackdrop()).toBe('jungle')
  })

  it('next wraps around; saving remembers it and tells listeners', () => {
    expect(nextBackdrop('leaves')).toBe('jungle')
    const got: string[] = []
    const off = onBackdrop(id => got.push(id))
    saveBackdrop('canopy')
    off()
    saveBackdrop('leaves')
    expect(got).toEqual(['canopy'])
    expect(loadBackdrop()).toBe('leaves')
  })
})
