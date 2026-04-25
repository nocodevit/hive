import { CRUSH } from './crush-styles'

/**
 * Parse common shell/Bash output patterns into a typed structure that
 * the renderer can turn into JSX. Two patterns are recognized:
 *   - `=== Title ===`  → heading (3+ equals, surrounded by whitespace)
 *   - inline glyphs    → `✓ ✔ ●` (Julep), `✗ ❌` (Sriracha), `⚠` (Zest)
 * Everything else is plain text. Empty lines round-trip as `blank`.
 *
 * Pure functions, no React, no DOM. Vitest-tested.
 */

const HEADING_RE = /^={3,}\s+(.+?)\s+={3,}\s*$/
const GLYPH_RE_SRC = '([✓✗⚠❌●✔])'  // ✓ ✗ ⚠ ❌ ● ✔

export type StructuredSegment =
  | { type: 'text'; content: string }
  | { type: 'glyph'; content: string; color: string }

export type StructuredLine =
  | { type: 'heading'; title: string }
  | { type: 'blank' }
  | { type: 'line'; segments: StructuredSegment[] }

export function glyphColor(ch: string): string {
  if (ch === '✓' || ch === '✔' || ch === '●') return CRUSH.Julep   // ✓ ✔ ●
  if (ch === '✗' || ch === '❌') return CRUSH.Sriracha                   // ✗ ❌
  if (ch === '⚠') return CRUSH.Zest                                          // ⚠
  return CRUSH.Ash
}

export function parseStructuredLine(line: string): StructuredLine {
  const h = line.match(HEADING_RE)
  if (h) return { type: 'heading', title: h[1] }
  const segments: StructuredSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  const re = new RegExp(GLYPH_RE_SRC, 'g')
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: line.slice(last, m.index) })
    segments.push({ type: 'glyph', content: m[1], color: glyphColor(m[1]) })
    last = m.index + m[1].length
  }
  if (last < line.length) segments.push({ type: 'text', content: line.slice(last) })
  if (segments.length === 0) return { type: 'blank' }
  return { type: 'line', segments }
}

export function parseStructuredOutput(text: string): StructuredLine[] {
  return text.split('\n').map(parseStructuredLine)
}
