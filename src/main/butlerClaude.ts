// One-shot `claude -p` in the Butler folder for the routines, mail and
// answer-for-me. Always a fresh session (never the Butler chat's), prompt on
// stdin, dontAsk: only the Butler allow-list runs (so `./hive agents`, `tail`
// and the read tools work; any other shell command is refused). The input
// carries untrusted email and chat text, so these stay off on top: writing
// files, the web (no sending data out), and `./hive send` / `./hive start`,
// which would hand a stranger's words to an agent to act on.

import { spawn as nodeSpawn } from 'child_process'

export const ROUTINE_CLAUDE_TIMEOUT_MS = 5 * 60_000
export const DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(./hive send:*)', 'Bash(./hive start:*)']

export function claudePrintArgs(allowedTools: string[] = []): string[] {
  return [
    '-p', '--output-format', 'text', '--permission-mode', 'dontAsk',
    '--disallowedTools', DISALLOWED_TOOLS.join(','),
    ...(allowedTools.length ? ['--allowedTools', allowedTools.join(',')] : [])
  ]
}

export interface ClaudeRunDeps {
  bin: () => string
  cwd: () => string
  env?: NodeJS.ProcessEnv
  spawn?: typeof nodeSpawn
  timeoutMs?: number
}

export function createClaudeRunner(deps: ClaudeRunDeps) {
  const spawn = deps.spawn ?? nodeSpawn
  return (prompt: string, opts: { allowedTools?: string[] } = {}): Promise<string> => new Promise((resolve, reject) => {
    const child = spawn(deps.bin(), claudePrintArgs(opts.allowedTools), { cwd: deps.cwd(), env: deps.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('claude timed out')) }, deps.timeoutMs ?? ROUTINE_CLAUDE_TIMEOUT_MS)
    child.stdout?.on('data', d => { out += d })
    child.stderr?.on('data', d => { err += d })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out.trim())
      else reject(new Error((err || out).trim().slice(-500) || `claude exited ${code}`))
    })
    child.stdin?.end(prompt)
  })
}
