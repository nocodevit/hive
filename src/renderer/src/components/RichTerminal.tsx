// Rich mode terminal overlay — parses ANSI PTY output into structured React components
import { useState, useEffect, useRef } from 'react'

interface Block {
  type: 'text' | 'tool-call' | 'tool-status' | 'tool-result' | 'code' | 'diff' | 'table' | 'user-input' | 'usage' | 'limit-warning'
  content: string
  toolName?: string
  toolArgs?: string
  language?: string
  collapsed?: boolean
}

// Strip ANSI escape sequences, preserve spaces
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')     // private mode sequences (?2026h etc)
    .replace(/\x1b\[[0-9]*C/g, ' ')               // cursor forward → space
    .replace(/\x1b\[[0-9;]*[A-BD-Z]/g, '')        // other cursor movement (up/down/etc)
    .replace(/\x1b\[[0-9;]*m/g, '')                // color/style
    .replace(/\x1b\[[0-9;]*[a-z]/g, '')            // remaining CSI
    .replace(/\x1b\][^\x07]*\x07/g, '')            // OSC sequences
    .replace(/\r/g, '')
}

// Parse raw terminal output into structured blocks
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let inTable = false
  let tableLines: string[] = []
  let inDiff = false
  let diffLines: string[] = []

  for (const raw of lines) {
    const line = stripAnsi(raw)
    const trimmed = line.trim()
    if (!trimmed) continue
    // Filter out compacting animation / progress symbols / in-place update noise
    if (/^[✳✢·⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(trimmed)) continue
    if (/^\[?\?2026/.test(trimmed)) continue
    // Filter streaming progress lines (Synthesizing/Running/Compacting with changing tokens/time)
    if (/^(Synthesizing|Symbioting|Compacting|Running)\s*[…·]/i.test(trimmed)) continue
    if (/^\d+\s*tokens?\s*·\s*thought/i.test(trimmed)) continue
    if (/^(still thinking|thinking)\s*[.)]/i.test(trimmed)) continue

    // Code block detection
    if (trimmed.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', content: codeLines.join('\n'), language: codeLang })
        inCode = false; codeLines = []; codeLang = ''
      } else {
        inCode = true
        codeLang = trimmed.slice(3).trim() || 'text'
      }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    // Table detection (box-drawing characters)
    if (/[┌┐└┘├┤┬┴┼─│]/.test(trimmed)) {
      if (!inTable) inTable = true
      tableLines.push(trimmed)
      continue
    }
    if (inTable && !(/[┌┐└┘├┤┬┴┼─│]/.test(trimmed))) {
      blocks.push({ type: 'table', content: tableLines.join('\n') })
      inTable = false; tableLines = []
    }

    // Diff detection
    if (/^[+-]\s/.test(trimmed) && !trimmed.startsWith('+++') && !trimmed.startsWith('---')) {
      if (!inDiff) inDiff = true
      diffLines.push(trimmed)
      continue
    }
    if (inDiff && !/^[+-]\s/.test(trimmed)) {
      blocks.push({ type: 'diff', content: diffLines.join('\n') })
      inDiff = false; diffLines = []
    }

    // Tool call: Bold tool name + (args) — e.g. "Bash(npm run build)"
    const toolMatch = trimmed.match(/^[●⏺]?\s*(Read|Edit|Write|Bash|Grep|Glob|Agent|WebSearch|WebFetch)\s*\((.+)\)$/i)
    if (toolMatch) {
      blocks.push({ type: 'tool-call', content: trimmed, toolName: toolMatch[1], toolArgs: toolMatch[2], collapsed: true })
      continue
    }

    // Tool status: only show if it contains final result info (time/tokens), skip raw progress
    if (/Running|Synthesizing|Symbioting|still thinking/i.test(trimmed)) {
      // Only keep if it has final stats like "(10s · 331 tokens · thought for 3s)"
      if (/\d+s\s*·\s*\d+/.test(trimmed) || /tokens/.test(trimmed)) {
        blocks.push({ type: 'tool-status', content: trimmed })
      }
      continue
    }

    // Tool result summary: "Read 1 file" / "Listed 1 directory" / "18 matches" — check BEFORE tool-call-without-parens
    if (/^(Read|Listed|Searched|Found)\s+\d+\s+(file|director|match|pattern)/i.test(trimmed) ||
        /ctrl\+o to expand/i.test(trimmed)) {
      blocks.push({ type: 'tool-result', content: trimmed })
      continue
    }

    // Tool call without parens: "Read src/file.ts" or "Bash npm run build"
    const toolMatch2 = trimmed.match(/^[●⏺]?\s*(Read|Edit|Write|Bash|Grep|Glob)\s+(.+)$/i)
    if (toolMatch2) {
      blocks.push({ type: 'tool-call', content: trimmed, toolName: toolMatch2[1], toolArgs: toolMatch2[2], collapsed: true })
      continue
    }

    // Usage bar: "[Opus 4.7] 5h: ███░░ 30% | 7d: 86%"
    if (/5h:|7d:|tokens|thought for/i.test(trimmed) && /\d+%/.test(trimmed)) {
      blocks.push({ type: 'usage', content: trimmed })
      continue
    }

    // Limit warning: "You've used 87%..."
    if (/You've (used|hit)|resets|weekly limit/i.test(trimmed)) {
      blocks.push({ type: 'limit-warning', content: trimmed })
      continue
    }

    // User input: lines with reverse video or prompt ❯
    if (/^❯/.test(trimmed) || /accept edits/i.test(trimmed)) {
      blocks.push({ type: 'user-input', content: trimmed })
      continue
    }

    // Plain text
    blocks.push({ type: 'text', content: trimmed })
  }

  // Flush remaining
  if (inCode && codeLines.length) blocks.push({ type: 'code', content: codeLines.join('\n'), language: codeLang })
  if (inTable && tableLines.length) blocks.push({ type: 'table', content: tableLines.join('\n') })
  if (inDiff && diffLines.length) blocks.push({ type: 'diff', content: diffLines.join('\n') })

  return blocks
}

// Parse box-drawing table into rows/cols
function parseTable(content: string): string[][] {
  const lines = content.split('\n').filter(l => l.includes('│') && !l.match(/^[┌├└]/))
  return lines.map(l => l.split('│').map(c => c.trim()).filter(Boolean))
}

// File path detection
function renderWithLinks(text: string, onFileClick?: (path: string) => void): JSX.Element {
  const filePattern = /([\w./\-]+\.(tsx?|jsx?|css|json|md|py|go|rs|vue|svelte|html|sh|yaml|yml|toml|sql|prisma))/g
  const parts = text.split(filePattern)
  return (
    <span>
      {parts.map((part, i) =>
        filePattern.test(part) ? (
          <span key={i} className="text-blue-400 underline cursor-pointer hover:text-blue-300"
            onClick={() => onFileClick?.(part)}>{part}</span>
        ) : <span key={i}>{part}</span>
      )}
    </span>
  )
}

interface Props {
  lines: string[]
  visible: boolean
}

export default function RichTerminal({ lines, visible }: Props) {
  const blocks = parseBlocks(lines)
  const [collapsedSet, setCollapsedSet] = useState<Set<number>>(new Set())
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [blocks.length])

  const toggleCollapse = (idx: number) => {
    setCollapsedSet(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  if (!visible) return null

  return (
    <div className="h-full overflow-y-auto p-4 space-y-1 font-mono text-[13px]" style={{ background: '#201F26', color: '#DFDBDD' }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'tool-call': {
            const isCollapsed = !collapsedSet.has(i)
            const toolColors: Record<string, string> = {
              Read: '#68FFD6', Edit: '#00FFB2', Write: '#00FFB2',
              Bash: '#00A4FF', Grep: '#E8FE96', Glob: '#E8FE96',
              Agent: '#FF60FF', WebSearch: '#4FBEFE', WebFetch: '#4FBEFE'
            }
            const color = toolColors[block.toolName || ''] || '#FF60FF'
            return (
              <div key={i} className="rounded-lg overflow-hidden" style={{ borderLeft: `3px solid ${color}` }}>
                <button onClick={() => toggleCollapse(i)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-white/5 transition-colors cursor-pointer">
                  <span style={{ color }} className="text-xs">{isCollapsed ? '▸' : '▾'}</span>
                  <span style={{ color }} className="font-bold">{block.toolName}</span>
                  <span className="text-[#858392] truncate text-[12px]">{block.toolArgs}</span>
                </button>
                {!isCollapsed && (
                  <div className="px-3 py-2 text-[12px]" style={{ background: '#2D2C35' }}>
                    {renderWithLinks(block.content)}
                  </div>
                )}
              </div>
            )
          }
          case 'tool-status':
            return (
              <div key={i} className="px-3 py-1 text-[12px] flex items-center gap-2" style={{ color: '#858392' }}>
                <span className="animate-pulse">⟳</span>
                <span>{block.content}</span>
              </div>
            )
          case 'tool-result':
            return (
              <div key={i} className="px-3 py-1 text-[12px]" style={{ color: '#858392' }}>
                {block.content}
              </div>
            )
          case 'code':
            return (
              <div key={i} className="rounded-lg overflow-hidden my-1">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider flex justify-between items-center" style={{ background: '#3A3943', color: '#858392' }}>
                  <span>{block.language}</span>
                  <button onClick={() => navigator.clipboard.writeText(block.content)}
                    className="hover:text-white cursor-pointer text-[10px]">Copy</button>
                </div>
                <pre className="px-3 py-2 overflow-x-auto text-[12px] whitespace-pre-wrap" style={{ background: '#2D2C35' }}>
                  {block.content}
                </pre>
              </div>
            )
          case 'diff':
            return (
              <div key={i} className="rounded-lg overflow-hidden my-1 text-[12px]" style={{ background: '#2D2C35' }}>
                {block.content.split('\n').map((line, j) => (
                  <div key={j} className="px-3 py-0.5" style={{
                    background: line.startsWith('+') ? 'rgba(0,255,178,0.08)' : line.startsWith('-') ? 'rgba(235,66,104,0.08)' : 'transparent',
                    color: line.startsWith('+') ? '#00FFB2' : line.startsWith('-') ? '#EB4268' : '#DFDBDD'
                  }}>{line}</div>
                ))}
              </div>
            )
          case 'table': {
            const rows = parseTable(block.content)
            if (rows.length === 0) return <pre key={i} className="text-[12px] px-3">{block.content}</pre>
            return (
              <div key={i} className="rounded-lg overflow-hidden my-1">
                <table className="w-full text-[12px]" style={{ background: '#2D2C35' }}>
                  <tbody>
                    {rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'font-bold' : ''} style={{ borderBottom: '1px solid #3A3943' }}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5">{renderWithLinks(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          case 'user-input':
            return (
              <div key={i} className="px-3 py-1.5 rounded-md my-1" style={{ background: 'rgba(107,80,255,0.12)', borderBottom: '1px solid rgba(107,80,255,0.3)' }}>
                <span style={{ color: '#6B50FF', fontWeight: 700 }}>❯ </span>
                <span style={{ color: '#FFFAF1' }}>{block.content.replace(/^❯\s*/, '')}</span>
              </div>
            )
          case 'usage':
            return (
              <div key={i} className="px-3 py-1 text-[11px]" style={{ color: '#605F6B' }}>
                {block.content}
              </div>
            )
          case 'limit-warning':
            return (
              <div key={i} className="px-3 py-1.5 rounded-md my-1" style={{ background: 'rgba(235,66,104,0.1)', color: '#EB4268' }}>
                ⚠ {block.content}
              </div>
            )
          default:
            return (
              <div key={i} className="px-1 py-0.5">
                {renderWithLinks(block.content)}
              </div>
            )
        }
      })}
      <div ref={endRef} />
    </div>
  )
}
