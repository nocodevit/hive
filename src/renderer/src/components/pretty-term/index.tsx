import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TerminalCore } from '../../lib/terminal-core'
import { BG, FG, FONT_FAMILY, FONT_SIZE, LINE_HEIGHT } from '../../lib/crush-theme'
import { HelperTextarea, HelperTextareaHandle } from './HelperTextarea'
import { Viewport } from './Viewport'
import { BlinkKeyframes, Cursor, Selection } from './Overlays'
import {
  cursorViewPos,
  posFromEvent,
  selectionText,
  userInputRange,
  type CursorPos,
  type Metrics,
  type SelectionRange
} from './geometry'

interface Props {
  id: string
  visible: boolean
  /** Only the view the user is looking at drives pty.resize — prevents
   * xterm and PrettyTerm from fighting over the PTY size when both are
   * mounted simultaneously (e.g. Compare mode). */
  active?: boolean
}

const PADDING = 8

/**
 * Crush-flavored React terminal. State machine & buffer come from
 * `@xterm/headless`; this component does the DOM rendering, input handling,
 * selection, and Dolly-tinted user-input highlight on top.
 */
export default function PrettyTerm({ id, visible, active = true }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const textareaRef = useRef<HelperTextareaHandle>(null)

  const coreRef = useRef<TerminalCore | null>(null)
  const pendingRef = useRef<string>('')
  const rafRef = useRef<number | null>(null)

  const [tick, setTick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [charMetrics, setCharMetrics] = useState<Metrics | null>(null)
  const [gridSize, setGridSize] = useState<{ rows: number; cols: number }>({ rows: 24, cols: 80 })
  const [scrollOffset, setScrollOffset] = useState(0)
  const followBottom = useRef(true)
  const [selection, setSelection] = useState<SelectionRange>(null)
  const dragAnchor = useRef<CursorPos | null>(null)

  if (!coreRef.current) coreRef.current = new TerminalCore(gridSize.rows, gridSize.cols)

  // ── Character metrics ────────────────────────────────────────
  useLayoutEffect(() => {
    const measure = () => {
      const el = measureRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const w = rect.width / 10
      const h = rect.height
      if (w > 0 && h > 0) setCharMetrics({ w, h })
    }
    measure()
    if ((document as any).fonts?.ready) {
      (document as any).fonts.ready.then(measure)
    }
  }, [])

  // ── Auto-size grid from container pixels ─────────────────────
  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el || !charMetrics) return
    const compute = () => {
      const rect = el.getBoundingClientRect()
      const cols = Math.max(10, Math.floor((rect.width - PADDING * 2) / charMetrics.w))
      const rows = Math.max(3, Math.floor((rect.height - PADDING * 2) / charMetrics.h))
      if (rows !== gridSize.rows || cols !== gridSize.cols) {
        coreRef.current!.resize(rows, cols)
        setGridSize({ rows, cols })
        if (active) window.api.pty.resize(id, cols, rows)
      }
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [charMetrics, id, gridSize.rows, gridSize.cols, active])

  // ── PTY subscription with rAF batching ────────────────────────
  useEffect(() => {
    const flush = () => {
      rafRef.current = null
      if (!pendingRef.current) return
      const chunk = pendingRef.current
      pendingRef.current = ''
      coreRef.current!.feed(chunk, () => {
        setTick(t => t + 1)
        if (followBottom.current) setScrollOffset(0)
      })
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

  // ── Paste (text + file) ───────────────────────────────────────
  useEffect(() => {
    if (!focused || !visible) return
    const onPaste = (e: ClipboardEvent) => {
      const el = wrapRef.current
      const inside = el && (el.contains(document.activeElement) || el === document.activeElement)
      if (!inside) return
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
        window.api.pty.write(id, `\x1b[200~${text}\x1b[201~`)
      }
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [focused, visible, id])

  // ── Wheel → scrollback navigation ─────────────────────────────
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const core = coreRef.current!
      const delta = Math.round(e.deltaY / 20)
      if (delta === 0) return
      e.preventDefault()
      setScrollOffset(prev => {
        const next = Math.max(0, Math.min(core.scrollbackLength, prev + delta))
        followBottom.current = next === 0
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Derived view state ───────────────────────────────────────
  const core = coreRef.current!

  const viewRows = useMemo(() => {
    const total = core.totalRows
    const topRow = Math.max(0, total - gridSize.rows - scrollOffset)
    return core.getRows(topRow, topRow + gridSize.rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, gridSize.rows, gridSize.cols, scrollOffset])

  const inputRange = userInputRange(core, gridSize, scrollOffset)
  const cur = cursorViewPos(core, gridSize, scrollOffset)

  // ── Render ───────────────────────────────────────────────────
  return (
    <div
      ref={wrapRef}
      onMouseDown={e => {
        if (!charMetrics || !viewRef.current) return
        const p = posFromEvent(e, viewRef.current, gridSize, charMetrics, scrollOffset, core.totalRows)
        if (!p) return
        dragAnchor.current = p
        setSelection({ start: p, end: p })
        textareaRef.current?.focus()
      }}
      onMouseMove={e => {
        if (!dragAnchor.current || !charMetrics || !viewRef.current) return
        const p = posFromEvent(e, viewRef.current, gridSize, charMetrics, scrollOffset, core.totalRows)
        if (!p) return
        setSelection({ start: dragAnchor.current, end: p })
      }}
      onMouseUp={() => { dragAnchor.current = null }}
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
      <HelperTextarea
        ref={textareaRef}
        left={cur && charMetrics ? PADDING + cur.col * charMetrics.w : 0}
        top={cur && charMetrics ? PADDING + cur.row * charMetrics.h : 0}
        width={charMetrics?.w ?? 1}
        height={charMetrics?.h ?? 16}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyBytes={bytes => window.api.pty.write(id, bytes)}
        onTextInput={text => window.api.pty.write(id, text)}
        onCopyAttempt={() => {
          if (!selection) return false
          const text = selectionText(core, selection)
          if (!text) return false
          navigator.clipboard.writeText(text)
          return true
        }}
      />

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

      <div
        ref={viewRef}
        style={{
          position: 'absolute',
          inset: 0,
          padding: PADDING,
          overflow: 'hidden',
          whiteSpace: 'pre'
        }}
      >
        <Viewport rows={viewRows} inputRange={inputRange} charMetrics={charMetrics} />

        {charMetrics && <Cursor pos={cur} focused={focused} metrics={charMetrics} />}
        {charMetrics && (
          <Selection
            selection={selection}
            gridSize={gridSize}
            scrollbackLength={core.scrollbackLength}
            totalRows={core.totalRows}
            scrollOffset={scrollOffset}
            metrics={charMetrics}
          />
        )}
      </div>

      <BlinkKeyframes />
    </div>
  )
}
