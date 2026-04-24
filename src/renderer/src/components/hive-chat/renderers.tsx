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
 *  GENERIC TOOL CALL — Charple left border, tool-colored ● and name
 *  For specific tools (TodoWrite, Bash, Edit) we branch into
 *  dedicated renderers below.
 * ──────────────────────────────────────────────────────────── */
export function ToolCall({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'TodoWrite') return <TodoCard input={input} />
  if (name === 'Bash') return <BashCard input={input} />
  if (name === 'Read' || name === 'View') return <ReadCard input={input} />
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') return <EditCard name={name} input={input} />
  if (name === 'Grep' || name === 'Glob') return <SearchCard name={name} input={input} />
  return <GenericToolCard name={name} input={input} />
}

function toolColor(name: string) {
  return TOOL_COLORS[name] || CRUSH.Charple
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

function GenericToolCard({ name, input }: { name: string; input: Record<string, unknown> }) {
  const color = toolColor(name)
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 10px',
      margin: '2px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color, fontWeight: 700 }}>●</span>
      <span style={{ color, fontWeight: 700 }}>{name}</span>
      <span style={{ color: CRUSH.Squid, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
        {argSummary(input)}
      </span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  Bash — command in Malibu, single line preview
 * ──────────────────────────────────────────────────────────── */
function BashCard({ input }: { input: Record<string, unknown> }) {
  const cmd = typeof input.command === 'string' ? input.command : ''
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', margin: '2px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color: CRUSH.Malibu, fontWeight: 700 }}>●</span>
      <span style={{ color: CRUSH.Malibu, fontWeight: 700 }}>Bash</span>
      <span style={{
        color: CRUSH.Ash, opacity: 0.85, fontSize: 12,
        fontFamily: FONT_MONO, whiteSpace: 'pre',
        overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0
      }}>{cmd.replace(/\n/g, ' ').slice(0, 200)}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  Read / View — Bok accent, file_path
 * ──────────────────────────────────────────────────────────── */
function ReadCard({ input }: { input: Record<string, unknown> }) {
  const file = (input.file_path || input.path || '') as string
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', margin: '2px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color: CRUSH.Bok, fontWeight: 700 }}>●</span>
      <span style={{ color: CRUSH.Bok, fontWeight: 700 }}>Read</span>
      <span style={{ color: CRUSH.Malibu, textDecoration: 'underline', fontSize: 12 }}>{file}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  Edit / Write / MultiEdit — Julep accent
 * ──────────────────────────────────────────────────────────── */
function EditCard({ name, input }: { name: string; input: Record<string, unknown> }) {
  const file = (input.file_path || input.path || '') as string
  const color = CRUSH.Julep
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', margin: '2px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color, fontWeight: 700 }}>●</span>
      <span style={{ color, fontWeight: 700 }}>{name}</span>
      <span style={{ color: CRUSH.Malibu, textDecoration: 'underline', fontSize: 12 }}>{file}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  Grep / Glob — Zest accent, pattern text
 * ──────────────────────────────────────────────────────────── */
function SearchCard({ name, input }: { name: string; input: Record<string, unknown> }) {
  const pattern = (input.pattern || input.query || '') as string
  const glob = (input.glob || input.include || '') as string
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px', margin: '2px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color: CRUSH.Zest, fontWeight: 700 }}>●</span>
      <span style={{ color: CRUSH.Zest, fontWeight: 700 }}>{name}</span>
      <span style={{ color: CRUSH.Ash, opacity: 0.85, fontSize: 12 }}>
        "{pattern}"{glob ? ` ${glob}` : ''}
      </span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  TodoWrite — ✓/→/• per status
 * ──────────────────────────────────────────────────────────── */
interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
function TodoCard({ input }: { input: Record<string, unknown> }) {
  const todos = (input.todos as Todo[]) || []
  return (
    <div style={{
      padding: '6px 10px',
      margin: '4px 0',
      borderLeft: `3px solid ${CRUSH.Charple}`,
      fontFamily: FONT_MONO,
      background: CRUSH.Pepper
    }}>
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

/* Render a whole timeline entry */
export function TimelineRow({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case 'user': return <UserMessage text={entry.text} />
    case 'assistant': return <AssistantMessage text={entry.text} />
    case 'tool_call': return <ToolCall name={entry.name} input={entry.input} />
    case 'tool_result': return <ToolResult content={entry.content} isError={entry.isError} />
    case 'system': return <SystemLine text={entry.text} />
  }
}
