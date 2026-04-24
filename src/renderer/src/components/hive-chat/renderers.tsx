import React, { useState } from 'react'
import { CRUSH, FONT_MONO, TOOL_COLORS } from './crush-styles'
import type { TimelineEntry } from './types'

const DEFAULT_EXPANDED_LINES = 12

/* ────────────────────────────────────────────────────────────
 *  USER MESSAGE — rgba(107,80,255,0.08) bg + Charple left border
 *  (per ui-preview-crush-elements.html .input-area, approved alpha)
 * ──────────────────────────────────────────────────────────── */
export function UserMessage({ text }: { text: string }) {
  return (
    <div style={{
      background: 'rgba(107,80,255,0.08)',
      border: `1px solid ${CRUSH.Charple}`,
      borderRadius: 8,
      padding: '8px 12px',
      margin: '6px 0',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color: CRUSH.Charple, fontWeight: 700, fontSize: 16 }}>❯</span>
      <span style={{ color: CRUSH.Butter, fontWeight: 500, whiteSpace: 'pre-wrap', flex: 1 }}>{text}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  ASSISTANT MESSAGE — Ash text on Pepper, no frame
 * ──────────────────────────────────────────────────────────── */
export function AssistantMessage({ text }: { text: string }) {
  return (
    <div style={{
      color: CRUSH.Ash,
      margin: '6px 0',
      padding: '2px 0',
      fontFamily: FONT_MONO,
      whiteSpace: 'pre-wrap',
      lineHeight: 1.55
    }}>
      {text}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  TOOL RESULT — ⎿ corner + Squid body
 * ──────────────────────────────────────────────────────────── */
export function ToolResult({ content, isError }: { content: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const allLines = content.split('\n')
  const truncated = allLines.length > DEFAULT_EXPANDED_LINES
  const visible = expanded || !truncated
    ? allLines
    : allLines.slice(0, DEFAULT_EXPANDED_LINES)
  const hiddenCount = allLines.length - DEFAULT_EXPANDED_LINES

  return (
    <div style={{
      padding: '2px 0 4px 14px',
      color: isError ? CRUSH.Sriracha : CRUSH.Squid,
      fontFamily: FONT_MONO,
      fontSize: 12,
      lineHeight: 1.5
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ color: CRUSH.Squid }}>⎿</span>
        <div style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
          {visible.join('\n')}
          {truncated && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                display: 'block', marginTop: 4,
                background: 'transparent', border: 'none',
                color: CRUSH.Charple, cursor: 'pointer',
                padding: 0, fontFamily: FONT_MONO, fontSize: 11,
                textDecoration: 'underline'
              }}
            >▾ Show {hiddenCount} more lines</button>
          )}
          {truncated && expanded && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                display: 'block', marginTop: 4,
                background: 'transparent', border: 'none',
                color: CRUSH.Squid, cursor: 'pointer',
                padding: 0, fontFamily: FONT_MONO, fontSize: 11,
                textDecoration: 'underline'
              }}
            >▴ Collapse</button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  TOOL BLOCK — tool_call header + (optional) matched tool_result
 *  wrapped in a single Dolly-bordered container so the bar spans both.
 * ──────────────────────────────────────────────────────────── */
export function ToolBlock({ name, input, result }: {
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  return (
    <div style={{
      borderLeft: `3px solid ${CRUSH.Dolly}`,
      paddingLeft: 12,
      paddingTop: 4,
      paddingBottom: 4,
      margin: '6px 0',
      fontFamily: FONT_MONO
    }}>
      <ToolHeader name={name} input={input} />
      {result && <InlineResult content={result.content} isError={result.isError} />}
    </div>
  )
}

function ToolHeader({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'TodoWrite') return <TodoInline input={input} />
  if (name === 'Bash') return <HeaderLine tool={name} color={CRUSH.Malibu} tail={String(input.command ?? '').replace(/\n/g, ' ').slice(0, 200)} tailStyle="ash" />
  if (name === 'Read' || name === 'View') return <HeaderLine tool="Read" color={CRUSH.Bok} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') return <HeaderLine tool={name} color={CRUSH.Julep} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Grep' || name === 'Glob') {
    const pattern = String(input.pattern ?? input.query ?? '')
    const glob = String(input.glob ?? input.include ?? '')
    return <HeaderLine tool={name} color={CRUSH.Zest} tail={`"${pattern}"${glob ? ` ${glob}` : ''}`} tailStyle="ash" />
  }
  if (name === 'Task' || name === 'Agent') return <HeaderLine tool={name} color={CRUSH.Dolly} tail={argSummary(input)} tailStyle="ash" />
  if (name === 'WebFetch' || name === 'WebSearch') return <HeaderLine tool={name} color={CRUSH.Violet} tail={String(input.url ?? input.query ?? '')} tailStyle="link" />
  return <HeaderLine tool={name} color={toolColor(name)} tail={argSummary(input)} tailStyle="ash" />
}

function HeaderLine({ tool, color, tail, tailStyle }: { tool: string; color: string; tail: string; tailStyle: 'ash' | 'link' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color, fontWeight: 700 }}>●</span>
      <span style={{ color, fontWeight: 700 }}>{tool}</span>
      <span style={{
        color: tailStyle === 'link' ? CRUSH.Malibu : CRUSH.Ash,
        textDecoration: tailStyle === 'link' ? 'underline' : 'none',
        opacity: tailStyle === 'ash' ? 0.85 : 1,
        fontSize: 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, minWidth: 0
      }}>{tail}</span>
    </div>
  )
}

function InlineResult({ content, isError }: { content: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const allLines = content.split('\n')
  const truncated = allLines.length > DEFAULT_EXPANDED_LINES
  const visible = expanded || !truncated ? allLines : allLines.slice(0, DEFAULT_EXPANDED_LINES)
  const hidden = allLines.length - DEFAULT_EXPANDED_LINES
  return (
    <div style={{
      marginTop: 2,
      color: isError ? CRUSH.Sriracha : CRUSH.Squid,
      fontFamily: FONT_MONO,
      fontSize: 12,
      lineHeight: 1.5
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span>⎿</span>
        <div style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
          {visible.join('\n')}
          {truncated && !expanded && (
            <button onClick={() => setExpanded(true)} style={expandBtnStyle(CRUSH.Charple)}>
              ▾ Show {hidden} more lines
            </button>
          )}
          {truncated && expanded && (
            <button onClick={() => setExpanded(false)} style={expandBtnStyle(CRUSH.Squid)}>
              ▴ Collapse
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function expandBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'block', marginTop: 4,
    background: 'transparent', border: 'none',
    color, cursor: 'pointer', padding: 0,
    fontFamily: FONT_MONO, fontSize: 11, textDecoration: 'underline'
  }
}

/* Back-compat export for places that still call <ToolCall> directly. */
export function ToolCall({ name, input }: { name: string; input: Record<string, unknown> }) {
  return <ToolBlock name={name} input={input} />
}

function toolColor(name: string) {
  return TOOL_COLORS[name] || CRUSH.Dolly
}

function argSummary(input: Record<string, unknown>): string {
  // Prefer common field names — command / file_path / pattern / path / url.
  const preferred = ['command', 'file_path', 'path', 'pattern', 'url', 'prompt', 'description']
  for (const k of preferred) {
    const v = input[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  try { return JSON.stringify(input).slice(0, 120) } catch { return '' }
}

/* TodoWrite — rendered inside a ToolBlock so the Dolly bar frames the whole group */
interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
function TodoInline({ input }: { input: Record<string, unknown> }) {
  const todos = (input.todos as Todo[]) || []
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>●</span>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>TodoWrite</span>
        <span style={{ color: CRUSH.Squid, fontSize: 11 }}>[{todos.length} items]</span>
      </div>
      {todos.map((todo, i) => {
        const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '•'
        const color = todo.status === 'completed' ? CRUSH.Julep : todo.status === 'in_progress' ? CRUSH.Dolly : CRUSH.Squid
        return (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '1px 0' }}>
            <span style={{ color, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{icon}</span>
            <span style={{
              color: todo.status === 'completed' ? CRUSH.Squid : CRUSH.Ash,
              textDecoration: todo.status === 'completed' ? 'line-through' : 'none'
            }}>{todo.content}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  SYSTEM — Squid dim line
 * ──────────────────────────────────────────────────────────── */
export function SystemLine({ text }: { text: string }) {
  return (
    <div style={{ color: CRUSH.Oyster, fontSize: 11, fontFamily: FONT_MONO, padding: '2px 0' }}>
      {text}
    </div>
  )
}

/* Render a whole timeline entry. tool_call entries consume their matching
 * tool_result from the map (keyed by toolUseId) and render as one combined
 * block — the Dolly left-border spans header + result. */
export function TimelineRow({ entry, resultsByToolUseId }: {
  entry: TimelineEntry
  resultsByToolUseId: Map<string, { content: string; isError?: boolean }>
}) {
  switch (entry.kind) {
    case 'user': return <UserMessage text={entry.text} />
    case 'assistant': return <AssistantMessage text={entry.text} />
    case 'tool_call': {
      const result = resultsByToolUseId.get(entry.toolUseId)
      return <ToolBlock name={entry.name} input={entry.input} result={result} />
    }
    case 'tool_result': return null // rendered inline inside the matching tool_call
    case 'system': return <SystemLine text={entry.text} />
  }
}
