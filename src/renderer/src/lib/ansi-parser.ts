export interface Cell {
  char: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export interface Attrs {
  fg?: string
  bg?: string
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
}

export const CRUSH_BASE_COLORS = [
  '#201F26', '#EB4268', '#00FFB2', '#E8FE96',
  '#00A4FF', '#FF60FF', '#68FFD6', '#DFDBDD'
]
export const CRUSH_BRIGHT_COLORS = [
  '#605F6B', '#FF577D', '#68FFD6', '#FFFAF1',
  '#4FBEFE', '#FF84FF', '#5CDFEA', '#F1EFEF'
]

export function color256(n: number): string {
  if (n < 16) return (n < 8 ? CRUSH_BASE_COLORS : CRUSH_BRIGHT_COLORS)[n % 8]
  if (n >= 232) {
    const g = 8 + (n - 232) * 10
    return `rgb(${g},${g},${g})`
  }
  const i = n - 16
  const r = Math.floor(i / 36) % 6
  const g = Math.floor(i / 6) % 6
  const b = i % 6
  const to = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${to(r)},${to(g)},${to(b)})`
}

function emptyCell(): Cell {
  return { char: ' ' }
}

function emptyAttrs(): Attrs {
  return { bold: false, dim: false, italic: false, underline: false, inverse: false }
}

/**
 * VT100-ish ANSI parser that maintains a viewport grid (rows x cols) plus a
 * scrollback ring buffer of lines that have scrolled off the top.
 *
 * Supports the subset Claude Code actually emits: SGR (16/256/RGB colors +
 * bold/dim/italic/underline/inverse), cursor moves (A/B/C/D/E/F/G/H/f/d),
 * erase (J/K/X), insert/delete lines/chars, scroll up/down, save/restore,
 * OSC (ignored through ST/BEL). Drops alternate screen and mouse tracking.
 */
export class AnsiParser {
  rows: number
  cols: number
  scrollbackLimit: number

  buffer: Cell[][] = []
  scrollback: Cell[][] = []
  cursor = { row: 0, col: 0 }
  attrs: Attrs = emptyAttrs()

  private state: 'ground' | 'esc' | 'csi' | 'osc' = 'ground'
  private params = ''
  private savedCursor: { row: number; col: number } | null = null

  constructor(rows = 24, cols = 80, scrollbackLimit = 5000) {
    this.rows = rows
    this.cols = cols
    this.scrollbackLimit = scrollbackLimit
    this.resetBuffer()
  }

  resize(rows: number, cols: number) {
    if (rows === this.rows && cols === this.cols) return
    // Preserve existing content by reflowing row-by-row (simple approach: pad/truncate).
    const oldRows = this.buffer
    this.rows = rows
    this.cols = cols
    this.buffer = Array.from({ length: rows }, (_, r) => {
      const src = oldRows[r]
      if (!src) return this.blankRow()
      const row = src.slice(0, cols)
      while (row.length < cols) row.push(emptyCell())
      return row
    })
    this.cursor.row = Math.min(this.cursor.row, rows - 1)
    this.cursor.col = Math.min(this.cursor.col, cols - 1)
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.cols }, () => emptyCell())
  }

  private resetBuffer() {
    this.buffer = Array.from({ length: this.rows }, () => this.blankRow())
    this.cursor = { row: 0, col: 0 }
  }

  /** Feed bytes. Safe to call with any string chunk size. */
  feed(data: string) {
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      const code = c.charCodeAt(0)

      if (this.state === 'ground') {
        if (c === '\x1b') { this.state = 'esc'; continue }
        if (c === '\r') { this.cursor.col = 0; continue }
        if (c === '\n') { this.lineFeed(); continue }
        if (c === '\b') { this.cursor.col = Math.max(0, this.cursor.col - 1); continue }
        if (c === '\t') {
          this.cursor.col = Math.min(this.cols - 1, (Math.floor(this.cursor.col / 8) + 1) * 8)
          continue
        }
        if (code < 32) continue
        this.putChar(c)
      } else if (this.state === 'esc') {
        if (c === '[') { this.state = 'csi'; this.params = ''; continue }
        if (c === ']') { this.state = 'osc'; continue }
        if (c === '7') { this.savedCursor = { ...this.cursor }; this.state = 'ground'; continue }
        if (c === '8') {
          if (this.savedCursor) this.cursor = { ...this.savedCursor }
          this.state = 'ground'; continue
        }
        // Character set designators (() * +), DECPAM/DECPNM (= >), RIS (c) — ignore.
        this.state = 'ground'
      } else if (this.state === 'csi') {
        if (code >= 0x30 && code <= 0x3F) { this.params += c; continue }
        if (code >= 0x40 && code <= 0x7E) {
          this.handleCSI(c)
          this.state = 'ground'
          continue
        }
        // Out of spec — bail.
        this.state = 'ground'
      } else if (this.state === 'osc') {
        if (c === '\x07') { this.state = 'ground'; continue }
        if (c === '\x1b' && data[i + 1] === '\\') { i++; this.state = 'ground'; continue }
        // swallow
      }
    }
  }

  private putChar(c: string) {
    if (this.cursor.col >= this.cols) {
      this.cursor.col = 0
      this.lineFeed()
    }
    const cell: Cell = { char: c }
    if (this.attrs.fg) cell.fg = this.attrs.fg
    if (this.attrs.bg) cell.bg = this.attrs.bg
    if (this.attrs.bold) cell.bold = true
    if (this.attrs.dim) cell.dim = true
    if (this.attrs.italic) cell.italic = true
    if (this.attrs.underline) cell.underline = true
    if (this.attrs.inverse) cell.inverse = true
    this.buffer[this.cursor.row][this.cursor.col] = cell
    this.cursor.col++
  }

  private lineFeed() {
    if (this.cursor.row < this.rows - 1) {
      this.cursor.row++
    } else {
      const evicted = this.buffer.shift()
      if (evicted) {
        this.scrollback.push(evicted)
        if (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift()
      }
      this.buffer.push(this.blankRow())
    }
  }

  private handleCSI(cmd: string) {
    const isPrivate = this.params.startsWith('?')
    const paramStr = isPrivate ? this.params.slice(1) : this.params
    const tokens = paramStr.split(';')
    const params: (number | undefined)[] = tokens.map(t => (t === '' ? undefined : parseInt(t, 10)))
    const p = (i: number, def: number) => params[i] ?? def

    switch (cmd) {
      case 'A': this.cursor.row = Math.max(0, this.cursor.row - p(0, 1)); break
      case 'B': this.cursor.row = Math.min(this.rows - 1, this.cursor.row + p(0, 1)); break
      case 'C': this.cursor.col = Math.min(this.cols - 1, this.cursor.col + p(0, 1)); break
      case 'D': this.cursor.col = Math.max(0, this.cursor.col - p(0, 1)); break
      case 'E': this.cursor.row = Math.min(this.rows - 1, this.cursor.row + p(0, 1)); this.cursor.col = 0; break
      case 'F': this.cursor.row = Math.max(0, this.cursor.row - p(0, 1)); this.cursor.col = 0; break
      case 'G':
        this.cursor.col = Math.max(0, Math.min(this.cols - 1, p(0, 1) - 1))
        break
      case 'H':
      case 'f':
        this.cursor.row = Math.max(0, Math.min(this.rows - 1, p(0, 1) - 1))
        this.cursor.col = Math.max(0, Math.min(this.cols - 1, p(1, 1) - 1))
        break
      case 'J': this.eraseInDisplay(p(0, 0)); break
      case 'K': this.eraseInLine(p(0, 0)); break
      case 'L': this.insertLines(p(0, 1)); break
      case 'M': this.deleteLines(p(0, 1)); break
      case 'P': this.deleteChars(p(0, 1)); break
      case 'S': this.scrollUp(p(0, 1)); break
      case 'T': this.scrollDown(p(0, 1)); break
      case 'X': this.eraseChars(p(0, 1)); break
      case 'd':
        this.cursor.row = Math.max(0, Math.min(this.rows - 1, p(0, 1) - 1))
        break
      case 'm': this.handleSGR(params); break
      case 's': this.savedCursor = { ...this.cursor }; break
      case 'u': if (this.savedCursor) this.cursor = { ...this.savedCursor }; break
      default: break
    }
  }

  private eraseInDisplay(mode: number) {
    if (mode === 0) {
      this.eraseInLine(0)
      for (let r = this.cursor.row + 1; r < this.rows; r++) this.buffer[r] = this.blankRow()
    } else if (mode === 1) {
      this.eraseInLine(1)
      for (let r = 0; r < this.cursor.row; r++) this.buffer[r] = this.blankRow()
    } else if (mode === 2 || mode === 3) {
      this.resetBuffer()
    }
  }

  private eraseInLine(mode: number) {
    const row = this.buffer[this.cursor.row]
    if (!row) return
    if (mode === 0) {
      for (let c = this.cursor.col; c < this.cols; c++) row[c] = emptyCell()
    } else if (mode === 1) {
      for (let c = 0; c <= this.cursor.col; c++) row[c] = emptyCell()
    } else if (mode === 2) {
      for (let c = 0; c < this.cols; c++) row[c] = emptyCell()
    }
  }

  private eraseChars(n: number) {
    const row = this.buffer[this.cursor.row]
    if (!row) return
    const end = Math.min(this.cols, this.cursor.col + n)
    for (let c = this.cursor.col; c < end; c++) row[c] = emptyCell()
  }

  private deleteChars(n: number) {
    const row = this.buffer[this.cursor.row]
    if (!row) return
    row.splice(this.cursor.col, n)
    while (row.length < this.cols) row.push(emptyCell())
  }

  private insertLines(n: number) {
    for (let k = 0; k < n; k++) {
      this.buffer.splice(this.cursor.row, 0, this.blankRow())
      this.buffer.length = this.rows
    }
  }

  private deleteLines(n: number) {
    for (let k = 0; k < n; k++) {
      this.buffer.splice(this.cursor.row, 1)
      this.buffer.push(this.blankRow())
    }
  }

  private scrollUp(n: number) {
    for (let k = 0; k < n; k++) {
      const evicted = this.buffer.shift()
      if (evicted) {
        this.scrollback.push(evicted)
        if (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift()
      }
      this.buffer.push(this.blankRow())
    }
  }

  private scrollDown(n: number) {
    for (let k = 0; k < n; k++) {
      this.buffer.pop()
      this.buffer.unshift(this.blankRow())
    }
  }

  private handleSGR(paramsIn: (number | undefined)[]) {
    let params = paramsIn
    if (params.length === 0 || (params.length === 1 && params[0] === undefined)) params = [0]
    let i = 0
    while (i < params.length) {
      const v = params[i] ?? 0
      if (v === 0) this.attrs = emptyAttrs()
      else if (v === 1) this.attrs.bold = true
      else if (v === 2) this.attrs.dim = true
      else if (v === 3) this.attrs.italic = true
      else if (v === 4) this.attrs.underline = true
      else if (v === 7) this.attrs.inverse = true
      else if (v === 22) { this.attrs.bold = false; this.attrs.dim = false }
      else if (v === 23) this.attrs.italic = false
      else if (v === 24) this.attrs.underline = false
      else if (v === 27) this.attrs.inverse = false
      else if (v >= 30 && v <= 37) this.attrs.fg = CRUSH_BASE_COLORS[v - 30]
      else if (v === 38) {
        if (params[i + 1] === 5) {
          this.attrs.fg = color256(params[i + 2] ?? 0)
          i += 2
        } else if (params[i + 1] === 2) {
          const r = params[i + 2] ?? 0, g = params[i + 3] ?? 0, b = params[i + 4] ?? 0
          this.attrs.fg = `rgb(${r},${g},${b})`
          i += 4
        }
      } else if (v === 39) this.attrs.fg = undefined
      else if (v >= 40 && v <= 47) this.attrs.bg = CRUSH_BASE_COLORS[v - 40]
      else if (v === 48) {
        if (params[i + 1] === 5) {
          this.attrs.bg = color256(params[i + 2] ?? 0)
          i += 2
        } else if (params[i + 1] === 2) {
          const r = params[i + 2] ?? 0, g = params[i + 3] ?? 0, b = params[i + 4] ?? 0
          this.attrs.bg = `rgb(${r},${g},${b})`
          i += 4
        }
      } else if (v === 49) this.attrs.bg = undefined
      else if (v >= 90 && v <= 97) this.attrs.fg = CRUSH_BRIGHT_COLORS[v - 90]
      else if (v >= 100 && v <= 107) this.attrs.bg = CRUSH_BRIGHT_COLORS[v - 100]
      i++
    }
  }

  /** All visible + scrollback rows, in order. Each row is cloned. */
  allRows(): Cell[][] {
    return [...this.scrollback, ...this.buffer].map(r => r.slice())
  }

  /** Row as plain text (trimmed trailing spaces). */
  rowToText(row: Cell[]): string {
    return row.map(c => c.char).join('').replace(/\s+$/, '')
  }
}
