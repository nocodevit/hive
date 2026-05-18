// Subagent activity detection — v1.7.118 status-badge fix.
//
// When a parent claude agent is running the Task tool, the parent's
// Stop hook fires and the renderer flips the badge to 'waiting' /
// yellow. But there's still active work happening in the sub-agent
// JSONL. This module's helpers let main check the JSONL mtime and
// override the badge to 'working' / green for the duration.
//
// We test the pure mtime predicate (no FS), plus the FS-walking
// helper against a temp claude-projects layout with a known cwd slug.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isAnyRecentlyTouched,
  cwdToSlug,
  collectSubagentJsonlMtimes,
  isSubagentActiveForCwd,
  SUBAGENT_ACTIVE_WINDOW_MS
} from '../subagent-activity'

describe('isAnyRecentlyTouched (pure)', () => {
  const now = 1_000_000_000_000
  it('returns true when at least one file mtime is inside the window', () => {
    expect(isAnyRecentlyTouched(
      [{ mtimeMs: now - 5_000 }, { mtimeMs: now - 60_000 }],
      now
    )).toBe(true)
  })
  it('returns false when all files are older than the window', () => {
    expect(isAnyRecentlyTouched(
      [{ mtimeMs: now - 20_000 }, { mtimeMs: now - 60_000 }],
      now
    )).toBe(false)
  })
  it('returns false on an empty list', () => {
    expect(isAnyRecentlyTouched([], now)).toBe(false)
  })
  it('boundary: file exactly at the cutoff is NOT considered active', () => {
    // strict >, not >=
    expect(isAnyRecentlyTouched([{ mtimeMs: now - SUBAGENT_ACTIVE_WINDOW_MS }], now)).toBe(false)
  })
  it('accepts a custom window override', () => {
    expect(isAnyRecentlyTouched([{ mtimeMs: now - 30_000 }], now, 60_000)).toBe(true)
    expect(isAnyRecentlyTouched([{ mtimeMs: now - 30_000 }], now, 20_000)).toBe(false)
  })
})

describe('cwdToSlug (pure)', () => {
  it('converts a unix path to claude project slug (/→-)', () => {
    expect(cwdToSlug('/Users/me/Development/hive-david')).toBe('-Users-me-Development-hive-david')
  })
  it('handles trailing slash', () => {
    expect(cwdToSlug('/a/b/')).toBe('-a-b-')
  })
})

/**
 * Build a temp claude-projects layout that matches the real
 * ~/.claude/projects/<slug>/<sid>/subagents/agent-*.jsonl tree, then
 * run collectSubagentJsonlMtimes against it by stubbing $HOME via a
 * symlink. We can't redirect the PROJECTS_DIR constant at runtime, so
 * use a pattern: temp dir mirroring `.claude/projects/<slug>/...` and
 * monkey-patch homedir.
 *
 * Simpler: build the tree under a real homedir override and use
 * `import.meta.env`-style or process.env.HOME, but the module reads
 * homedir() at import time. We point HOME via `vi.spyOn` on os module
 * — too brittle. Instead: pre-create the real ~/.claude/projects
 * subtree with a fixture slug and clean up after, since tests run on
 * the dev box.
 *
 * To stay test-isolated, we use a unique cwd-slug each run (timestamp
 * + pid) so we never collide with real session data.
 */
describe('collectSubagentJsonlMtimes (FS)', () => {
  // Real homedir/.claude/projects path (we don't redirect; subagent-
  // activity reads homedir() at import time). Slug uses a tmp marker
  // so the test never collides with real session data.
  const realProjectsDir = join(process.env.HOME || tmpdir(), '.claude', 'projects')
  const stamp = `${Date.now()}-${process.pid}`
  const fakeCwd = `/tmp/subagent-activity-test/${stamp}`
  const slug = fakeCwd.replace(/\//g, '-')
  const projectDir = join(realProjectsDir, slug)

  beforeEach(() => {
    mkdirSync(projectDir, { recursive: true })
  })
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }) } catch {}
  })

  it('returns empty when the project dir is missing', () => {
    rmSync(projectDir, { recursive: true, force: true })
    expect(collectSubagentJsonlMtimes(fakeCwd)).toEqual([])
  })

  it('returns empty when no session has a subagents/ dir', () => {
    mkdirSync(join(projectDir, 'sess-1'), { recursive: true })
    writeFileSync(join(projectDir, 'sess-1', 'main.jsonl'), '{}')
    expect(collectSubagentJsonlMtimes(fakeCwd)).toEqual([])
  })

  it('picks up JSONL files under <sid>/subagents/', () => {
    const subDir = join(projectDir, 'sess-1', 'subagents')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, 'agent-aaa.jsonl'), '{}')
    writeFileSync(join(subDir, 'agent-bbb.jsonl'), '{}')
    writeFileSync(join(subDir, 'README.txt'), 'ignore me')
    const out = collectSubagentJsonlMtimes(fakeCwd)
    const names = out.map(f => f.path.split('/').pop()!).sort()
    expect(names).toEqual(['agent-aaa.jsonl', 'agent-bbb.jsonl'])
    expect(out.every(f => typeof f.mtimeMs === 'number')).toBe(true)
  })

  it('walks multiple session dirs under the same project', () => {
    for (const sess of ['sess-1', 'sess-2']) {
      const subDir = join(projectDir, sess, 'subagents')
      mkdirSync(subDir, { recursive: true })
      writeFileSync(join(subDir, 'agent-x.jsonl'), '{}')
    }
    expect(collectSubagentJsonlMtimes(fakeCwd)).toHaveLength(2)
  })
})

describe('isSubagentActiveForCwd (FS + window)', () => {
  const realProjectsDir = join(process.env.HOME || tmpdir(), '.claude', 'projects')
  const stamp = `${Date.now()}-${process.pid}-active`
  const fakeCwd = `/tmp/subagent-activity-test/${stamp}`
  const slug = fakeCwd.replace(/\//g, '-')
  const projectDir = join(realProjectsDir, slug)
  const subDir = join(projectDir, 'sess-1', 'subagents')

  beforeEach(() => {
    mkdirSync(subDir, { recursive: true })
  })
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }) } catch {}
  })

  it('returns true when a subagent JSONL was touched 5s ago', () => {
    const p = join(subDir, 'agent-recent.jsonl')
    writeFileSync(p, '{}')
    const fiveSecAgoSec = Date.now() / 1000 - 5
    utimesSync(p, fiveSecAgoSec, fiveSecAgoSec)
    expect(isSubagentActiveForCwd(fakeCwd)).toBe(true)
  })

  it('returns false when subagent JSONL was touched 20s ago (outside window)', () => {
    const p = join(subDir, 'agent-stale.jsonl')
    writeFileSync(p, '{}')
    const twentySecAgoSec = Date.now() / 1000 - 20
    utimesSync(p, twentySecAgoSec, twentySecAgoSec)
    expect(isSubagentActiveForCwd(fakeCwd)).toBe(false)
  })

  it('returns false on null cwd', () => {
    expect(isSubagentActiveForCwd(null)).toBe(false)
  })

  it('returns true when ANY of several JSONLs is fresh (older ones do not mask)', () => {
    const fresh = join(subDir, 'agent-fresh.jsonl')
    const stale = join(subDir, 'agent-stale.jsonl')
    writeFileSync(fresh, '{}')
    writeFileSync(stale, '{}')
    const nowSec = Date.now() / 1000
    utimesSync(stale, nowSec - 120, nowSec - 120)
    utimesSync(fresh, nowSec - 2, nowSec - 2)
    expect(isSubagentActiveForCwd(fakeCwd)).toBe(true)
  })
})
