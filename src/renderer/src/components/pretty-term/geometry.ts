import type { TerminalCore, Cell } from '../../lib/terminal-core'

export type CursorPos = { row: number; col: number }
export type SelectionRange = { start: CursorPos; end: CursorPos } | null

export interface GridSize {
  rows: number
  cols: number
}

export interface Metrics {
  w: number
  h: number
}

/**
 * Current cursor expressed as a viewport row (0..gridSize.rows-1). Returns
 * null if cursor is outside the visible viewport (user scrolled up far
 * enough that the live terminal row is above the scroll position).
 */
export function cursorViewPos(
  core: TerminalCore,
  gridSize: GridSize,
  scrollOffset: number
): CursorPos | null {
  const cursorAbs = core.cursorAbs
  const allCount = core.totalRows
  const topRow = Math.max(0, allCount - gridSize.rows - scrollOffset)
  const bottomRow = topRow + gridSize.rows - 1
  if (cursorAbs.row < topRow || cursorAbs.row > bottomRow) return null
  return { row: cursorAbs.row - topRow, col: cursorAbs.col }
}

/** Convert a mouse event into an absolute grid cell position. */
export function posFromEvent(
  e: { clientX: number; clientY: number },
  viewEl: HTMLElement,
  gridSize: GridSize,
  metrics: Metrics,
  scrollOffset: number,
  coreTotalRows: number
): CursorPos | null {
  const rect = viewEl.getBoundingClientRect()
  const x = e.clientX - rect.left - 8
  const y = e.clientY - rect.top - 8
  const col = Math.max(0, Math.min(gridSize.cols - 1, Math.floor(x / metrics.w)))
  const rowInView = Math.floor(y / metrics.h)
  const topRow = coreTotalRows - gridSize.rows - scrollOffset
  const absRow = Math.max(0, Math.min(coreTotalRows - 1, topRow + rowInView))
  return { row: absRow, col }
}

/** Find the user-input region on the row containing the cursor — where we
 * should paint the Dolly-tinted highlight. We anchor on `❯` in the first
 * few columns of the line, then highlight from after the prompt space to
 * wherever the cursor currently sits. Returns viewport-row coordinates. */
export function userInputRange(
  core: TerminalCore,
  gridSize: GridSize,
  scrollOffset: number
): { row: number; startCol: number; endCol: number } | null {
  const cursorRow = core.cursor.row
  const cursorAbs = core.cursorAbs
  const row = core.getCursorRow()
  if (!row) return null
  for (let c = 0; c < Math.min(row.length, 4); c++) {
    if (row[c].char === '❯') {
      let startCol = c + 1
      while (startCol < row.length && row[startCol].char === ' ') startCol++
      const endCol = Math.max(core.cursor.col, startCol)
      if (endCol <= startCol) return null
      const allCount = core.totalRows
      const topRow = Math.max(0, allCount - gridSize.rows - scrollOffset)
      const viewRow = cursorAbs.row - topRow
      if (viewRow < 0 || viewRow >= gridSize.rows) return null
      return { row: viewRow, startCol, endCol }
    }
  }
  return null
}

/** Return selection clipped so start <= end in reading order. */
export function orderSelection(sel: NonNullable<SelectionRange>): [CursorPos, CursorPos] {
  const { start, end } = sel
  if (start.row < end.row || (start.row === end.row && start.col <= end.col)) return [start, end]
  return [end, start]
}

/** Extract text for a selection across rows (including scrollback). */
export function selectionText(core: TerminalCore, sel: NonNullable<SelectionRange>): string {
  const [a, b] = orderSelection(sel)
  const lines: string[] = []
  for (let r = a.row; r <= b.row; r++) {
    const row = core.getRow(r)
    if (!row) continue
    const startCol = r === a.row ? a.col : 0
    const endCol = r === b.row ? b.col : row.length - 1
    let text = ''
    for (let c = startCol; c <= endCol; c++) {
      const cell = row[c]
      if (cell?.cont) continue
      text += cell?.char ?? ' '
    }
    lines.push(text.replace(/\s+$/, ''))
  }
  return lines.join('\n')
}
