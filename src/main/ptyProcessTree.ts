// Answers "is there a live `claude` agent session running inside this PTY?"
// by walking the process tree rooted at the PTY's login-shell pid. We scope to
// descendants of that specific shell (not a global pgrep) so we never confuse
// one terminal's claude with another's — or with the Claude *Desktop* app's
// helper processes, whose command lines also contain "Claude".
//
// Both functions are pure (string/array in, value out) so they're unit-tested
// without spawning anything. The IPC handler in index.ts shells out to `ps`
// and feeds the stdout here.

export interface PsRow {
  pid: number
  ppid: number
  command: string
}

// Parse the output of `ps -Ao pid=,ppid=,command=` (macOS). Each line is
// "<pid> <ppid> <full command line>". Lines that don't match are skipped.
export function parsePsRows(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/)
    if (!m) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] })
  }
  return rows
}

// Matches the claude CLI executable token: lowercase `claude` or `claude.exe`
// at a path/word boundary. Case-sensitive on purpose — the Claude Desktop app
// renders as capital-C "Claude" (e.g. /Applications/Claude.app/.../MacOS/Claude
// or --productName=Claude), so a lowercase match plus pid-scoping excludes it.
const CLAUDE_CLI_RE = /(?:^|\/)claude(?:\.exe)?(?:\s|$)/

export function commandIsClaudeCli(command: string): boolean {
  return CLAUDE_CLI_RE.test(command)
}

// BFS the descendants of rootPid; true if any runs the claude CLI.
export function hasClaudeDescendant(rows: PsRow[], rootPid: number): boolean {
  const childrenByPpid = new Map<number, PsRow[]>()
  for (const r of rows) {
    const arr = childrenByPpid.get(r.ppid)
    if (arr) arr.push(r)
    else childrenByPpid.set(r.ppid, [r])
  }
  const queue: PsRow[] = [...(childrenByPpid.get(rootPid) || [])]
  const seen = new Set<number>()
  while (queue.length) {
    const cur = queue.shift()!
    if (seen.has(cur.pid)) continue
    seen.add(cur.pid)
    if (commandIsClaudeCli(cur.command)) return true
    const kids = childrenByPpid.get(cur.pid)
    if (kids) queue.push(...kids)
  }
  return false
}
