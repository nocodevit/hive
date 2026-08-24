import { describe, it, expect } from 'vitest'
import { noteTagColor, NOTE_TAG_COLORS, NoteTag } from '../noteTag'

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

// Inspect the element NoteTag returns directly (no jsdom) — the repo's jsdom
// env is flaky (html-encoding-sniffer ESM require), so we assert on props.
describe('NoteTag', () => {
  it('shows the note text and title', () => {
    // v2.8.1: the note text is now wrapped in an inner `<span class="truncate">`
    // so overflow ellipsis + symmetric outer padding coexist. children is
    // that inner span, not a raw string; walk into it for the text.
    const el = NoteTag({ id: 'agent-7', note: 'ship it' }) as any
    expect(el.type).toBe('span')
    expect(el.props.title).toBe('ship it')
    const inner = el.props.children as any
    expect(inner.type).toBe('span')
    expect(inner.props.children).toBe('ship it')
  })

  it('renders border + text at the full palette hex (no desaturation)', () => {
    const id = 'agent-7'
    const color = noteTagColor(id)
    const el = NoteTag({ id, note: 'x' }) as any
    expect(el.props.style.color).toBe(color)
    expect(el.props.style.borderColor).toBe(color)
  })

  it('uses a translucent light fill = hex + 1F alpha suffix', () => {
    const id = 'agent-7'
    const color = noteTagColor(id)
    const el = NoteTag({ id, note: 'x' }) as any
    expect(el.props.style.background).toBe(`${color}1F`)
  })
})
