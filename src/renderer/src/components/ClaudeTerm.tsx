import { useEffect, useMemo, useRef, useState } from 'react'

interface Cell {
  char: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

interface Attrs {
  fg?: string
  bg?: string
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
}

const BASE_COLORS = [
  '#201F26', '#EB4268', '#00FFB2', '#E8FE96',
  '#00A4FF', '#FF60FF', '#68FFD6', '#DFDBDD'
]
const BRIGHT_COLORS = [
  '#605F6B', '#FF577D', '#68FFD6', '#FFFAF1',
  '#4FBEFE', '#FF84FF', '#5CDFEA', '#F1EFEF'
]

function color256(n: number): string {
  if (n < 16) return (n < 8 ? BASE_COLORS : BRIGHT_COLORS)[n % 8]
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

class AnsiParser {
  rows: number
  cols: number
  buffer: Cell[][] = []
  cursor = { row: 0, col: 0 }
  attrs: Attrs = { bold: false, dim: false, italic: false, underline: false, inverse: false }
  private state: 'ground' | 'esc' | 'csi' | 'osc' = 'ground'
  private params = ''
  private savedCursor: { row: number; col: number } | null = null

  constructor(rows: number, cols: number) {
    this.rows = rows
    this.cols = cols
    this.resetBuffer()
  }

  resize(rows: number, cols: number) {
    this.rows = rows
    this.cols = cols
    while (this.buffer.length < rows) this.buffer.push(this.blankRow())
    this.buffer.length = rows
    for (const row of this.buffer) {
      while (row.length < cols) row.push(this.blank())
      row.length = cols
    }
    this.cursor.row = Math.min(this.cursor.row, rows - 1)
    this.cursor.col = Math.min(this.cursor.col, cols - 1)
  }

  private blank(): Cell { return { char: ' ' } }
  private blankRow(): Cell[] {
    return Array.from({ length: this.cols }, () => this.blank())
  }
  private resetBuffer() {
    this.buffer = Array.from({ length: this.rows }, () => this.blankRow())
  }

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
        this.state = 'ground'
      } else if (this.state === 'csi') {
        if (code >= 0x30 && code <= 0x3F) { this.params += c; continue }
        if (code >= 0x40 && code <= 0x7E) {
          this.handleCSI(c)
          this.state = 'ground'
          continue
        }
        this.state = 'ground'
      } else if (this.state === 'osc') {
        if (c === '\x07') { this.state = 'ground'; continue }
        if (c === '\x1b' && data[i + 1] === '\\') { i++; this.state = 'ground'; continue }
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
      this.buffer.shift()
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
      for (let c = this.cursor.col; c < this.cols; c++) row[c] = this.blank()
    } else if (mode === 1) {
      for (let c = 0; c <= this.cursor.col; c++) row[c] = this.blank()
    } else if (mode === 2) {
      for (let c = 0; c < this.cols; c++) row[c] = this.blank()
    }
  }

  private eraseChars(n: number) {
    const row = this.buffer[this.cursor.row]
    if (!row) return
    const end = Math.min(this.cols, this.cursor.col + n)
    for (let c = this.cursor.col; c < end; c++) row[c] = this.blank()
  }

  private deleteChars(n: number) {
    const row = this.buffer[this.cursor.row]
    if (!row) return
    row.splice(this.cursor.col, n)
    while (row.length < this.cols) row.push(this.blank())
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
      this.buffer.shift()
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
      if (v === 0) {
        this.attrs = { bold: false, dim: false, italic: false, underline: false, inverse: false }
      } else if (v === 1) this.attrs.bold = true
      else if (v === 2) this.attrs.dim = true
      else if (v === 3) this.attrs.italic = true
      else if (v === 4) this.attrs.underline = true
      else if (v === 7) this.attrs.inverse = true
      else if (v === 22) { this.attrs.bold = false; this.attrs.dim = false }
      else if (v === 23) this.attrs.italic = false
      else if (v === 24) this.attrs.underline = false
      else if (v === 27) this.attrs.inverse = false
      else if (v >= 30 && v <= 37) this.attrs.fg = BASE_COLORS[v - 30]
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
      else if (v >= 40 && v <= 47) this.attrs.bg = BASE_COLORS[v - 40]
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
      else if (v >= 90 && v <= 97) this.attrs.fg = BRIGHT_COLORS[v - 90]
      else if (v >= 100 && v <= 107) this.attrs.bg = BRIGHT_COLORS[v - 100]
      i++
    }
  }
}

function cellKey(cell: Cell): string {
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

function styleFromKey(key: string): React.CSSProperties {
  const [fg, bg, b, d, it, u, v] = key.split('|')
  const s: React.CSSProperties = {}
  let foreground = fg || undefined
  let background = bg || undefined
  if (v) {
    const tmp = foreground
    foreground = background || '#201F26'
    background = tmp || '#DFDBDD'
  }
  if (foreground) s.color = foreground
  if (background) s.background = background
  if (b) s.fontWeight = 700
  if (d) s.opacity = 0.6
  if (it) s.fontStyle = 'italic'
  if (u) s.textDecoration = 'underline'
  return s
}

export default function ClaudeTerm({
  id,
  visible,
  rows = 24,
  cols = 80
}: {
  id: string
  visible: boolean
  rows?: number
  cols?: number
}) {
  const parserRef = useRef<AnsiParser | null>(null)
  const pendingRef = useRef<string>('')
  const rafRef = useRef<number | null>(null)
  const [, setTick] = useState(0)

  if (!parserRef.current) parserRef.current = new AnsiParser(rows, cols)

  useEffect(() => {
    const parser = parserRef.current!
    if (parser.rows !== rows || parser.cols !== cols) parser.resize(rows, cols)
  }, [rows, cols])

  useEffect(() => {
    const scheduleFlush = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (pendingRef.current) {
          parserRef.current!.feed(pendingRef.current)
          pendingRef.current = ''
          setTick(t => t + 1)
        }
      })
    }

    const unsubscribe = window.api.pty.onData(id, (data: string) => {
      pendingRef.current += data
      scheduleFlush()
    })

    return () => {
      unsubscribe()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [id])

  const parser = parserRef.current!

  const rendered = useMemo(() => {
    return parser.buffer.map((row, r) => {
      const segments: { key: string; text: string }[] = []
      let currentKey = ''
      let currentText = ''
      for (const cell of row) {
        const k = cellKey(cell)
        if (k === currentKey) {
          currentText += cell.char
        } else {
          if (currentText) segments.push({ key: currentKey, text: currentText })
          currentKey = k
          currentText = cell.char
        }
      }
      if (currentText) segments.push({ key: currentKey, text: currentText })
      return { r, segments }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parser.buffer, parser.cursor.row, parser.cursor.col, visible])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#201F26',
        color: '#DFDBDD',
        fontFamily: '"JetBrains Mono", "Noto Mono for Powerline", Menlo, Monaco, monospace',
        fontSize: 13,
        lineHeight: 1.3,
        overflow: 'auto',
        padding: '8px 12px',
        whiteSpace: 'pre',
        fontVariantLigatures: 'none'
      }}
    >
      {rendered.map(({ r, segments }) => (
        <div key={r} style={{ minHeight: '1.3em' }}>
          {segments.map((seg, i) => (
            <span key={i} style={styleFromKey(seg.key)}>{seg.text}</span>
          ))}
        </div>
      ))}
    </div>
  )
}
