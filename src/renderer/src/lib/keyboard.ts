/** Map a KeyboardEvent to PTY byte sequences. Returns null if the key is not
 * a terminal-relevant binding (e.g. modifier-only presses). Printable chars
 * are intentionally returned; callers that run keyboard through a textarea
 * should skip printable + let onInput handle them so IME works. */
export function keyToBytes(e: KeyboardEvent): string | null {
  const k = e.key
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && k.length === 1) {
    const c = k.toLowerCase().charCodeAt(0)
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96) // Ctrl+A..Z → \x01..\x1a
    if (k === ' ') return '\x00'
  }
  switch (k) {
    case 'Enter': return '\r'
    case 'Backspace': return '\x7f'
    case 'Tab': return e.shiftKey ? '\x1b[Z' : '\t'
    case 'Escape': return '\x1b'
    case 'ArrowUp': return '\x1b[A'
    case 'ArrowDown': return '\x1b[B'
    case 'ArrowRight': return '\x1b[C'
    case 'ArrowLeft': return '\x1b[D'
    case 'Home': return '\x1b[H'
    case 'End': return '\x1b[F'
    case 'PageUp': return '\x1b[5~'
    case 'PageDown': return '\x1b[6~'
    case 'Delete': return '\x1b[3~'
  }
  if (k.length === 1 && !ctrl) return k
  return null
}
