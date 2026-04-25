import { describe, it, expect } from 'vitest'

// Inline the parsing logic for testing (same as RichTerminal.tsx)
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9]*C/g, ' ')
    .replace(/\x1b\[[0-9;]*[A-BD-Z]/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[a-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '')
}

interface Block {
  type: string
  content: string
  toolName?: string
  toolArgs?: string
  language?: string
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let inCode = false, codeLang = '', codeLines: string[] = []
  let inTable = false, tableLines: string[] = []
  let inDiff = false, diffLines: string[] = []

  for (const raw of lines) {
    const line = stripAnsi(raw)
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('```')) {
      if (inCode) { blocks.push({ type: 'code', content: codeLines.join('\n'), language: codeLang }); inCode = false; codeLines = []; codeLang = '' }
      else { inCode = true; codeLang = trimmed.slice(3).trim() || 'text' }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    if (/[┌┐└┘├┤┬┴┼─│]/.test(trimmed)) {
      if (!inTable) inTable = true
      tableLines.push(trimmed)
      continue
    }
    if (inTable && !(/[┌┐└┘├┤┬┴┼─│]/.test(trimmed))) {
      blocks.push({ type: 'table', content: tableLines.join('\n') }); inTable = false; tableLines = []
    }

    if (/^[+-]\s/.test(trimmed) && !trimmed.startsWith('+++') && !trimmed.startsWith('---')) {
      if (!inDiff) inDiff = true; diffLines.push(trimmed); continue
    }
    if (inDiff && !/^[+-]\s/.test(trimmed)) {
      blocks.push({ type: 'diff', content: diffLines.join('\n') }); inDiff = false; diffLines = []
    }

    const toolMatch = trimmed.match(/^[●⏺]?\s*(Read|Edit|Write|Bash|Grep|Glob|Agent|WebSearch|WebFetch)\s*\((.+)\)$/i)
    if (toolMatch) { blocks.push({ type: 'tool-call', content: trimmed, toolName: toolMatch[1], toolArgs: toolMatch[2] }); continue }

    if (/Running|Synthesizing|Symbioting|still thinking/i.test(trimmed)) { blocks.push({ type: 'tool-status', content: trimmed }); continue }
    if (/^(Read|Listed|Searched|Found)\s+\d+\s+(file|director|match)/i.test(trimmed) || /ctrl\+o to expand/i.test(trimmed)) { blocks.push({ type: 'tool-result', content: trimmed }); continue }

    const toolMatch2 = trimmed.match(/^[●⏺]?\s*(Read|Edit|Write|Bash|Grep|Glob)\s+(.+)$/i)
    if (toolMatch2) { blocks.push({ type: 'tool-call', content: trimmed, toolName: toolMatch2[1], toolArgs: toolMatch2[2] }); continue }
    if (/5h:|7d:|tokens|thought for/i.test(trimmed) && /\d+%/.test(trimmed)) { blocks.push({ type: 'usage', content: trimmed }); continue }
    if (/You've (used|hit)|resets|weekly limit/i.test(trimmed)) { blocks.push({ type: 'limit-warning', content: trimmed }); continue }
    if (/^❯/.test(trimmed) || /accept edits/i.test(trimmed)) { blocks.push({ type: 'user-input', content: trimmed }); continue }

    blocks.push({ type: 'text', content: trimmed })
  }

  if (inCode && codeLines.length) blocks.push({ type: 'code', content: codeLines.join('\n'), language: codeLang })
  if (inTable && tableLines.length) blocks.push({ type: 'table', content: tableLines.join('\n') })
  if (inDiff && diffLines.length) blocks.push({ type: 'diff', content: diffLines.join('\n') })

  return blocks
}

describe('stripAnsi', () => {
  it('strips color codes', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[39m')).toBe('green')
  })
  it('strips 24-bit RGB', () => {
    expect(stripAnsi('\x1b[38;2;215;119;87mtext\x1b[39m')).toBe('text')
  })
  it('strips bold/dim', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m')).toBe('bold')
  })
  it('removes carriage return', () => {
    expect(stripAnsi('hello\rworld')).toBe('helloworld')
  })
  it('converts cursor forward to space', () => {
    expect(stripAnsi('hello\x1b[1Cworld')).toBe('hello world')
  })
  it('strips private mode sequences', () => {
    expect(stripAnsi('\x1b[?2026htext')).toBe('text')
  })
})

describe('parseBlocks', () => {
  it('identifies tool calls with parens', () => {
    const blocks = parseBlocks(['● Bash(npm run build)'])
    expect(blocks[0].type).toBe('tool-call')
    expect(blocks[0].toolName).toBe('Bash')
    expect(blocks[0].toolArgs).toBe('npm run build')
  })

  it('identifies tool calls without parens', () => {
    const blocks = parseBlocks(['● Read src/main/index.ts'])
    expect(blocks[0].type).toBe('tool-call')
    expect(blocks[0].toolName).toBe('Read')
    expect(blocks[0].toolArgs).toBe('src/main/index.ts')
  })

  it('identifies tool calls with ANSI', () => {
    const blocks = parseBlocks(['\x1b[1mBash\x1b[22m(git log --oneline)'])
    expect(blocks[0].type).toBe('tool-call')
    expect(blocks[0].toolName).toBe('Bash')
  })

  it('identifies tool status', () => {
    const blocks = parseBlocks(['  Running…'])
    expect(blocks[0].type).toBe('tool-status')
  })

  it('identifies Synthesizing', () => {
    const blocks = parseBlocks(['\x1b[38;2;215;119;87mSynthesizing… (10s)'])
    expect(blocks[0].type).toBe('tool-status')
  })

  it('identifies tool result summary', () => {
    const blocks = parseBlocks(['Read 1 file (ctrl+o to expand)'])
    expect(blocks[0].type).toBe('tool-result')
  })

  it('identifies code blocks', () => {
    const blocks = parseBlocks(['```typescript', 'const x = 1', '```'])
    expect(blocks[0].type).toBe('code')
    expect(blocks[0].language).toBe('typescript')
    expect(blocks[0].content).toBe('const x = 1')
  })

  it('identifies diff lines', () => {
    const blocks = parseBlocks(['+ added line', '- removed line', 'normal text'])
    expect(blocks[0].type).toBe('diff')
    expect(blocks[0].content).toContain('+ added')
    expect(blocks[0].content).toContain('- removed')
    expect(blocks[1].type).toBe('text')
  })

  it('identifies table with box-drawing', () => {
    const blocks = parseBlocks([
      '┌──────┬────────┐',
      '│ Name │ Status │',
      '├──────┼────────┤',
      '│ David│ done   │',
      '└──────┴────────┘',
      'normal text'
    ])
    expect(blocks[0].type).toBe('table')
    expect(blocks[1].type).toBe('text')
  })

  it('identifies user input with prompt', () => {
    const blocks = parseBlocks(['❯ fix the login page'])
    expect(blocks[0].type).toBe('user-input')
  })

  it('identifies usage bar', () => {
    const blocks = parseBlocks(['[Opus 4.7] 5h: ███░░░ 30% | 7d: 86%'])
    expect(blocks[0].type).toBe('usage')
  })

  it('identifies limit warning', () => {
    const blocks = parseBlocks(["You've used 87% of your weekly limit · resets 8am"])
    expect(blocks[0].type).toBe('limit-warning')
  })

  it('handles mixed content', () => {
    const blocks = parseBlocks([
      '❯ fix the bug',
      '⏺ Looking at the code',
      '● Read(src/app.tsx)',
      'Read 1 file (ctrl+o to expand)',
      '```ts',
      'const x = 1',
      '```',
      '+ added line',
      '- removed line',
      'Done!',
    ])
    expect(blocks[0].type).toBe('user-input')
    expect(blocks[1].type).toBe('text')
    expect(blocks[2].type).toBe('tool-call')
    expect(blocks[3].type).toBe('tool-result')
    expect(blocks[4].type).toBe('code')
    expect(blocks[5].type).toBe('diff')
    expect(blocks[6].type).toBe('text')
  })

  it('handles empty lines gracefully', () => {
    const blocks = parseBlocks(['', '  ', 'text', ''])
    expect(blocks.length).toBe(1)
    expect(blocks[0].content).toBe('text')
  })
})
