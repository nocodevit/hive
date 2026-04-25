import { describe, expect, it } from 'vitest'
import { keyToBytes } from '../keyboard'

/** Minimal shape that satisfies keyToBytes — we don't need a real KeyboardEvent. */
function ev(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial
  } as KeyboardEvent
}

describe('keyToBytes — printable / control chars', () => {
  it('returns the printable char for plain single-char keys', () => {
    expect(keyToBytes(ev({ key: 'a' }))).toBe('a')
    expect(keyToBytes(ev({ key: 'Z' }))).toBe('Z')
    expect(keyToBytes(ev({ key: '5' }))).toBe('5')
    expect(keyToBytes(ev({ key: ' ' }))).toBe(' ')
  })
})

describe('keyToBytes — named keys', () => {
  it('Enter → \\r', () => expect(keyToBytes(ev({ key: 'Enter' }))).toBe('\r'))
  it('Backspace → \\x7f', () =>
    expect(keyToBytes(ev({ key: 'Backspace' }))).toBe('\x7f'))
  it('Tab → \\t', () => expect(keyToBytes(ev({ key: 'Tab' }))).toBe('\t'))
  it('Shift+Tab → \\x1b[Z', () =>
    expect(keyToBytes(ev({ key: 'Tab', shiftKey: true }))).toBe('\x1b[Z'))
  it('Escape → \\x1b', () =>
    expect(keyToBytes(ev({ key: 'Escape' }))).toBe('\x1b'))
})

describe('keyToBytes — arrow keys', () => {
  it('ArrowUp → CSI A', () =>
    expect(keyToBytes(ev({ key: 'ArrowUp' }))).toBe('\x1b[A'))
  it('ArrowDown → CSI B', () =>
    expect(keyToBytes(ev({ key: 'ArrowDown' }))).toBe('\x1b[B'))
  it('ArrowRight → CSI C', () =>
    expect(keyToBytes(ev({ key: 'ArrowRight' }))).toBe('\x1b[C'))
  it('ArrowLeft → CSI D', () =>
    expect(keyToBytes(ev({ key: 'ArrowLeft' }))).toBe('\x1b[D'))
})

describe('keyToBytes — navigation keys', () => {
  it('Home → CSI H', () =>
    expect(keyToBytes(ev({ key: 'Home' }))).toBe('\x1b[H'))
  it('End → CSI F', () =>
    expect(keyToBytes(ev({ key: 'End' }))).toBe('\x1b[F'))
  it('PageUp → CSI 5~', () =>
    expect(keyToBytes(ev({ key: 'PageUp' }))).toBe('\x1b[5~'))
  it('PageDown → CSI 6~', () =>
    expect(keyToBytes(ev({ key: 'PageDown' }))).toBe('\x1b[6~'))
  it('Delete → CSI 3~', () =>
    expect(keyToBytes(ev({ key: 'Delete' }))).toBe('\x1b[3~'))
})

describe('keyToBytes — Ctrl + letters', () => {
  it('Ctrl+A → \\x01', () =>
    expect(keyToBytes(ev({ key: 'a', ctrlKey: true }))).toBe('\x01'))
  it('Ctrl+C → \\x03', () =>
    expect(keyToBytes(ev({ key: 'c', ctrlKey: true }))).toBe('\x03'))
  it('Ctrl+D → \\x04', () =>
    expect(keyToBytes(ev({ key: 'd', ctrlKey: true }))).toBe('\x04'))
  it('Ctrl+Z → \\x1a', () =>
    expect(keyToBytes(ev({ key: 'z', ctrlKey: true }))).toBe('\x1a'))
  it('uppercase letter with Ctrl still maps correctly', () => {
    expect(keyToBytes(ev({ key: 'C', ctrlKey: true }))).toBe('\x03')
  })
  it('Cmd (metaKey) behaves the same as ctrlKey on mac', () => {
    expect(keyToBytes(ev({ key: 'c', metaKey: true }))).toBe('\x03')
  })
})

describe('keyToBytes — Ctrl+Space', () => {
  it('Ctrl+Space → \\x00 (NUL)', () => {
    expect(keyToBytes(ev({ key: ' ', ctrlKey: true }))).toBe('\x00')
  })
})

describe('keyToBytes — unknown / modifier-only', () => {
  it('returns null for modifier-only events', () => {
    expect(keyToBytes(ev({ key: 'Control' }))).toBeNull()
    expect(keyToBytes(ev({ key: 'Shift' }))).toBeNull()
    expect(keyToBytes(ev({ key: 'Meta' }))).toBeNull()
    expect(keyToBytes(ev({ key: 'Alt' }))).toBeNull()
  })

  it('returns null for unhandled named keys', () => {
    expect(keyToBytes(ev({ key: 'F1' }))).toBeNull()
    expect(keyToBytes(ev({ key: 'CapsLock' }))).toBeNull()
  })

  it('does not emit printable when Ctrl is held for non-letter', () => {
    // Ctrl+1 → no ctrl-letter mapping, falls through to the printable
    // check which requires !ctrl, so returns null.
    expect(keyToBytes(ev({ key: '1', ctrlKey: true }))).toBeNull()
  })
})
