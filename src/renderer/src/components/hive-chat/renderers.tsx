import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes } from 'prism-react-renderer'
import { CRUSH, FONT_MONO, TOOL_COLORS, redact } from './crush-styles'
import type { TimelineEntry } from './types'

const DEFAULT_EXPANDED_LINES = 12
const LONG_ASSISTANT_THRESHOLD = 30

/** Map common file extensions to Prism language IDs. Falls back to "markup". */
export function langFromPath(path?: string): string {
  if (!path) return 'markup'
  const m = path.match(/\.([a-zA-Z0-9]+)$/)
  if (!m) return 'markup'
  const ext = m[1].toLowerCase()
  const map: Record<string, string> = {
    ts: 'tsx', tsx: 'tsx', js: 'jsx', jsx: 'jsx', mjs: 'jsx', cjs: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift', scala: 'scala',
    c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
    html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown',
    dockerfile: 'docker'
  }
  return map[ext] || 'markup'
}

/** Crush-palette syntax theme for prism-react-renderer. */
const CRUSH_PRISM_THEME = {
  plain: { color: CRUSH.Ash, backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: CRUSH.Oyster, fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: CRUSH.Zest } },
    { types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'], style: { color: CRUSH.Blush } },
    { types: ['selector', 'attr-name', 'string', 'char', 'inserted'], style: { color: CRUSH.Cumin } },
    { types: ['operator', 'entity', 'url'], style: { color: CRUSH.Salmon } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: CRUSH.Malibu } },
    { types: ['function', 'class-name'], style: { color: CRUSH.Guac } },
    { types: ['regex', 'important', 'variable'], style: { color: CRUSH.Zest } },
    { types: ['important', 'bold'], style: { fontWeight: 'bold' as const } },
    { types: ['italic'], style: { fontStyle: 'italic' as const } }
  ]
}

