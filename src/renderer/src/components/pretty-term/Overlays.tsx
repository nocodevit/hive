import React from 'react'
import { CURSOR, SELECTION_BG } from '../../lib/crush-theme'
import type { CursorPos, GridSize, Metrics, SelectionRange } from './geometry'
import { orderSelection } from './geometry'

const PADDING = 8

export function Cursor({ pos, focused, metrics }: {
  pos: CursorPos | null
  focused: boolean
  metrics: Metrics
}) {
  if (!pos) return null
  const common: React.CSSProperties = {
    position: 'absolute',
    left: PADDING + pos.col * metrics.w,
    top: PADDING + pos.row * metrics.h,
    width: metrics.w,
    height: metrics.h,
    pointerEvents: 'none'
  }
  if (focused) {
    return (
      <div style={{
        ...common,
        background: CURSOR,
        mixBlendMode: 'difference',
        animation: 'pretty-blink 1s step-end infinite'
      }} />
    )
  }
  return <div style={{ ...common, border: `1px solid ${CURSOR}` }} />
}

export function Selection({ selection, gridSize, scrollbackLength, totalRows, scrollOffset, metrics }: {
  selection: SelectionRange
  gridSize: GridSize
  scrollbackLength: number
  totalRows: number
  scrollOffset: number
  metrics: Metrics
}) {
  if (!selection) return null
  const [a, b] = orderSelection(selection)
  const topRow = Math.max(0, totalRows - gridSize.rows - scrollOffset)
  const rects: React.ReactElement[] = []
  for (let r = a.row; r <= b.row; r++) {
    const viewRow = r - topRow
    if (viewRow < 0 || viewRow >= gridSize.rows) continue
    const startCol = r === a.row ? a.col : 0
    const endCol = r === b.row ? b.col : gridSize.cols - 1
    rects.push(
      <div key={r} style={{
        position: 'absolute',
        left: PADDING + startCol * metrics.w,
        top: PADDING + viewRow * metrics.h,
        width: (endCol - startCol + 1) * metrics.w,
        height: metrics.h,
        background: SELECTION_BG,
        pointerEvents: 'none'
      }} />
    )
  }
  // Suppress unused var lint when scrollbackLength happens to be zero
  void scrollbackLength
  return <>{rects}</>
}

export function BlinkKeyframes() {
  return (
    <style>{`
      @keyframes pretty-blink { 50% { opacity: 0; } }
    `}</style>
  )
}
