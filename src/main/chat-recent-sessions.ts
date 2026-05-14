import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface RecentSession {
  sid: string
  title: string
  preview: string
  lastActiveMs: number
  ctxPct: number
  totalTokens: number
}

export interface PrevSessionInfo {
  sid: string
  model: string
  contextSize: string  // "1M" | "200K" | "" (unknown)
  peakInputTokens: number
  lastActiveMs: number
}

/**
 * List the N most-recently-active sessions for a given cwd. Used by
 * the StartChooser's session picker (Resume / Compact+Resume / Fork
 * all let the user pick which historical session to act on instead of
 * always grabbing the newest).
 *
 * Each row pulls:
 *   - title    = first `last-prompt` event's lastPrompt (claude logs
 *                the user's message verbatim once per turn). Truncated.
 *   - preview  = last `assistant.message.content[].text` block. Trunc.
 *   - ctx %    = last assistant.usage iterations[-1] / inferred window
 *   - mtime    = file mtime (newest activity)
 *
 * Context window size: Claude's `~/.claude/projects/` JSONL doesn't
 * include the `[1m]` suffix, so we cross-reference Hive's own
 * `~/.hive/chat-logs` for a recent system/init with matching cwd. Same
 * trick `getPrevSessionInfo` uses.
 */
export function getRecentSessions(cwd: string, limit = 5): RecentSession[] {
  if (!cwd) return []
  try {
    const slug = cwd.replace(/\//g, '-')
    const dir = join(homedir(), '.claude', 'projects', slug)
    if (!existsSync(dir)) return []
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .slice(0, limit)

    // Resolve a context window size for this cwd from Hive logs (best-effort)
    let contextWindowTokens = 0
    try {
      const hiveLogs = join(homedir(), '.hive', 'chat-logs')
      if (existsSync(hiveLogs)) {
        const hiveFiles = readdirSync(hiveLogs)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ f, m: statSync(join(hiveLogs, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = readFileSync(join(hiveLogs, hf.f), 'utf8').split('\n').filter(Boolean)
          for (const line of txt) {
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'system' && ev.subtype === 'init' && ev.cwd === cwd && typeof ev.model === 'string') {
                const m = ev.model.match(/\[(\d+)([kKmM])\]/)
                if (m) {
                  const n = parseInt(m[1], 10)
                  contextWindowTokens = m[2].toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000
                  break outer
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // Fallback: assume 1M (current Opus/Sonnet 4.x default for this user)
    if (!contextWindowTokens) contextWindowTokens = 1_000_000

    return files.map(file => {
      const sid = file.f.replace(/\.jsonl$/, '')
      let title = ''
      let preview = ''
      let lastInputTokens = 0
      try {
        const lines = readFileSync(join(dir, file.f), 'utf8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const ev = JSON.parse(line)
            if (!title && ev.type === 'last-prompt' && typeof ev.lastPrompt === 'string') {
              const t = ev.lastPrompt.trim()
              if (t) title = t.length > 120 ? t.slice(0, 120) + '…' : t
            }
            if (ev.type === 'assistant') {
              const blocks = (ev.message?.content || []) as any[]
              for (const b of blocks) {
                if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
                  const t = b.text.trim()
                  preview = t.length > 160 ? t.slice(0, 160) + '…' : t
                }
              }
              const u = ev.message?.usage
              if (u) {
                const its = Array.isArray(u.iterations) ? u.iterations : []
                const last = its.length > 0 ? its[its.length - 1] : u
                const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0)
                if (total) lastInputTokens = total
              }
            }
          } catch {}
        }
      } catch {}
      const ctxPct = lastInputTokens > 0
        ? Math.round((lastInputTokens / contextWindowTokens) * 100)
        : 0
      return {
        sid,
        title: title || '(no title)',
        preview: preview || '(no preview)',
        lastActiveMs: file.m,
        ctxPct,
        totalTokens: lastInputTokens
      }
    })
  } catch {
    return []
  }
}

/**
 * Probe ~/.claude/projects/<slug> for the newest .jsonl, pull out sid,
 * last assistant model, peak iteration usage, and mtime. Used by the
 * StartChooser UI to preview the prior session before the user picks
 * a startup mode (Resume / Compact+Resume / Start new / Fork).
 *
 * contextSize is best-effort: ~/.claude/projects/ logs strip the `[1m]`
 * size suffix, so we cross-reference Hive's own ~/.hive/chat-logs for
 * the most recent system/init with a matching cwd to recover it.
 * Falls back to "" when unknowable; chooser then renders a token count
 * instead of a percentage.
 */
export function getPrevSessionInfo(cwd: string): PrevSessionInfo | null {
  if (!cwd) return null
  try {
    const slug = cwd.replace(/\//g, '-')
    const dir = join(homedir(), '.claude', 'projects', slug)
    if (!existsSync(dir)) return null
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (!files.length) return null
    const latest = files[0]
    const sid = latest.f.replace(/\.jsonl$/, '')

    // Walk forward but track the LAST observed usage, not the peak. After
    // /compact the session keeps writing to the same JSONL, so old
    // pre-compact entries still sit in the file with their (now stale)
    // high token counts. Using the latest assistant.usage matches what
    // the live chat would show on resume — i.e. post-compact ~12%, not
    // the 97% peak we hit before the compact.
    let model = ''
    let peakInputTokens = 0
    const lines = readFileSync(join(dir, latest.f), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'assistant') {
          const msg = ev.message || {}
          if (msg.model) model = msg.model
          const u = msg.usage
          if (u) {
            const its = Array.isArray(u.iterations) ? u.iterations : []
            const last = its.length > 0 ? its[its.length - 1] : u
            const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0)
            peakInputTokens = total  // last-write-wins, so loop end = newest
          }
        }
      } catch {}
    }

    let contextSize = ''
    try {
      const hiveLogs = join(homedir(), '.hive', 'chat-logs')
      if (existsSync(hiveLogs)) {
        const hiveFiles = readdirSync(hiveLogs)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ f, m: statSync(join(hiveLogs, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = readFileSync(join(hiveLogs, hf.f), 'utf8').split('\n').filter(Boolean)
          for (const line of txt) {
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'system' && ev.subtype === 'init' && ev.cwd === cwd && typeof ev.model === 'string') {
                const m = ev.model.match(/\[(\d+[kKmM])\]/)
                if (m) { contextSize = m[1].toUpperCase(); break outer }
              }
            } catch {}
          }
        }
      }
    } catch {}
    // claude 2.1.x dropped [1M] suffix from model strings in both stream-json
    // and hive chat-logs. Infer from model name when suffix lookup failed.
    if (!contextSize && model) {
      contextSize = /haiku/i.test(model) ? '200K' : '1M'
    }

    return { sid, model, contextSize, peakInputTokens, lastActiveMs: latest.m }
  } catch {
    return null
  }
}
