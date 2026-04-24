import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnsiParser, Cell } from '../lib/ansi-parser'

type CursorPos = { row: number; col: number }
type SelectionRange = { start: CursorPos; end: CursorPos } | null

interface Props {
  id: string
  visible: boolean
  /** Only the "active" view may drive PTY resize to avoid tug-of-war with xterm. */
  active?: boolean
}

const FONT_FAMILY = '"JetBrains Mono", "Noto Mono for Powerline", "MesloLGS NF", Menlo, Monaco, monospace'
const FONT_SIZE = 13
const LINE_HEIGHT = 1.35

// Crush palette
const BG = '#201F26'
const FG = '#DFDBDD'
const CURSOR = '#FF60FF' // Dolly
const PROMPT = '#00FFB2' // Julep (green)
const USER_INPUT_BG = 'rgba(255,96,255,0.22)'
const USER_INPUT_FG = '#FFFAF1'
const USER_INPUT_BORDER = '#FF60FF'
const SELECTION_BG = 'rgba(107,80,255,0.35)' // Charple

// Segment runs of same-style cells into spans for cheap rendering
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

// Map keyboard events to PTY byte sequences
function keyToBytes(e: KeyboardEvent): string | null {
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

export default function PrettyTerm({ id, visible, active = true }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const parserRef = useRef<AnsiParser | null>(null)
  const pendingRef = useRef<string>('')
  const rafRef = useRef<number | null>(null)
  const [tick, setTick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [charMetrics, setCharMetrics] = useState<{ w: number; h: number } | null>(null)
  const [gridSize, setGridSize] = useState<{ rows: number; cols: number }>({ rows: 24, cols: 80 })
  const [scrollOffset, setScrollOffset] = useState(0) // rows above buffer start visible
  const followBottom = useRef(true)
  const [selection, setSelection] = useState<SelectionRange>(null)
  const dragAnchor = useRef<CursorPos | null>(null)
  const composingRef = useRef(false)

  if (!parserRef.current) parserRef.current = new AnsiParser(gridSize.rows, gridSize.cols)

  // Measure character metrics once font loads
  useLayoutEffect(() => {
    const measure = () => {
      const el = measureRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const w = rect.width / 10 // "XXXXXXXXXX" — 10 chars
      const h = rect.height
      if (w > 0 && h > 0) setCharMetrics({ w, h })
    }
    measure()
    if ((document as any).fonts?.ready) {
      (document as any).fonts.ready.then(measure)
    }
  }, [])

  // Auto-size grid based on container + char metrics
  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el || !charMetrics) return
    const compute = () => {
      const rect = el.getBoundingClientRect()
      const cols = Math.max(10, Math.floor((rect.width - 16) / charMetrics.w))
      const rows = Math.max(3, Math.floor((rect.height - 16) / charMetrics.h))
      if (rows !== gridSize.rows || cols !== gridSize.cols) {
        parserRef.current!.resize(rows, cols)
        setGridSize({ rows, cols })
        if (active) window.api.pty.resize(id, cols, rows)
      }
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [charMetrics, id, gridSize.rows, gridSize.cols, active])

  // Subscribe PTY data with rAF batching
  useEffect(() => {
    const flush = () => {
      rafRef.current = null
      if (!pendingRef.current) return
      parserRef.current!.feed(pendingRef.current)
      pendingRef.current = ''
      setTick(t => t + 1)
      if (followBottom.current) setScrollOffset(0)
    }
    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(flush)
    }
    const unsub = window.api.pty.onData(id, (data: string) => {
      pendingRef.current += data
      schedule()
    })
    return () => {
      unsub()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [id])

  // Keyboard: attach globally while focused so we don't miss keys
  useEffect(() => {
    if (!focused || !visible) return
    const onKey = (e: KeyboardEvent) => {
      if (composingRef.current) return
      // Cmd+C / Ctrl+C with selection → copy
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selection) {
        const text = selectionText(parserRef.current!, selection)
        if (text) {
          navigator.clipboard.writeText(text)
          e.preventDefault()
          return
        }
      }
      const bytes = keyToBytes(e)
      if (bytes != null) {
        e.preventDefault()
        window.api.pty.write(id, bytes)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, visible, id, selection])

  // Paste
  useEffect(() => {
    if (!focused || !visible) return
    const onPaste = (e: ClipboardEvent) => {
      const el = wrapRef.current
      if (!el || !el.contains(document.activeElement) && document.activeElement !== el) return
      if (e.clipboardData?.files.length) {
        const paths = Array.from(e.clipboardData.files)
          .map(f => window.api.getFilePath(f))
          .filter(Boolean) as string[]
        if (paths.length > 0) {
          e.preventDefault()
          window.api.pty.write(id, paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' '))
          return
        }
      }
      const text = e.clipboardData?.getData('text/plain')
      if (text) {
        e.preventDefault()
        // bracketed paste
        window.api.pty.write(id, `\x1b[200~${text}\x1b[201~`)
      }
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [focused, visible, id])

  // Scroll (wheel)
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const parser = parserRef.current!
      const delta = Math.round(e.deltaY / 20) // rows per notch, tune
      if (delta === 0) return
      e.preventDefault()
      setScrollOffset(prev => {
        const next = Math.max(0, Math.min(parser.scrollback.length, prev + delta))
        followBottom.current = next === 0
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Mouse selection
  const posFromEvent = (e: React.MouseEvent | MouseEvent): CursorPos | null => {
    if (!charMetrics || !viewRef.current) return null
    const rect = viewRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - 8
    const y = e.clientY - rect.top - 8
    const col = Math.max(0, Math.min(gridSize.cols - 1, Math.floor(x / charMetrics.w)))
    const rowInView = Math.floor(y / charMetrics.h)
    // rowInView is within the scrolled view; convert to allRows index
    const parser = parserRef.current!
    const allRowCount = parser.scrollback.length + gridSize.rows
    const topRow = allRowCount - gridSize.rows - scrollOffset
    const absRow = Math.max(0, Math.min(allRowCount - 1, topRow + rowInView))
    return { row: absRow, col }
  }

  // Cursor position in view coordinates (includes scrollback)
  const cursorViewPos = (): CursorPos | null => {
    const parser = parserRef.current!
    const cursorAbs = { row: parser.scrollback.length + parser.cursor.row, col: parser.cursor.col }
    const allRowCount = parser.scrollback.length + gridSize.rows
    const topRow = allRowCount - gridSize.rows - scrollOffset
    const bottomRow = topRow + gridSize.rows - 1
    if (cursorAbs.row < topRow || cursorAbs.row > bottomRow) return null
    return { row: cursorAbs.row - topRow, col: cursorAbs.col }
  }

  // Detect user input region: on row with ❯ prompt where cursor sits
  const userInputRange = (): { row: number; startCol: number; endCol: number } | null => {
    const parser = parserRef.current!
    const cursorRow = parser.cursor.row
    const row = parser.buffer[cursorRow]
    if (!row) return null
    // Find ❯ at reasonable column position (0 or 1)
    for (let c = 0; c < Math.min(row.length, 4); c++) {
      if (row[c].char === '❯') {
        let startCol = c + 1
        while (startCol < row.length && row[startCol].char === ' ') startCol++
        const endCol = Math.max(parser.cursor.col, startCol)
        if (endCol <= startCol) return null
        // viewport row coord
        const allRowCount = parser.scrollback.length + gridSize.rows
        const topRow = allRowCount - gridSize.rows - scrollOffset
        const absRow = parser.scrollback.length + cursorRow
        const viewRow = absRow - topRow
        if (viewRow < 0 || viewRow >= gridSize.rows) return null
        return { row: viewRow, startCol, endCol }
      }
    }
    return null
  }

  // Build rendered viewport rows
  const viewRows = useMemo(() => {
    const parser = parserRef.current!
    const allRows = [...parser.scrollback, ...parser.buffer]
    const allCount = allRows.length
    const topRow = Math.max(0, allCount - gridSize.rows - scrollOffset)
    const visible = allRows.slice(topRow, topRow + gridSize.rows)
    // Pad if scrolled too far back
    while (visible.length < gridSize.rows) visible.push(Array.from({ length: gridSize.cols }, () => ({ char: ' ' } as Cell)))
    return visible
    // parser state changes captured via `tick`; also depends on grid size + scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, gridSize.rows, gridSize.cols, scrollOffset])

  const inputRange = userInputRange()
  const cur = cursorViewPos()

  // Render
  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={e => {
        const p = posFromEvent(e)
        if (!p) return
        dragAnchor.current = p
        setSelection({ start: p, end: p })
          ; (wrapRef.current as any)?.focus?.()
      }}
      onMouseMove={e => {
        if (!dragAnchor.current) return
        const p = posFromEvent(e)
        if (!p) return
        setSelection({ start: dragAnchor.current, end: p })
      }}
      onMouseUp={() => {
        dragAnchor.current = null
      }}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        const text = (e.nativeEvent as CompositionEvent).data
        if (text) window.api.pty.write(id, text)
      }}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: BG,
        color: FG,
        outline: 'none',
        overflow: 'hidden',
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        fontVariantLigatures: 'none',
        cursor: 'text',
        userSelect: 'none'
      }}
    >
      {/* Invisible measurer for char metrics */}
      <span
        ref={measureRef}
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre',
          fontFamily: FONT_FAMILY,
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT
        }}
      >XXXXXXXXXX</span>

      {/* Viewport */}
      <div
        ref={viewRef}
        style={{
          position: 'absolute',
          inset: 0,
          padding: 8,
          overflow: 'hidden',
          whiteSpace: 'pre'
        }}
      >
        {viewRows.map((row, r) => {
          const segments: { key: string; text: string; startCol: number }[] = []
          let currentKey = ''
          let currentText = ''
          let startCol = 0
          for (let c = 0; c < row.length; c++) {
            const cell = row[c]
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

          const isInputRow = inputRange && r === inputRange.row

          return (
            <div key={r} style={{ position: 'relative', height: `${LINE_HEIGHT}em`, lineHeight: `${LINE_HEIGHT}em` }}>
              {/* User input bg highlight */}
              {isInputRow && charMetrics && (
                <div style={{
                  position: 'absolute',
                  left: inputRange!.startCol * charMetrics.w,
                  top: 0,
                  width: (inputRange!.endCol - inputRange!.startCol + 1) * charMetrics.w,
                  height: '100%',
                  background: USER_INPUT_BG,
                  borderLeft: `2px solid ${USER_INPUT_BORDER}`,
                  pointerEvents: 'none'
                }} />
              )}
              {segments.map((seg, i) => {
                const style = styleFromKey(seg.key)
                // Promote user input fg for legibility
                if (isInputRow && inputRange &&
                    seg.startCol >= inputRange.startCol && seg.startCol < inputRange.endCol) {
                  style.color = USER_INPUT_FG
                }
                // Promote prompt char (❯) to green
                const text = seg.text
                if (text.includes('❯')) {
                  // split prompt out
                  const parts = text.split(/(❯)/)
                  return (
                    <span key={i}>
                      {parts.map((p, j) => p === '❯'
                        ? <span key={j} style={{ ...style, color: PROMPT, fontWeight: 700 }}>{p}</span>
                        : <span key={j} style={style}>{p}</span>)}
                    </span>
                  )
                }
                return <span key={i} style={style}>{text}</span>
              })}
            </div>
          )
        })}

        {/* Cursor */}
        {cur && focused && charMetrics && (
          <div style={{
            position: 'absolute',
            left: 8 + cur.col * charMetrics.w,
            top: 8 + cur.row * charMetrics.h,
            width: charMetrics.w,
            height: charMetrics.h,
            background: CURSOR,
            mixBlendMode: 'difference',
            animation: 'pretty-blink 1s step-end infinite',
            pointerEvents: 'none'
          }} />
        )}
        {cur && !focused && charMetrics && (
          <div style={{
            position: 'absolute',
            left: 8 + cur.col * charMetrics.w,
            top: 8 + cur.row * charMetrics.h,
            width: charMetrics.w,
            height: charMetrics.h,
            border: `1px solid ${CURSOR}`,
            pointerEvents: 'none'
          }} />
        )}

        {/* Selection highlight */}
        {selection && charMetrics && renderSelection(selection, gridSize, parserRef.current!, scrollOffset, charMetrics)}
      </div>

      <style>{`
        @keyframes pretty-blink { 50% { opacity: 0; } }
      `}</style>
    </div>
  )
}

function selectionText(parser: AnsiParser, sel: NonNullable<SelectionRange>): string {
  const [a, b] = orderSelection(sel)
  const rows = [...parser.scrollback, ...parser.buffer]
  const lines: string[] = []
  for (let r = a.row; r <= b.row; r++) {
    const row = rows[r]
    if (!row) continue
    const startCol = r === a.row ? a.col : 0
    const endCol = r === b.row ? b.col : row.length - 1
    let text = ''
    for (let c = startCol; c <= endCol; c++) text += row[c]?.char ?? ' '
    lines.push(text.replace(/\s+$/, ''))
  }
  return lines.join('\n')
}

function orderSelection(sel: NonNullable<SelectionRange>): [CursorPos, CursorPos] {
  const { start, end } = sel
  if (start.row < end.row || (start.row === end.row && start.col <= end.col)) return [start, end]
  return [end, start]
}

function renderSelection(
  sel: NonNullable<SelectionRange>,
  gridSize: { rows: number; cols: number },
  parser: AnsiParser,
  scrollOffset: number,
  metrics: { w: number; h: number }
) {
  const [a, b] = orderSelection(sel)
  const allCount = parser.scrollback.length + gridSize.rows
  const topRow = Math.max(0, allCount - gridSize.rows - scrollOffset)
  const rects: JSX.Element[] = []
  for (let r = a.row; r <= b.row; r++) {
    const viewRow = r - topRow
    if (viewRow < 0 || viewRow >= gridSize.rows) continue
    const startCol = r === a.row ? a.col : 0
    const endCol = r === b.row ? b.col : gridSize.cols - 1
    rects.push(
      <div key={r} style={{
        position: 'absolute',
        left: startCol * metrics.w,
        top: viewRow * metrics.h,
        width: (endCol - startCol + 1) * metrics.w,
        height: metrics.h,
        background: SELECTION_BG,
        pointerEvents: 'none'
      }} />
    )
  }
  return <>{rects}</>
}