/** Crush-styled markdown renderer shared by user + assistant messages. */
const MD_COMPONENTS: Record<string, any> = {
  strong: ({ children }: any) => <strong style={{ color: CRUSH.Butter, fontWeight: 700 }}>{children}</strong>,
  em: ({ children }: any) => <em style={{ color: CRUSH.Ash, fontStyle: 'italic' }}>{children}</em>,
  code: ({ className, children }: any) => {
    const text = React.Children.toArray(children).map(String).join('')
    const isBlock = !!className || text.includes('\n')
    if (isBlock) {
      // Syntax-highlight the block using the className's "language-xxx" hint.
      const lang = className?.match(/language-(\S+)/)?.[1] || 'markup'
      const code = text.replace(/\n$/, '')
      return (
        <Highlight code={code} language={lang as any} theme={CRUSH_PRISM_THEME as any}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <code style={{ fontFamily: FONT_MONO, display: 'block' }}>
              {tokens.map((line, i) => {
                const { key: lineKey, ...lineRest } = getLineProps({ line })
                return (
                  <div key={i} {...lineRest}>
                    {line.map((token, j) => {
                      const { key: tokenKey, ...tokenRest } = getTokenProps({ token })
                      return <span key={j} {...tokenRest} />
                    })}
                  </div>
                )
              })}
            </code>
          )}
        </Highlight>
      )
    }
    return <code style={{ color: CRUSH.Bok, background: CRUSH.BBQ, padding: '0 4px', borderRadius: 3, fontFamily: FONT_MONO, fontSize: 12 }}>{children}</code>
  },
  pre: ({ children }: any) => (
    <pre style={{
      background: CRUSH.BBQ,
      borderLeft: `3px solid ${CRUSH.Charple}`,
      borderRadius: 4,
      padding: '8px 12px',
      fontSize: 12,
      overflow: 'auto',
      color: CRUSH.Ash,
      margin: '4px 0',
      fontFamily: FONT_MONO
    }}>{children}</pre>
  ),
  ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0' }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0' }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ color: CRUSH.Ash, marginBottom: 2 }}>{children}</li>,
  p: ({ children }: any) => <p style={{ margin: '4px 0', color: CRUSH.Ash }}>{children}</p>,
  a: ({ href, children }: any) => <a href={href} style={{ color: CRUSH.Malibu, textDecoration: 'underline' }}>{children}</a>,
  h1: ({ children }: any) => <h3 style={{ color: CRUSH.Butter, fontSize: 15, margin: '6px 0 4px' }}>{children}</h3>,
  h2: ({ children }: any) => <h4 style={{ color: CRUSH.Butter, fontSize: 14, margin: '6px 0 4px' }}>{children}</h4>,
  h3: ({ children }: any) => <h5 style={{ color: CRUSH.Butter, fontSize: 13, margin: '6px 0 4px' }}>{children}</h5>,
  blockquote: ({ children }: any) => <blockquote style={{ borderLeft: `2px solid ${CRUSH.Charple}`, paddingLeft: 10, margin: '4px 0', color: CRUSH.Squid }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${CRUSH.Charcoal}`, margin: '6px 0' }} />,
  table: ({ children }: any) => (
    <div style={{ margin: '8px 0', overflowX: 'auto' }}>
      <table style={{
        borderCollapse: 'collapse',
        fontFamily: FONT_MONO, fontSize: 12,
        border: `1px solid ${CRUSH.Charcoal}`,
        borderRadius: 4,
        overflow: 'hidden'
      }}>{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead style={{ background: CRUSH.BBQ }}>{children}</thead>,
  tbody: ({ children }: any) => <tbody>{children}</tbody>,
  tr: ({ children }: any) => <tr style={{ borderBottom: `1px solid ${CRUSH.Charcoal}` }}>{children}</tr>,
  th: ({ children }: any) => (
    <th style={{
      padding: '6px 12px',
      textAlign: 'left',
      color: CRUSH.Butter,
      fontWeight: 700,
      borderRight: `1px solid ${CRUSH.Charcoal}`,
      whiteSpace: 'nowrap'
    }}>{children}</th>
  ),
  td: ({ children }: any) => (
    <td style={{
      padding: '6px 12px',
      color: CRUSH.Ash,
      borderRight: `1px solid ${CRUSH.Charcoal}`,
      verticalAlign: 'top'
    }}>{children}</td>
  )
}

function CrushMarkdown({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{redact(text)}</ReactMarkdown>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  USER MESSAGE — rgba(107,80,255,0.08) bg + Charple left border
 *  (per ui-preview-crush-elements.html .input-area, approved alpha)
 * ──────────────────────────────────────────────────────────── */
export function UserMessage({ text }: { text: string }) {
  return (
    <div style={{
      background: 'rgba(255,96,255,0.08)',
      border: `1px solid ${CRUSH.Dolly}`,
      borderRadius: 8,
      padding: '8px 12px',
      margin: '6px 0',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color: CRUSH.Dolly, fontWeight: 700, fontSize: 16 }}>❯</span>
      <span style={{ color: CRUSH.Butter, fontWeight: 500, whiteSpace: 'pre-wrap', flex: 1 }}>{redact(text)}</span>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  ASSISTANT MESSAGE — Ash text. If the message ends with a
 *  numbered list (`1. … 2. … 3. …`), the list is split out and
 *  rendered as clickable options below the body. Clicks pipe the
 *  chosen text back as the next user message.
 * ──────────────────────────────────────────────────────────── */
export function AssistantMessage({ text, onChoose }: { text: string; onChoose?: (pick: string) => void }) {
  const parsed = extractTrailingChoices(text)
  if (!parsed) return <PlainAssistantText text={text} />
  return (
    <>
      <PlainAssistantText text={parsed.body} />
      {parsed.choices.length > 0 && (
        <div style={{ margin: '4px 0 10px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {parsed.choices.map(c => (
            <button
              key={c.num}
              onClick={() => onChoose?.(c.raw)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 12px',
                border: `1px solid ${CRUSH.Charcoal}`,
                borderRadius: 6,
                background: 'transparent',
                color: CRUSH.Ash,
                fontFamily: FONT_MONO, fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left' as const
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,96,255,0.1)'
                e.currentTarget.style.borderColor = CRUSH.Dolly
                e.currentTarget.style.color = CRUSH.Butter
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = CRUSH.Charcoal
                e.currentTarget.style.color = CRUSH.Ash
              }}
            >
              <span style={{ color: CRUSH.Dolly, fontWeight: 700, minWidth: 16 }}>{c.num}</span>
              <span style={{ flex: 1 }}><CrushMarkdown text={c.label} /></span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function PlainAssistantText({ text }: { text: string }) {
  return (
    <div style={{ color: CRUSH.Ash, margin: '6px 0', padding: '2px 0' }}>
      <CrushMarkdown text={text} />
    </div>
  )
}

export interface Choice { num: number; label: string; raw: string }

/** If the tail of a message is a run of `N. ...` lines, peel them off. */
export function extractTrailingChoices(text: string): { body: string; choices: Choice[] } | null {
  const lines = text.split('\n')
  const tail: Choice[] = []
  let i = lines.length - 1
  while (i >= 0) {
    const m = lines[i].match(/^\s*(\d+)\.\s+(.+)$/)
    if (!m) break
    tail.unshift({ num: Number(m[1]), label: m[2], raw: lines[i].trim() })
    i--
  }
  if (tail.length < 2) return null
  // Trim trailing blank lines off the body.
  while (i >= 0 && lines[i].trim() === '') i--
  return { body: lines.slice(0, i + 1).join('\n'), choices: tail }
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
  const isError = result?.isError
  return (
    <div style={{
      borderLeft: `3px solid ${isError ? CRUSH.Sriracha : CRUSH.Charple}`,
      paddingLeft: 12,
      paddingTop: 4,
      paddingBottom: 4,
      margin: '6px 0',
      fontFamily: FONT_MONO,
      background: isError ? 'rgba(235,66,104,0.06)' : 'transparent',
      borderRadius: isError ? 4 : 0
    }}>
      <ToolHeader name={name} input={input} />
      {result && <InlineResult content={result.content} isError={result.isError} tool={name} input={input} />}
    </div>
  )
}

function ToolHeader({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === 'TodoWrite') return <TodoInline input={input} />
  if (name === 'Bash') return <HeaderLine tool={name} color={CRUSH.Malibu} tail={String(input.command ?? '').replace(/\n/g, ' ').slice(0, 200)} tailStyle="ash" />
  if (name === 'Read' || name === 'View') return <HeaderLine tool="Read" color={CRUSH.Bok} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Edit') return <EditHeader input={input} />
  if (name === 'MultiEdit') return <MultiEditHeader input={input} />
  if (name === 'Write') return <HeaderLine tool="Write" color={CRUSH.Julep} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Grep' || name === 'Glob') {
    const pattern = String(input.pattern ?? input.query ?? '')
    const glob = String(input.glob ?? input.include ?? '')
    return <HeaderLine tool={name} color={CRUSH.Zest} tail={`"${pattern}"${glob ? ` ${glob}` : ''}`} tailStyle="ash" />
  }
  if (name === 'Task' || name === 'Agent') return <HeaderLine tool={name} color={CRUSH.Dolly} tail={argSummary(input)} tailStyle="ash" />
  if (name === 'WebFetch' || name === 'WebSearch') return <HeaderLine tool={name} color={CRUSH.Violet} tail={String(input.url ?? input.query ?? '')} tailStyle="link" />
  return <HeaderLine tool={name} color={toolColor(name)} tail={argSummary(input)} tailStyle="ash" />
}

/* Edit tool — header + side-by-side old/new diff from input.old_string / input.new_string */
function EditHeader({ input }: { input: Record<string, unknown> }) {
  const file = String(input.file_path ?? input.path ?? '')
  const oldStr = String(input.old_string ?? '')
  const newStr = String(input.new_string ?? '')
  return (
    <div>
      <HeaderLine tool="Edit" color={CRUSH.Julep} tail={file} tailStyle="link" />
      {(oldStr || newStr) && <DiffPanel oldStr={oldStr} newStr={newStr} />}
    </div>
  )
}

function MultiEditHeader({ input }: { input: Record<string, unknown> }) {
  const file = String(input.file_path ?? input.path ?? '')
  const edits = Array.isArray(input.edits) ? (input.edits as Array<{ old_string?: string; new_string?: string }>) : []
  return (
    <div>
      <HeaderLine tool="MultiEdit" color={CRUSH.Julep} tail={`${file} · ${edits.length} edit${edits.length === 1 ? '' : 's'}`} tailStyle="link" />
      {edits.map((e, i) => (
        <DiffPanel key={i} oldStr={String(e.old_string ?? '')} newStr={String(e.new_string ?? '')} />
      ))}
    </div>
  )
}

/** Simple side-by-side-ish diff: each line of old_string prefixed with -,
 * each of new_string with +. Lines that are identical in both stay neutral.
 * Left gutter shows 1-based row indices within the diff chunk (we don't
 * know the file-global line numbers — Claude's Edit input doesn't carry
 * them; would need to read the file to locate old_string). */
function DiffPanel({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  if (!oldStr && !newStr) return null
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  // Gutter width scales to the larger line count
  const maxLineNo = Math.max(oldLines.length, newLines.length)
  const gutterChars = String(maxLineNo).length
  const gutterStyle: React.CSSProperties = {
    display: 'inline-block',
    width: `${gutterChars + 1}ch`,
    flexShrink: 0,
    color: CRUSH.Oyster,
    textAlign: 'right',
    paddingRight: 8,
    userSelect: 'none'
  }

  return (
    <div style={{
      margin: '6px 0 2px',
      fontFamily: FONT_MONO, fontSize: 12,
      background: CRUSH.BBQ,
      borderRadius: 4,
      padding: '4px 0',
      overflow: 'auto'
    }}>
      {oldLines.map((ln, i) => {
        const unchanged = newSet.has(ln)
        return (
          <div key={`o${i}`} style={{
            display: 'flex', padding: '0 10px',
            background: unchanged ? 'transparent' : 'rgba(235,66,104,0.08)',
            color: unchanged ? CRUSH.Squid : CRUSH.Sriracha,
            whiteSpace: 'pre', lineHeight: 1.5
          }}>
            <span style={gutterStyle}>{i + 1}</span>
            <span style={{ width: 16, flexShrink: 0, color: unchanged ? CRUSH.Oyster : CRUSH.Sriracha }}>{unchanged ? ' ' : '-'}</span>
            <span>{redact(ln)}</span>
          </div>
        )
      })}
      {newLines.map((ln, i) => {
        if (oldSet.has(ln)) return null
        return (
          <div key={`n${i}`} style={{
            display: 'flex', padding: '0 10px',
            background: 'rgba(0,255,178,0.08)',
            color: CRUSH.Julep,
            whiteSpace: 'pre', lineHeight: 1.5
          }}>
            <span style={gutterStyle}>{i + 1}</span>
            <span style={{ width: 16, flexShrink: 0 }}>+</span>
            <span>{redact(ln)}</span>
          </div>
        )
      })}
    </div>
  )
}

function HeaderLine({ tool, color, tail, tailStyle }: { tool: string; color: string; tail: string; tailStyle: 'ash' | 'link' }) {
  // Keep the real path for reveal-in-Finder; only the shown string is redacted.
  const onClick = tailStyle === 'link' && tail && tail.startsWith('/')
    ? () => { window.api.fs.revealInFinder(tail) }
    : undefined
  const displayTail = redact(tail)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color, fontWeight: 700 }}>●</span>
      <span style={{ color, fontWeight: 700 }}>{tool}</span>
      <span
        onClick={onClick}
        title={onClick ? 'Click to reveal in Finder' : undefined}
        style={{
          color: tailStyle === 'link' ? CRUSH.Malibu : CRUSH.Ash,
          textDecoration: tailStyle === 'link' ? 'underline' : 'none',
          opacity: tailStyle === 'ash' ? 0.85 : 1,
          fontSize: 12,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
          cursor: onClick ? 'pointer' : 'default'
        }}
      >{displayTail}</span>
    </div>
  )
}

/** Strip Claude Code's "N\t" line-number prefixes that appear in Read
 *  tool results, returning the raw file content + start line number. */
export function stripReadPrefix(s: string): { content: string; startLine: number } {
  const lines = s.split('\n')
  let startLine = 1
  const stripped: string[] = []
  let anyPrefixed = false
  for (const ln of lines) {
    const m = ln.match(/^(\d+)\t(.*)$/)
    if (m) {
      anyPrefixed = true
      if (stripped.length === 0) startLine = parseInt(m[1], 10)
      stripped.push(m[2])
    } else {
      stripped.push(ln)
    }
  }
  return anyPrefixed
    ? { content: stripped.join('\n'), startLine }
    : { content: s, startLine: 1 }
}

function InlineResult({ content, isError, tool, input }: {
  content: string
  isError?: boolean
  tool?: string
  input?: Record<string, unknown>
}) {
  const [expanded, setExpanded] = useState(false)

  // Read results come prefixed with "N\t" per line. Render as a code
  // panel with a proper gutter so it reads like a file, not log output.
  if (tool === 'Read' || tool === 'View') {
    const { content: code, startLine } = stripReadPrefix(content)
    return <ReadResultPanel code={code} startLine={startLine} isError={isError} filePath={input?.file_path as string | undefined} />
  }

  const allLines = content.split('\n')
  // Collapse if either the line count OR the raw character length is large.
  // Bash results like `ps aux` often have only ~4 logical lines but each is
  // 400+ chars — they wrap visually and dominate the screen.
  const MAX_CHARS = 1200
  const byLines = allLines.length > DEFAULT_EXPANDED_LINES
  const byChars = content.length > MAX_CHARS
  const truncated = byLines || byChars
  let visibleContent: string
  let hidden = 0
  if (!truncated || expanded) {
    visibleContent = content
  } else if (byChars) {
    visibleContent = content.slice(0, MAX_CHARS)
    hidden = content.length - MAX_CHARS
  } else {
    visibleContent = allLines.slice(0, DEFAULT_EXPANDED_LINES).join('\n')
    hidden = allLines.length - DEFAULT_EXPANDED_LINES
  }
  const hiddenLabel = byLines && !byChars
    ? `${hidden} more lines`
    : `${hidden} more chars`
  return (
    <div style={{
      marginTop: 2,
      color: isError ? CRUSH.Sriracha : CRUSH.Squid,
      fontFamily: FONT_MONO,
      fontSize: 12,
      lineHeight: 1.5
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span>{isError ? '⚠' : '⎿'}</span>
        <div style={{ whiteSpace: 'pre-wrap', flex: 1, wordBreak: 'break-word' }}>
          {redact(visibleContent)}
          {truncated && !expanded && (
            <button onClick={() => setExpanded(true)} style={expandBtnStyle(CRUSH.Charple)}>
              ▾ Show {hiddenLabel}
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

/** BBQ-backed code panel for Read results: gutter with 1-based file line
 *  numbers (starts from startLine, supports Claude's offset= feature) +
 *  Prism syntax highlighting keyed off the file extension. */
function ReadResultPanel({ code, startLine, isError, filePath }: {
  code: string
  startLine: number
  isError?: boolean
  filePath?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const lines = code.split('\n')
  const truncated = lines.length > DEFAULT_EXPANDED_LINES
  const visible = expanded || !truncated ? lines : lines.slice(0, DEFAULT_EXPANDED_LINES)
  const hidden = lines.length - DEFAULT_EXPANDED_LINES
  const lastLineNo = startLine + visible.length - 1
  const gutterW = String(lastLineNo).length
  const language = langFromPath(filePath)
  const displayCode = redact(visible.join('\n'))

  return (
    <div style={{
      marginTop: 4,
      background: CRUSH.BBQ,
      border: `1px solid ${CRUSH.Charcoal}`,
      borderRadius: 4,
      padding: '6px 0',
      fontFamily: FONT_MONO, fontSize: 12,
      color: isError ? CRUSH.Sriracha : CRUSH.Ash,
      overflow: 'auto'
    }}>
      <Highlight code={displayCode} language={language as any} theme={CRUSH_PRISM_THEME as any}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <div>
            {tokens.map((line, i) => {
              const { key: lineKey, ...lineRest } = getLineProps({ line })
              return (
                <div key={i} {...lineRest} style={{ display: 'flex', lineHeight: 1.55, whiteSpace: 'pre' }}>
                  <span style={{
                    display: 'inline-block',
                    width: `${gutterW + 2}ch`,
                    flexShrink: 0,
                    color: CRUSH.Oyster,
                    textAlign: 'right',
                    paddingRight: 8,
                    paddingLeft: 6,
                    userSelect: 'none'
                  }}>{startLine + i}</span>
                  <span style={{ flex: 1, paddingRight: 10 }}>
                    {line.map((token, j) => {
                      const { key: tokenKey, ...tokenRest } = getTokenProps({ token })
                      return <span key={j} {...tokenRest} />
                    })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Highlight>
      {truncated && (
        <div style={{ padding: '4px 12px' }}>
          <button onClick={() => setExpanded(v => !v)} style={expandBtnStyle(CRUSH.Charple)}>
            {expanded ? '▴ Collapse' : `▾ Show ${hidden} more lines`}
          </button>
          {filePath && (
            <span style={{ color: CRUSH.Oyster, fontSize: 11, marginLeft: 12 }}>
              {redact(filePath.split('/').slice(-2).join('/'))} · {language}
            </span>
          )}
        </div>
      )}
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
      {redact(text)}
    </div>
  )
}

/* Render a whole timeline entry. tool_call entries consume their matching
 * tool_result from the map (keyed by toolUseId) and render as one combined
 * block — the Dolly left-border spans header + result. */
/** React.memo-wrapped row: skips re-render when entry / result / onChoose
 *  references are stable. Without this, typing in the input box re-renders
 *  every row (including any large Read panels) on every keystroke. */
export const TimelineRow = React.memo(function TimelineRow({ entry, result, onChoose }: {
  entry: TimelineEntry
  result?: { content: string; isError?: boolean }
  onChoose?: (pick: string) => void
}) {
  switch (entry.kind) {
    case 'user': return <UserMessage text={entry.text} />
    case 'assistant': return <AssistantMessage text={entry.text} onChoose={onChoose} />
    case 'tool_call':
      return <ToolBlock name={entry.name} input={entry.input} result={result} />
    case 'tool_result': return null
    case 'system': return <SystemLine text={entry.text} />
  }
}, (prev, next) => {
  if (prev.onChoose !== next.onChoose) return false
  if (prev.entry !== next.entry) return false
  // Result content stability — reference OR deep equal for the 2 fields.
  const pr = prev.result, nr = next.result
  if (pr === nr) return true
  if (!pr || !nr) return false
  return pr.content === nr.content && pr.isError === nr.isError
})
