import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Inline replica of the JSONL → RecentSession[] reducer that lives in
 * src/main/chat.ts (`getRecentSessions`). Mirrors the production logic
 * exactly. The real function reads `~/.claude/projects/<slug>/`; here
 * we point at a temp dir for hermetic testing.
 */
type RecentSession = {
  sid: string
  title: string
  preview: string
  lastActiveMs: number
  ctxPct: number
  totalTokens: number
}

function getRecentSessionsFromDir(dir: string, contextWindowTokens: number, limit = 5): RecentSession[] {
  const fs = require('node:fs')
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir)
    .filter((f: string) => f.endsWith('.jsonl'))
    .map((f: string) => ({ f, m: fs.statSync(join(dir, f)).mtimeMs }))
    .sort((a: any, b: any) => b.m - a.m)
    .slice(0, limit)

  return files.map((file: { f: string, m: number }) => {
    const sid = file.f.replace(/\.jsonl$/, '')
    let title = ''
    let preview = ''
    let lastInputTokens = 0
    try {
      const lines = fs.readFileSync(join(dir, file.f), 'utf8').split('\n').filter(Boolean)
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
}

describe('getRecentSessions', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `hive-test-${Date.now()}-${Math.random()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  const writeSession = (sid: string, lines: any[], mtime?: number) => {
    const path = join(tmp, `${sid}.jsonl`)
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    if (mtime) {
      const sec = mtime / 1000
      utimesSync(path, sec, sec)
    }
    return path
  }

  it('returns empty array when dir does not exist', () => {
    expect(getRecentSessionsFromDir('/nonexistent/path', 1_000_000)).toEqual([])
  })

  it('returns empty array when dir is empty', () => {
    expect(getRecentSessionsFromDir(tmp, 1_000_000)).toEqual([])
  })

  it('extracts title from first last-prompt event', () => {
    writeSession('aaaaaaaa-1111-1111-1111-111111111111', [
      { type: 'last-prompt', lastPrompt: 'fix the compact button' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'on it' }] } },
      { type: 'last-prompt', lastPrompt: 'also rename the variable' }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result).toHaveLength(1)
    // First last-prompt wins, not last
    expect(result[0].title).toBe('fix the compact button')
  })

  it('truncates long titles with ellipsis', () => {
    const long = 'a'.repeat(200)
    writeSession('bbbbbbbb-2222-2222-2222-222222222222', [
      { type: 'last-prompt', lastPrompt: long }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].title).toHaveLength(121) // 120 chars + '…'
    expect(result[0].title.endsWith('…')).toBe(true)
  })

  it('extracts preview from LAST assistant text (not first)', () => {
    writeSession('cccccccc-3333-3333-3333-333333333333', [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'first reply' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'second reply' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'third reply' }] } }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].preview).toBe('third reply')
  })

  it('uses LATEST assistant.usage for ctx (not peak)', () => {
    // Repro of the 97%-bug: post-compact session shouldn't show pre-compact peak.
    writeSession('dddddddd-4444-4444-4444-444444444444', [
      // Pre-compact peak: 970k tokens (97%)
      { type: 'assistant', message: { content: [{ type: 'text', text: 'big' }], usage: { iterations: [{ input_tokens: 1, cache_read_input_tokens: 970_000 }] } } },
      // Post-compact: 50k (5%)
      { type: 'assistant', message: { content: [{ type: 'text', text: 'small' }], usage: { iterations: [{ input_tokens: 50_000 }] } } }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].totalTokens).toBe(50_000)
    expect(result[0].ctxPct).toBe(5)
  })

  it('sums input_tokens + cache_read + cache_create from iterations[-1]', () => {
    writeSession('eeeeeeee-5555-5555-5555-555555555555', [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }], usage: { iterations: [
        { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 200 },
        { input_tokens: 5, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 } // last
      ] } } }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    // From iterations[-1]: 5 + 500 + 50
    expect(result[0].totalTokens).toBe(555)
  })

  it('falls back to top-level usage when iterations is missing', () => {
    writeSession('ffffffff-6666-6666-6666-666666666666', [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }], usage: {
        input_tokens: 10, cache_read_input_tokens: 90
      } } }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].totalTokens).toBe(100)
  })

  it('sorts by mtime descending and respects limit', () => {
    const now = Date.now()
    writeSession('aaa', [{ type: 'last-prompt', lastPrompt: 'oldest' }], now - 86400_000) // 1d ago
    writeSession('bbb', [{ type: 'last-prompt', lastPrompt: 'newest' }], now)
    writeSession('ccc', [{ type: 'last-prompt', lastPrompt: 'middle' }], now - 3600_000) // 1h ago

    const all = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(all.map(s => s.title)).toEqual(['newest', 'middle', 'oldest'])

    const limited = getRecentSessionsFromDir(tmp, 1_000_000, 2)
    expect(limited).toHaveLength(2)
    expect(limited.map(s => s.title)).toEqual(['newest', 'middle'])
  })

  it('skips malformed JSONL lines gracefully', () => {
    const path = join(tmp, '11111111-1111-1111-1111-111111111111.jsonl')
    writeFileSync(path, [
      'not json at all',
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'real' }),
      '{"truncated":',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } })
    ].join('\n'))
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].title).toBe('real')
    expect(result[0].preview).toBe('reply')
  })

  it('returns "(no title)" / "(no preview)" placeholders when fields missing', () => {
    writeSession('22222222-2222-2222-2222-222222222222', [
      { type: 'system', subtype: 'init' }
    ])
    const result = getRecentSessionsFromDir(tmp, 1_000_000)
    expect(result[0].title).toBe('(no title)')
    expect(result[0].preview).toBe('(no preview)')
    expect(result[0].totalTokens).toBe(0)
    expect(result[0].ctxPct).toBe(0)
  })

  it('rounds ctxPct correctly for various window sizes', () => {
    writeSession('33333333-3333-3333-3333-333333333333', [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'x' }], usage: { iterations: [{ input_tokens: 200_000 }] } } }
    ])
    expect(getRecentSessionsFromDir(tmp, 1_000_000)[0].ctxPct).toBe(20)
    expect(getRecentSessionsFromDir(tmp, 200_000)[0].ctxPct).toBe(100)
    expect(getRecentSessionsFromDir(tmp, 500_000)[0].ctxPct).toBe(40)
  })
})

/**
 * Repro of the runCompactViaPrint result-event parsing — the new B-2
 * compact path. Validates that we correctly detect success vs failure
 * based on `result.subtype` + `is_error`, which is the contract we
 * rely on instead of the previous PTY regex match.
 */
function classifyCompactResult(ev: { type: string; subtype?: string; is_error?: boolean }): { ok: boolean; error?: string } {
  if (ev.type !== 'result') return { ok: false, error: 'not_a_result_event' }
  const ok = ev.subtype === 'success' && !ev.is_error
  return { ok, error: ok ? undefined : (ev.subtype || 'error') }
}

/**
 * StartChooser button highlight rule. The `isDefault` style on each of
 * the 4 buttons (Resume / Compact+Resume / Start new / Fork) needs to
 * track:
 *   - when picker is closed: the smart-default mode (based on ctx tier)
 *   - when picker is open: the action the user just clicked (so the
 *     highlight follows their click instead of stuck on smart-default)
 *
 * Bug repro v1.7.87: clicking ⎙ Compact + Resume opened the picker but
 * left the green "active" border on ↻ Resume — user couldn't tell which
 * action was queued. Fix: derive isDefault from picker.action when open.
 */
function chooserButtonActive(
  button: 'resume' | 'compact-resume' | 'new' | 'fork',
  defaultMode: 'resume' | 'compact-resume' | 'new' | 'fork',
  picker: { action: 'resume' | 'compact-resume' | 'fork' } | null
): boolean {
  if (picker) {
    // Start new doesn't go through the picker — never "active" while picker is up.
    if (button === 'new') return false
    return button === picker.action
  }
  return button === defaultMode
}

describe('StartChooser button active highlight', () => {
  it('without picker: highlights smart-default mode', () => {
    expect(chooserButtonActive('resume', 'resume', null)).toBe(true)
    expect(chooserButtonActive('compact-resume', 'resume', null)).toBe(false)
    expect(chooserButtonActive('compact-resume', 'compact-resume', null)).toBe(true)
    expect(chooserButtonActive('new', 'new', null)).toBe(true)
  })

  it('picker open on Compact+Resume: highlights Compact+Resume, NOT Resume (97.bug repro)', () => {
    const picker = { action: 'compact-resume' as const }
    // Smart default was Resume but user clicked Compact+Resume:
    expect(chooserButtonActive('resume', 'resume', picker)).toBe(false)
    expect(chooserButtonActive('compact-resume', 'resume', picker)).toBe(true)
    expect(chooserButtonActive('fork', 'resume', picker)).toBe(false)
  })

  it('picker open on Fork: highlights Fork only', () => {
    const picker = { action: 'fork' as const }
    expect(chooserButtonActive('resume', 'resume', picker)).toBe(false)
    expect(chooserButtonActive('compact-resume', 'compact-resume', picker)).toBe(false)
    expect(chooserButtonActive('fork', 'resume', picker)).toBe(true)
    expect(chooserButtonActive('new', 'resume', picker)).toBe(false)
  })

  it('picker open on Resume: highlights Resume only', () => {
    const picker = { action: 'resume' as const }
    expect(chooserButtonActive('resume', 'compact-resume', picker)).toBe(true)
    expect(chooserButtonActive('compact-resume', 'compact-resume', picker)).toBe(false)
  })

  it('Start new is never highlighted while picker is up (no picker for it)', () => {
    for (const action of ['resume', 'compact-resume', 'fork'] as const) {
      expect(chooserButtonActive('new', 'new', { action })).toBe(false)
    }
  })
})

describe('runCompactViaPrint result classifier', () => {
  it('recognizes success', () => {
    expect(classifyCompactResult({ type: 'result', subtype: 'success', is_error: false })).toEqual({ ok: true })
  })

  it('flags is_error even when subtype says success', () => {
    expect(classifyCompactResult({ type: 'result', subtype: 'success', is_error: true })).toEqual({ ok: false, error: 'success' })
  })

  it('reports error_during_execution', () => {
    expect(classifyCompactResult({ type: 'result', subtype: 'error_during_execution', is_error: true }))
      .toEqual({ ok: false, error: 'error_during_execution' })
  })

  it('rejects non-result events (defensive)', () => {
    expect(classifyCompactResult({ type: 'assistant' as any })).toEqual({ ok: false, error: 'not_a_result_event' })
  })
})
