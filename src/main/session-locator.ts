// Cross-bucket session recovery.
//
// Claude Code stores every session at ~/.claude/projects/<slug>/<sid>.jsonl
// where <slug> is the cwd claude was launched from with `/` → `-`. Hive
// reconstructs that slug from an agent's worktreePath at resume time. But a
// coding agent's FIRST session can be created with cwd = the MAIN repo (the
// window in App.tsx before its git worktree exists / when worktreeAdd hasn't
// set cwd yet). The session then lands in the main-repo bucket, NOT the
// worktree bucket. On resume Hive looks in the (empty) worktree bucket,
// finds nothing, falls back to `claude -c`, and claude reports
// "No conversation found".
//
// Proven on a project we run internally: worktreePath = …/<project>-<agent>, but the
// session's records all record cwd = …/<project>. Other project agents never
// hit it (their sessions' cwd == worktreePath), which is exactly why their
// resume always worked.
//
// These helpers recover the link: agent → its newest Hive chat-log → latest
// claude session_id → the bucket actually holding it → the cwd that bucket
// ran under (so resume can spawn claude in the RIGHT place). All file-system
// roots are parameters so the logic is unit-testable against temp dirs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Last claude `session_id` recorded in a Hive chat-log's JSONL lines.
 * Hive stamps the id on system/init and (nested) stream events; we take the
 * most recent so a resumed/forked agent points at its CURRENT session.
 * Returns null when no line carries a session_id.
 */
export function latestSessionIdFromHiveLog(lines: string[]): string | null {
  let sid: string | null = null
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    try {
      const ev = JSON.parse(t)
      const s = ev?.session_id ?? ev?.event?.session_id
      if (typeof s === 'string' && s) sid = s
    } catch {
      /* tolerate partial/corrupt lines */
    }
  }
  return sid
}

/**
 * The cwd a Claude Code session ran under, read from its own JSONL. Every
 * real record carries `cwd`; the first meta line may omit it, so we scan for
 * the first absolute path. This is the AUTHORITATIVE cwd — never un-slug a
 * bucket dir name (the `/`→`-` mapping is lossy and can't be reversed).
 */
export function recordedCwdFromSession(lines: string[]): string | null {
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    try {
      const c = JSON.parse(t)?.cwd
      if (typeof c === 'string' && c.startsWith('/')) return c
    } catch {
      /* tolerate partial/corrupt lines */
    }
  }
  return null
}

/**
 * Find which ~/.claude/projects/<bucket> directory holds <sid>.jsonl, and
 * the cwd + file path of that session. Scans buckets directly by file
 * existence so it never depends on reproducing claude's slug escaping.
 */
export function locateSessionBucket(
  projectsDir: string,
  sid: string
): { dir: string; cwd: string; file: string } | null {
  if (!sid || !existsSync(projectsDir)) return null
  let buckets: string[]
  try {
    buckets = readdirSync(projectsDir)
  } catch {
    return null
  }
  for (const bucket of buckets) {
    const file = join(projectsDir, bucket, `${sid}.jsonl`)
    if (!existsSync(file)) continue
    let cwd: string | null = null
    try {
      cwd = recordedCwdFromSession(readFileSync(file, 'utf8').split('\n'))
    } catch {
      /* unreadable — keep looking */
    }
    if (cwd) return { dir: join(projectsDir, bucket), cwd, file }
  }
  return null
}

/**
 * Newest Hive chat-log path for a chat id. HiveChat's id is `chat-<agentId>`,
 * which is exactly the chat-log filename prefix (`chat-<agentId>-<ts>.jsonl`),
 * so we match by that prefix and pick the most recently modified.
 */
export function newestHiveLogForChat(hiveLogsDir: string, chatId: string): string | null {
  if (!chatId || !existsSync(hiveLogsDir)) return null
  let files: string[]
  try {
    files = readdirSync(hiveLogsDir)
  } catch {
    return null
  }
  const matches = files
    .filter((f) => f.startsWith(`${chatId}-`) && f.endsWith('.jsonl'))
    .map((f) => ({ f, m: statSync(join(hiveLogsDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return matches.length ? join(hiveLogsDir, matches[0].f) : null
}

export interface ResolvedSession {
  sid: string
  cwd: string
  file: string
}

/**
 * Recover an agent's real session coordinates when its worktree-derived
 * bucket is empty: chat-log → latest session_id → bucket holding it → the
 * cwd that session ran under. Returns null when any link is missing, so
 * callers can fall back to existing behavior.
 */
export function resolveAgentSession(
  projectsDir: string,
  hiveLogsDir: string,
  chatId: string
): ResolvedSession | null {
  const log = newestHiveLogForChat(hiveLogsDir, chatId)
  if (!log) return null
  let sid: string | null = null
  try {
    sid = latestSessionIdFromHiveLog(readFileSync(log, 'utf8').split('\n'))
  } catch {
    return null
  }
  if (!sid) return null
  const loc = locateSessionBucket(projectsDir, sid)
  if (!loc) return null
  return { sid, cwd: loc.cwd, file: loc.file }
}
