import type { Cell } from './terminal-core'
import { BG, FG } from './crush-theme'

export interface CellSegment {
  key: string
  text: string
  startCol: number
}

/** Stable style fingerprint for a Cell — used to group adjacent cells into
 * a single <span> run. Two cells with identical styles produce identical keys. */
export function cellKey(cell: Cell): string {
  return [
    cell.fg || '',
    cell.bg || '',
    cell.bold ? 'b' : '',
    cell.dim ? 'd' : '',
    cell.italic ? 'i' : '',
    cell.underline ? 'u' : '',
    cell.inverse ? 'v' : ''
  ].join('|')
}

/** Convert a cell fingerprint back into React inline style. Inverse SGR swaps
 * fg/bg (defaulting to terminal BG/FG when one side is absent). */
export function styleFromKey(key: string): React.CSSProperties {
  const [fg, bg, b, d, it, u, v] = key.split('|')
  const s: React.CSSProperties = {}
  let foreground: string | undefined = fg || undefined
  let background: string | undefined = bg || undefined
  if (v) {
    const tmp = foreground
    foreground = background || BG
    background = tmp || FG
  }
  if (foreground) s.color = foreground
  if (background) s.background = background
  if (b) s.fontWeight = 700
  if (d) s.opacity = 0.6
  if (it) s.fontStyle = 'italic'
  if (u) s.textDecoration = 'underline'
  return s
}

/** Group a row's cells into contiguous style runs. Continuation cells of
 * double-width glyphs are skipped — their primary cell already holds the
 * full character, so emitting them again would double the visual width. */
export function buildSegments(row: Cell[]): CellSegment[] {
  const segments: CellSegment[] = []
  let currentKey = ''
  let currentText = ''
  let startCol = 0
  for (let c = 0; c < row.length; c++) {
    const cell = row[c]
    if (cell.cont) continue
    const k = cellKey(cell)
    if (k === currentKey) {
      currentText += cell.char
    } else {
      if (currentText) segments.push({ key: currentKey, text: currentText, startCol })
      currentKey = k
      currentText = cell.char
      startCol = c
    }
  }
  if (currentText) segments.push({ key: currentKey, text: currentText, startCol })
  return segments
}
