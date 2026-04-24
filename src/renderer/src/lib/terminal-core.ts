import { Terminal } from '@xterm/headless'
import type { IBufferCell, IBufferLine } from '@xterm/headless'
import { Unicode11Addon } from '@xterm/addon-unicode11'

/** Shape produced by our Cell adapter — kept stable across parser swaps so
 * render-side helpers (`buildSegments`, etc.) keep working. */
export interface Cell {
  char: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  /** Continuation half of a wide glyph (width=0 slot). */
  cont?: boolean
}

/** Crush-palette basic 16 ANSI colors. */
const CRUSH_BASE = [
  '#201F26', '#EB4268', '#00FFB2', '#E8FE96',
  '#00A4FF', '#FF60FF', '#68FFD6', '#DFDBDD'
]
const CRUSH_BRIGHT = [
  '#605F6B', '#FF577D', '#68FFD6', '#FFFAF1',
  '#4FBEFE', '#FF84FF', '#5CDFEA', '#F1EFEF'
]

function paletteToCss(idx: number): string {
  if (idx < 8) return CRUSH_BASE[idx]
  if (idx < 16) return CRUSH_BRIGHT[idx - 8]
  if (idx < 232) {
    const i = idx - 16
    const r = Math.floor(i / 36) % 6
    const g = Math.floor(i / 6) % 6
    const b = i % 6
    const to = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${to(r)},${to(g)},${to(b)})`
  }
  const g = 8 + (idx - 232) * 10
  return `rgb(${g},${g},${g})`
}

function rgbToCss(n: number): string {
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgb(${r},${g},${b})`
}

/**
 * TerminalCore wraps xterm.js's headless state machine (`@xterm/headless`)
 * and exposes a thin adapter that returns our `Cell` shape. All ANSI
 * parsing, cursor maths, scrollback, and Unicode11 double-width handling
 * is delegated to xterm — that's the battle-tested state machine and we
 * shouldn't reimplement it.
 */
export class TerminalCore {
  private term: Terminal

  constructor(rows = 24, cols = 80, scrollbackLimit = 5000) {
    this.term = new Terminal({
      rows,
      cols,
      scrollback: scrollbackLimit,
      allowProposedApi: true
    })
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
  }

  get rows(): number { return this.term.rows }
  get cols(): number { return this.term.cols }

  /** Feed PTY bytes. xterm batches writes internally; the callback fires
   * once the bytes are committed to the buffer and the grid is up to date. */
  feed(data: string, onFlushed?: () => void): void {
    this.term.write(data, onFlushed)
  }

  resize(rows: number, cols: number): void {
    if (rows === this.term.rows && cols === this.term.cols) return
    this.term.resize(cols, rows)
  }

  /** Cursor position relative to the top of the viewport. */
  get cursor(): { row: number; col: number } {
    const buf = this.term.buffer.active
    return { row: buf.cursorY, col: buf.cursorX }
  }

  /** Cursor position in absolute row coordinates (includes scrollback). */
  get cursorAbs(): { row: number; col: number } {
    const buf = this.term.buffer.active
    return { row: buf.baseY + buf.cursorY, col: buf.cursorX }
  }

  /** Number of rows currently in scrollback (above the viewport). */
  get scrollbackLength(): number {
    return this.term.buffer.active.baseY
  }

  /** Total row count (scrollback + viewport). */
  get totalRows(): number {
    return this.term.buffer.active.length
  }

  /** Row at an absolute row index (0..totalRows-1). */
  getRow(absY: number): Cell[] {
    return this.lineToRow(this.term.buffer.active.getLine(absY))
  }

  /** The row that currently contains the cursor. */
  getCursorRow(): Cell[] {
    return this.getRow(this.cursorAbs.row)
  }

  /** Slice of rows by absolute index range [start, end). Rows beyond buffer
   * are padded with blanks so callers can always expect a fixed count. */
  getRows(start: number, end: number): Cell[][] {
    const out: Cell[][] = []
    for (let y = start; y < end; y++) {
      if (y < 0 || y >= this.totalRows) {
        out.push(this.blankRow())
      } else {
        out.push(this.getRow(y))
      }
    }
    return out
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.cols }, () => ({ char: ' ' } as Cell))
  }

  private lineToRow(line: IBufferLine | undefined): Cell[] {
    if (!line) return this.blankRow()
    const out: Cell[] = []
    for (let x = 0; x < line.length; x++) {
      const c = line.getCell(x)
      if (!c) { out.push({ char: ' ' }); continue }
      out.push(this.cellFromBuffer(c))
    }
    return out
  }

  private cellFromBuffer(c: IBufferCell): Cell {
    const width = c.getWidth()
    if (width === 0) return { char: '', cont: true }
    const chars = c.getChars()
    const cell: Cell = { char: chars || ' ' }

    if (c.isFgRGB()) cell.fg = rgbToCss(c.getFgColor())
    else if (c.isFgPalette()) cell.fg = paletteToCss(c.getFgColor())

    if (c.isBgRGB()) cell.bg = rgbToCss(c.getBgColor())
    else if (c.isBgPalette()) cell.bg = paletteToCss(c.getBgColor())

    if (c.isBold()) cell.bold = true
    if (c.isDim()) cell.dim = true
    if (c.isItalic()) cell.italic = true
    if (c.isUnderline()) cell.underline = true
    if (c.isInverse()) cell.inverse = true

    return cell
  }

  /** Row as plain text, skipping continuation cells, trimmed of trailing spaces. */
  rowToText(row: Cell[]): string {
    let s = ''
    for (const cell of row) {
      if (cell.cont) continue
      s += cell.char
    }
    return s.replace(/\s+$/, '')
  }
}
