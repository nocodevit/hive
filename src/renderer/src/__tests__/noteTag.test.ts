import { describe, it, expect } from 'vitest'
import { noteTagColor, NOTE_TAG_COLORS } from '../noteTag'

describe('noteTagColor', () => {
  it('returns a color from the Crush palette', () => {
    expect(NOTE_TAG_COLORS).toContain(noteTagColor('agent-1'))
  })

  it('is deterministic for the same seed', () => {
    expect(noteTagColor('abc')).toBe(noteTagColor('abc'))
  })

  it('produces different colors for different seeds (spread across palette)', () => {
    const colors = new Set(
      Array.from({ length: 50 }, (_, i) => noteTagColor(`agent-${i}`))
    )
    expect(colors.size).toBeGreaterThan(1)
  })

  it('handles empty string without throwing', () => {
    expect(NOTE_TAG_COLORS).toContain(noteTagColor(''))
  })

  it('all palette colors are full 6-digit saturated hex', () => {
    for (const c of NOTE_TAG_COLORS) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})
