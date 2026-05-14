export interface ContextRow { name: string; tokens: number; pct: number }
export interface ContextDetailRow { name: string; source?: string; server?: string; tokens: number }
export interface ContextSnapshot {
  model: string
  totalTokens: number
  totalLimit: number
  totalPct: number
  categories: ContextRow[]
  mcpTools: ContextDetailRow[]
  customAgents: ContextDetailRow[]
  memoryFiles: ContextDetailRow[]
  skills: ContextDetailRow[]
  scrapedAtMs: number
}

/**
 * Parse "9k" / "104.5k" / "685.4k" / "1.2m" / "159" → number of tokens.
 * The slash command emits human-rounded values; we accept m/M/k/K/raw.
 */
export function parseTokenStr(s: string): number {
  if (!s) return 0
  const m = s.trim().match(/^([\d.]+)\s*([kKmM]?)$/)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  return Math.round(unit === 'm' ? n * 1_000_000 : unit === 'k' ? n * 1_000 : n)
}

/** Parse "28%" / "0.0%" → number. */
export function parsePctStr(s: string): number {
  const m = (s || '').match(/([\d.]+)\s*%/)
  return m ? parseFloat(m[1]) : 0
}

/**
 * Pull rows out of a markdown table whose header is followed by a
 * separator row (`|---|---|...`). Skips `Tool|Server|Tokens` style and
 * generic `Category|Tokens|Percentage` style alike. Returns one
 * { cells: [...] } per row in source order.
 */
export function parseMarkdownTable(markdown: string): { headers: string[], rows: string[][] } | null {
  const lines = markdown.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'))
  if (lines.length < 3) return null
  const splitRow = (l: string) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const headers = splitRow(lines[0])
  if (!/^\|?\s*-+/.test(lines[1].replace(/\|/g, '|'))) {
    return null
  }
  const rows: string[][] = []
  for (let i = 2; i < lines.length; i++) rows.push(splitRow(lines[i]))
  return { headers, rows }
}

/**
 * Slice the markdown by `### Header` sections. Returns a map of
 * lowercased section name → markdown body (everything until next `###`).
 */
export function sliceMarkdownSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /^###\s+(.+)$/gm
  const matches: { name: string; idx: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ name: m[1].trim().toLowerCase(), idx: m.index })
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx
    const end = i + 1 < matches.length ? matches[i + 1].idx : markdown.length
    out[matches[i].name] = markdown.slice(start, end)
  }
  return out
}

/**
 * Convert the markdown produced by `/context` into a structured snapshot.
 * Sections we care about:
 *  - Estimated usage by category    (Category | Tokens | Percentage)
 *  - MCP Tools                       (Tool | Server | Tokens)
 *  - Custom Agents                   (Agent | Tokens) or similar
 *  - Memory Files                    (Path | Tokens)
 *  - Skills                          (Skill | Source | Tokens)
 */
export function parseContextMarkdown(markdown: string): Omit<ContextSnapshot, 'scrapedAtMs'> {
  const tokenMatch = markdown.match(/\*\*Tokens:\*\*\s*([\d.]+\s*[kKmM]?)\s*\/\s*([\d.]+\s*[kKmM]?)\s*\((\d+)%/)
  const totalTokens = tokenMatch ? parseTokenStr(tokenMatch[1]) : 0
  const totalLimit = tokenMatch ? parseTokenStr(tokenMatch[2]) : 0
  const totalPct = tokenMatch ? parseInt(tokenMatch[3], 10) : 0
  const modelMatch = markdown.match(/\*\*Model:\*\*\s*(\S+)/)
  const model = modelMatch ? modelMatch[1] : ''

  const sections = sliceMarkdownSections(markdown)

  const categories: ContextRow[] = []
  const catSec = sections['estimated usage by category'] || ''
  const catTab = parseMarkdownTable(catSec)
  if (catTab) {
    for (const r of catTab.rows) {
      if (r.length < 3) continue
      categories.push({ name: r[0], tokens: parseTokenStr(r[1]), pct: parsePctStr(r[2]) })
    }
  }

  const mcpTools: ContextDetailRow[] = []
  const mcpTab = parseMarkdownTable(sections['mcp tools'] || '')
  if (mcpTab) {
    for (const r of mcpTab.rows) {
      if (r.length < 3) continue
      mcpTools.push({ name: r[0], server: r[1], tokens: parseTokenStr(r[2]) })
    }
  }

  const customAgents: ContextDetailRow[] = []
  const agentTab = parseMarkdownTable(sections['custom agents'] || '')
  if (agentTab) {
    for (const r of agentTab.rows) {
      if (r.length < 2) continue
      customAgents.push({
        name: r[0],
        tokens: parseTokenStr(r[r.length - 1])
      })
    }
  }

  const memoryFiles: ContextDetailRow[] = []
  const memTab = parseMarkdownTable(sections['memory files'] || '')
  if (memTab) {
    for (const r of memTab.rows) {
      if (r.length < 2) continue
      memoryFiles.push({ name: r[0], tokens: parseTokenStr(r[r.length - 1]) })
    }
  }

  const skills: ContextDetailRow[] = []
  const skillTab = parseMarkdownTable(sections['skills'] || '')
  if (skillTab) {
    for (const r of skillTab.rows) {
      if (r.length < 3) continue
      skills.push({ name: r[0], source: r[1], tokens: parseTokenStr(r[2]) })
    }
  }

  return { model, totalTokens, totalLimit, totalPct, categories, mcpTools, customAgents, memoryFiles, skills }
}
