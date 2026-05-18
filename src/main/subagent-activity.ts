// Sub-agent (Task tool) liveness detection — v1.7.118.
//
// Problem: when an agent's parent claude session calls the Task tool,
// the parent claude process is technically idle (waiting for the
// tool_result). The agent-status hooks fire `Stop` on the parent →
// renderer flips the badge to yellow / 'waiting'. But there's an
// active sub-agent doing real work; the user-visible badge should
// be green / 'working'.
//
// Detection strategy: claude persists each sub-agent run as its own
// JSONL under `~/.claude/projects/<slug>/<session-id>/subagents/
// agent-<uuid>.jsonl`. While the sub-agent is streaming, that file's
// mtime advances every line. If *any* subagents/*.jsonl in *any*
// session dir for the agent's cwd has mtime within the last
// SUBAGENT_ACTIVE_WINDOW_MS, we treat the agent as still working.
//
// We deliberately do NOT add a chokidar/fs.watch watcher — the cadence
// here is the existing renderer polling cadence (a few Hz at most),
// which is plenty for a "is this badge yellow or green" UI question.
// A watcher would be more code, more state, and would have to be torn
// down on every selected-agent change.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Window (ms) during which a recent JSONL mtime counts as "the sub-
 * agent is still streaming". Sized for the typical claude inter-line
 * gap (sub-second to a few seconds for long tool calls); 10s gives
 * comfortable headroom without dragging the badge stuck-green for
 * minutes after a sub-agent really did finish.
 */
export const SUBAGENT_ACTIVE_WINDOW_MS = 10_000

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

/**
 * Pure: given a list of `{ path, mtimeMs }` records and a `nowMs`,
 * return true iff any record's mtime is within the active window.
 * Extracted so the FS walk can be tested without touching disk.
 */
export function isAnyRecentlyTouched(
  files: { mtimeMs: number }[],
  nowMs: number,
  windowMs = SUBAGENT_ACTIVE_WINDOW_MS
): boolean {
  const cutoff = nowMs - windowMs
  for (const f of files) {
    if (f.mtimeMs > cutoff) return true
  }
  return false
}

/**
 * Convert a cwd into the slug that claude uses to name its project
 * dir: replace every `/` with `-`. Matches the convention used by
 * replaySessionHistory() / runCompactViaPrint() in main/chat.ts.
 */
export function cwdToSlug(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

/**
 * Walk the subagents/ directories under the project slug and return
 * each JSONL's mtime. Tolerates a missing or unreadable project dir
 * (returns []). Only descends into folders named exactly `subagents`
 * directly below a session UUID dir — matches storage.ts walkJsonl()
 * convention.
 */
export function collectSubagentJsonlMtimes(cwd: string): { path: string; mtimeMs: number }[] {
  const slug = cwdToSlug(cwd)
  const projectDir = join(PROJECTS_DIR, slug)
  if (!existsSync(projectDir)) return []
  const out: { path: string; mtimeMs: number }[] = []
  let sessionDirs: string[]
  try { sessionDirs = readdirSync(projectDir) } catch { return out }
  for (const session of sessionDirs) {
    const subagentsDir = join(projectDir, session, 'subagents')
    if (!existsSync(subagentsDir)) continue
    let files: string[]
    try { files = readdirSync(subagentsDir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(subagentsDir, f)
      try {
        const st = statSync(p)
        if (st.isFile()) out.push({ path: p, mtimeMs: st.mtimeMs })
      } catch {}
    }
  }
  return out
}

/**
 * Top-level check used by the IPC handler: given an agent's resolved
 * cwd, is *any* sub-agent JSONL under that cwd's claude project dir
 * currently being written-to?
 */
export function isSubagentActiveForCwd(cwd: string | null, nowMs = Date.now()): boolean {
  if (!cwd) return false
  return isAnyRecentlyTouched(collectSubagentJsonlMtimes(cwd), nowMs)
}
