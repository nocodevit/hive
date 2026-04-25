import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ipcMain } from 'electron'

/**
 * Storage utilities for cleaning up Claude Code's session JSONL files
 * under ~/.claude/projects. Hive's own ~/.hive/chat-logs is handled by
 * the 30-day sweep in chat.ts (sweepOldLogs) — this module is for the
 * larger Claude Code-side persistence which has no native cleanup.
 *
 * Safety:
 *  - Walks files by mtime; "active" sessions (modified within the
 *    retention window) are never touched.
 *  - Subagent JSONLs (under <session>/subagents/) are filtered out by
 *    Claude's own /resume picker (isSidechain=true), so they're pure
 *    debugging artifacts and safe to delete on the same schedule.
 *  - Delete prunes empty directories left behind so the tree stays clean.
 */

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

export interface FileMeta {
  path: string
  bytes: number
  mtimeMs: number
  isSubagent: boolean
}

function walkJsonl(): FileMeta[] {
  const out: FileMeta[] = []
  if (!existsSync(PROJECTS_DIR)) return out
  const visit = (dir: string, isSubagent: boolean) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      const p = join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) {
        // The convention is <session-uuid>/subagents/agent-*.jsonl;
        // any deeper "subagents" dir keeps the flag.
        visit(p, isSubagent || e === 'subagents')
      } else if (st.isFile() && e.endsWith('.jsonl')) {
        out.push({ path: p, bytes: st.size, mtimeMs: st.mtimeMs, isSubagent })
      }
    }
  }
  visit(PROJECTS_DIR, false)
  return out
}

export interface ClaudeLogStats {
  totalFiles: number
  totalBytes: number
  mainFiles: number
  mainBytes: number
  subagentFiles: number
  subagentBytes: number
  // Stale = older than retentionDays (mtime cutoff)
  staleFiles: number
  staleBytes: number
  staleMainFiles: number
  staleMainBytes: number
  staleSubagentFiles: number
  staleSubagentBytes: number
  // For the UI dry-run preview
  topStale: { path: string; bytes: number; mtimeMs: number }[]
}

/**
 * Pure summarizer: takes an already-collected list of file metadata
 * + a cutoff timestamp and emits the stats payload. Extracted so we
 * can vitest-cover the bucketing logic without touching the real
 * filesystem (the walk lives in walkJsonl()).
 */
export function summarizeFiles(files: FileMeta[], cutoffMs: number): ClaudeLogStats {
  const stats: ClaudeLogStats = {
    totalFiles: 0, totalBytes: 0,
    mainFiles: 0, mainBytes: 0,
    subagentFiles: 0, subagentBytes: 0,
    staleFiles: 0, staleBytes: 0,
    staleMainFiles: 0, staleMainBytes: 0,
    staleSubagentFiles: 0, staleSubagentBytes: 0,
    topStale: []
  }
  const stale: FileMeta[] = []
  for (const f of files) {
    stats.totalFiles++
    stats.totalBytes += f.bytes
    if (f.isSubagent) { stats.subagentFiles++; stats.subagentBytes += f.bytes }
    else { stats.mainFiles++; stats.mainBytes += f.bytes }
    if (f.mtimeMs < cutoffMs) {
      stats.staleFiles++; stats.staleBytes += f.bytes
      if (f.isSubagent) { stats.staleSubagentFiles++; stats.staleSubagentBytes += f.bytes }
      else { stats.staleMainFiles++; stats.staleMainBytes += f.bytes }
      stale.push(f)
    }
  }
  stale.sort((a, b) => b.bytes - a.bytes)
  stats.topStale = stale.slice(0, 20).map(f => ({ path: f.path, bytes: f.bytes, mtimeMs: f.mtimeMs }))
  return stats
}

export function getClaudeLogStats(retentionDays: number): ClaudeLogStats {
  return summarizeFiles(walkJsonl(), Date.now() - retentionDays * 24 * 3600 * 1000)
}

export interface CleanResult {
  deletedFiles: number
  deletedBytes: number
  removedDirs: number
  errors: string[]
}

export function cleanClaudeLogs(retentionDays: number, dryRun = false): CleanResult {
  const files = walkJsonl()
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000
  const result: CleanResult = { deletedFiles: 0, deletedBytes: 0, removedDirs: 0, errors: [] }
  const touchedDirs = new Set<string>()
  for (const f of files) {
    if (f.mtimeMs >= cutoff) continue
    if (dryRun) {
      result.deletedFiles++
      result.deletedBytes += f.bytes
      continue
    }
    try {
      unlinkSync(f.path)
      result.deletedFiles++
      result.deletedBytes += f.bytes
      // Remember parent dirs to try empty-dir cleanup at the end
      let d = f.path
      for (let i = 0; i < 4; i++) {
        d = d.substring(0, d.lastIndexOf('/'))
        if (d.length <= PROJECTS_DIR.length) break
        touchedDirs.add(d)
      }
    } catch (e) {
      result.errors.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!dryRun) {
    // Sort by depth (deepest first) so we collapse from the leaves up.
    const dirs = [...touchedDirs].sort((a, b) => b.split('/').length - a.split('/').length)
    for (const d of dirs) {
      try {
        const remaining = readdirSync(d)
        if (remaining.length === 0) {
          rmdirSync(d)
          result.removedDirs++
        }
      } catch {}
    }
  }
  return result
}

export function registerStorageIpc() {
  ipcMain.handle('storage:claudeLogStats', (_e, { retentionDays }: { retentionDays: number }) =>
    getClaudeLogStats(retentionDays)
  )
  ipcMain.handle('storage:cleanClaudeLogs', (_e, { retentionDays, dryRun }: { retentionDays: number; dryRun?: boolean }) =>
    cleanClaudeLogs(retentionDays, !!dryRun)
  )
}
