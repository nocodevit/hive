import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { patternForAllowRule } from '../permission-rule-format'

/**
 * Replica of the IPC handler logic in src/main/index.ts:
 * `settings:addClaudeAllowRule`. The handler edits a fixed path
 * (~/.claude/settings.json); we redirect at the function level for
 * hermetic testing.
 *
 * Bug being regression-tested:
 * 2026-04-30 — claude code 2.1.123 changed `permission_suggestions`
 * from `{rules: [...]}` to discriminated union with new `setMode` /
 * `addDirectories` types. Hive's save handler only checked for
 * `rules`, so clicking "Allow & remember" silently no-op'd for
 * sensitive paths and the user kept getting re-prompted.
 */
function applySuggestion(settingsPath: string, payload: { rules?: any; suggestion?: any }) {
  let settings: any = {}
  if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  if (!settings.permissions) settings.permissions = {}

  let added = 0
  const s = payload.suggestion || (payload.rules ? { rules: payload.rules } : null)
  if (!s) return { ok: false, error: 'no suggestion' }

  if (Array.isArray(s.rules) && s.rules.length > 0) {
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = []
    for (const r of s.rules) {
      const pattern = patternForAllowRule(r.toolName, r.ruleContent)
      if (!settings.permissions.allow.includes(pattern)) {
        settings.permissions.allow.push(pattern)
        added++
      }
    }
  }

  if (s.type === 'addDirectories' && Array.isArray(s.directories)) {
    if (!Array.isArray(settings.permissions.additionalDirectories)) settings.permissions.additionalDirectories = []
    for (const d of s.directories) {
      if (typeof d === 'string' && !settings.permissions.additionalDirectories.includes(d)) {
        settings.permissions.additionalDirectories.push(d)
        added++
      }
    }
  }

  if (s.type === 'setMode' && typeof s.mode === 'string') {
    if (settings.permissions.defaultMode !== s.mode) {
      settings.permissions.defaultMode = s.mode
      added++
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  return { ok: true, added }
}

describe('settings:addClaudeAllowRule (permission save path)', () => {
  let tmp: string
  let settingsPath: string

  beforeEach(() => {
    tmp = join(tmpdir(), `hive-perm-test-${Date.now()}-${Math.random()}`)
    mkdirSync(tmp, { recursive: true })
    settingsPath = join(tmp, 'settings.json')
  })
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  it('OLD shape (rules array): writes to permissions.allow', () => {
    const r = applySuggestion(settingsPath, {
      rules: [{ toolName: 'Bash', ruleContent: 'npm *' }]
    })
    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.permissions.allow).toEqual(['Bash(npm *)'])
  })

  it('NEW shape addDirectories: writes to permissions.additionalDirectories', () => {
    const r = applySuggestion(settingsPath, {
      suggestion: {
        type: 'addDirectories',
        directories: ['/Users/x/.claude', '/Users/x/work'],
        destination: 'session'
      }
    })
    expect(r.ok).toBe(true)
    expect(r.added).toBe(2)
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.permissions.additionalDirectories).toEqual([
      '/Users/x/.claude',
      '/Users/x/work'
    ])
  })

  it('NEW shape setMode: writes to permissions.defaultMode', () => {
    const r = applySuggestion(settingsPath, {
      suggestion: { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
    })
    expect(r.ok).toBe(true)
    expect(r.added).toBe(1)
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.permissions.defaultMode).toBe('acceptEdits')
  })

  it('REGRESSION: SKILL.md edit prompt no longer no-ops', () => {
    // Exact repro of the bug user reported 2026-04-30:
    // Editing  /Users/meiyang/FrontEndProjects/psle-alex-web-hodas/.claude/skills/critic/pr-review/SKILL.md
    // → claude sends suggestion {type:'addDirectories', directories:[<that-dir>]}
    // → user clicks "Allow & trust …"
    // → settings.json must gain that path under additionalDirectories
    const dir = '/Users/meiyang/FrontEndProjects/psle-alex-web-hodas/.claude/skills/critic'
    const r = applySuggestion(settingsPath, {
      suggestion: { type: 'addDirectories', directories: [dir], destination: 'session' }
    })
    expect(r.added).toBe(1)
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.permissions.additionalDirectories).toContain(dir)
  })

  it('idempotent — clicking allow twice on same suggestion adds 0', () => {
    const sug = {
      type: 'addDirectories',
      directories: ['/a'],
      destination: 'session'
    }
    const a = applySuggestion(settingsPath, { suggestion: sug })
    const b = applySuggestion(settingsPath, { suggestion: sug })
    expect(a.added).toBe(1)
    expect(b.added).toBe(0)
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.permissions.additionalDirectories).toHaveLength(1)
  })

  it('preserves existing settings — does not clobber unrelated fields', () => {
    writeFileSync(settingsPath, JSON.stringify({
      version: 1,
      env: { FOO: 'bar' },
      permissions: { allow: ['Bash(ls)'], deny: ['Bash(rm -rf /)'] }
    }, null, 2))
    applySuggestion(settingsPath, {
      suggestion: { type: 'addDirectories', directories: ['/x'] }
    })
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(s.version).toBe(1)
    expect(s.env).toEqual({ FOO: 'bar' })
    expect(s.permissions.allow).toEqual(['Bash(ls)'])
    expect(s.permissions.deny).toEqual(['Bash(rm -rf /)'])
    expect(s.permissions.additionalDirectories).toEqual(['/x'])
  })

  it('returns no-op error for empty payload', () => {
    const r = applySuggestion(settingsPath, {})
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no suggestion')
  })

  it('rules with no entries: ok but added=0', () => {
    const r = applySuggestion(settingsPath, { suggestion: { type: 'addRule', rules: [] } })
    expect(r.ok).toBe(true)
    expect(r.added).toBe(0)
  })

  describe('REGRESSION: MCP tool persistence (user report 2026-08 — "keeps asking every time")', () => {
    it('MCP tool with undefined ruleContent writes BARE name (no parens, no "undefined")', () => {
      // The exact synthetic suggestion the new "Allow forever" button
      // sends for an MCP prompt without claude-provided suggestions.
      const r = applySuggestion(settingsPath, {
        suggestion: { rules: [{ toolName: 'mcp__stargate__jira_update_issue', ruleContent: '' }] }
      })
      expect(r.added).toBe(1)
      const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
      expect(s.permissions.allow).toEqual(['mcp__stargate__jira_update_issue'])
      // Explicit: the old writer would have produced `...(undefined)`
      // or `...()`, both of which claude 2.1.220 rejects.
      expect(s.permissions.allow[0]).not.toContain('(')
      expect(s.permissions.allow[0]).not.toContain('undefined')
    })

    it('Bash rule format is UNCHANGED (regression guard the other way)', () => {
      const r = applySuggestion(settingsPath, {
        suggestion: { rules: [{ toolName: 'Bash', ruleContent: 'git *' }] }
      })
      expect(r.added).toBe(1)
      const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
      expect(s.permissions.allow).toEqual(['Bash(git *)'])
    })

    it('mixed Bash + MCP rules in one suggestion each write in their correct format', () => {
      const r = applySuggestion(settingsPath, {
        suggestion: {
          rules: [
            { toolName: 'Bash', ruleContent: 'npm *' },
            { toolName: 'mcp__stargate__jira_search', ruleContent: '' },
            { toolName: 'mcp__stargate__gitlab_get_file', ruleContent: undefined }
          ]
        }
      })
      expect(r.added).toBe(3)
      const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
      expect(s.permissions.allow).toEqual([
        'Bash(npm *)',
        'mcp__stargate__jira_search',
        'mcp__stargate__gitlab_get_file'
      ])
    })

    it('idempotent for MCP — clicking Allow forever twice adds 0 the second time', () => {
      const suggestion = { rules: [{ toolName: 'mcp__stargate__jira_update_issue', ruleContent: '' }] }
      const a = applySuggestion(settingsPath, { suggestion })
      const b = applySuggestion(settingsPath, { suggestion })
      expect(a.added).toBe(1)
      expect(b.added).toBe(0)
      const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
      expect(s.permissions.allow).toHaveLength(1)
    })
  })
})
