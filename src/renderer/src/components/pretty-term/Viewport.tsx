import React from 'react'
import type { Cell } from '../../lib/terminal-core'
import { buildSegments, styleFromKey } from '../../lib/cell-render'
import {
  LINE_HEIGHT,
  PROMPT,
  USER_INPUT_BG,
  USER_INPUT_BORDER,
  USER_INPUT_FG
} from '../../lib/crush-theme'

interface Props {
  rows: Cell[][]
  inputRange: { row: number; startCol: number; endCol: number } | null
  charMetrics: { w: number; h: number } | null
}

/**
 * Render the viewport grid. For each row:
 *   - group cells into same-style runs (`buildSegments`)
 *   - paint the Dolly-tinted user-input background underneath the input row
 *   - recolor any ❯ char to Julep green + bold
 *
 * Continuation cells of wide glyphs are already dropped by `buildSegments`,
 * so the inline runs render at their natural monospace width.
 */
export function Viewport({ rows, inputRange, charMetrics }: Props) {
  return (
    <>
      {rows.map((row, r) => {
        const segments = buildSegments(row)
        const isInputRow = inputRange && r === inputRange.row
        return (
          <div key={r} style={{ position: 'relative', height: `${LINE_HEIGHT}em`, lineHeight: `${LINE_HEIGHT}em` }}>
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
              if (isInputRow && inputRange &&
                  seg.startCol >= inputRange.startCol && seg.startCol < inputRange.endCol) {
                style.color = USER_INPUT_FG
              }
              if (seg.text.includes('❯')) {
                const parts = seg.text.split(/(❯)/)
                return (
                  <span key={i}>
                    {parts.map((p, j) => p === '❯'
                      ? <span key={j} style={{ ...style, color: PROMPT, fontWeight: 700 }}>{p}</span>
                      : <span key={j} style={style}>{p}</span>)}
                  </span>
                )
              }
              return <span key={i} style={style}>{seg.text}</span>
            })}
          </div>
        )
      })}
    </>
  )
}
