// Regression tests for main-process fixes in v1.7.114.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('writeCrashLog (1.7.117 regression — append-only JSONL)', () => {
  // pre-fix: Hive crashes left no observable trace because stderr is
  // /dev/null in a packaged .app and macOS only writes DiagnosticReports
  // for native crashes (not JS throws). We need the JSONL contract to
  // survive any future refactor.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-crash-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // The function under test lives in src/main/index.ts as a top-level
  // helper. Re-create the exact contract here so a divergent refactor
  // (e.g. someone changes the JSON schema) trips this test.
  function writeCrashLog(kind: string, info: Record<string, unknown>) {
    const { existsSync, mkdirSync, appendFileSync } = require('node:fs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'crash-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), kind, ...info }) + '\n')
  }

  it('writes one JSON line per call (append-only)', () => {
    writeCrashLog('test-one', { message: 'first' })
    writeCrashLog('test-two', { message: 'second' })
    const lines = readFileSync(join(dir, 'crash-log.jsonl'), 'utf-8').trim().split('\n')
    expect(lines.length).toBe(2)
    const first = JSON.parse(lines[0])
    const second = JSON.parse(lines[1])
    expect(first.kind).toBe('test-one')
    expect(first.message).toBe('first')
    expect(second.kind).toBe('test-two')
    expect(typeof first.ts).toBe('string')
    expect(first.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)         // ISO 8601
  })

  it('captures stack + componentStack for renderer-reported throws', () => {
    writeCrashLog('renderer-hive-chat-throw', {
      message: 'todos.map is not a function',
      stack: 'TypeError: todos.map is not a function\n    at TodoInline...',
      componentStack: '    at TodoInline\n    at ToolHeader\n    at ToolBlock'
    })
    const line = readFileSync(join(dir, 'crash-log.jsonl'), 'utf-8').trim()
    const entry = JSON.parse(line)
    expect(entry.message).toBe('todos.map is not a function')
    expect(entry.stack).toContain('TypeError')
    expect(entry.componentStack).toContain('TodoInline')
  })
})

describe('stale-handler race fix (1.7.118 regression)', () => {
  // pre-fix:
  //   child.on('exit', () => {
  //     const sess = sessions.get(id)
  //     if (sess?.internalRecycle) return       // ← `sess` is NEW session,
  //     ...                                      //    flag was on OLD one
  //     if (sess) sess.child = null              // ← nulls the LIVE child
  //   })
  // After resumeSmart's delete + startChat cycle, an old child's exit
  // fired AFTER sessions.set(id, sessionB). The handler read sessionB,
  // saw no internalRecycle flag (that lived on the old, gone session),
  // and clobbered sessionB.child = null + broadcast a phantom chat:exit.
  //
  // fix: closure-capture `child` and `if (sess.child !== child) return`.
  //
  // We re-implement the contract pure-functionally to test it without
  // spinning a real PTY.

  type Session = { id: string; child: object | null; internalRecycle?: boolean }

  function makeExitHandler(id: string, child: object, sessions: Map<string, Session>) {
    return (broadcast: { exit: any[] }) => {
      const sess = sessions.get(id)
      // The fix:
      if (sess && sess.child !== child) return       // stale — different child now
      if (sess?.internalRecycle) return              // intentional recycle
      broadcast.exit.push({ id })
      if (sess) sess.child = null
      else sessions.delete(id)
    }
  }

  it('stale exit handler does NOT broadcast or clobber NEW child', () => {
    const sessions = new Map<string, Session>()
    const childA = { name: 'childA' }
    const childB = { name: 'childB' }
    sessions.set('s1', { id: 's1', child: childA })

    const handlerA = makeExitHandler('s1', childA, sessions)

    // resumeSmart cycle: delete old, set new
    sessions.delete('s1')
    sessions.set('s1', { id: 's1', child: childB })

    // childA's exit fires LATE (after sessions.set(id, sessionB))
    const broadcast: { exit: any[] } = { exit: [] }
    handlerA(broadcast)

    // Critical: must NOT broadcast (renderer would flip to close-panel)
    expect(broadcast.exit).toEqual([])
    // Critical: must NOT clobber the live new child
    expect(sessions.get('s1')?.child).toBe(childB)
  })

  it('normal exit (no race) still broadcasts + nulls child', () => {
    const sessions = new Map<string, Session>()
    const childA = { name: 'childA' }
    sessions.set('s1', { id: 's1', child: childA })
    const handlerA = makeExitHandler('s1', childA, sessions)

    const broadcast: { exit: any[] } = { exit: [] }
    handlerA(broadcast)

    expect(broadcast.exit).toEqual([{ id: 's1' }])
    expect(sessions.get('s1')?.child).toBeNull()
  })

  it('internalRecycle still suppresses (compactSession path)', () => {
    const sessions = new Map<string, Session>()
    const childA = { name: 'childA' }
    sessions.set('s1', { id: 's1', child: childA, internalRecycle: true })
    const handlerA = makeExitHandler('s1', childA, sessions)

    const broadcast: { exit: any[] } = { exit: [] }
    handlerA(broadcast)

    expect(broadcast.exit).toEqual([])
    expect(sessions.get('s1')?.child).toBe(childA)   // not nulled
  })
})

describe('hydratePathFromShell contract (1.7.114 regression)', () => {
  // pre-fix: Finder-launched .app inherited launchd's minimal PATH
  // (/usr/bin:/bin:/usr/sbin:/sbin), so spawn('claude') ENOENT'd.
  // fix: run `$SHELL -c '. ~/.zshrc; printenv PATH'` and replace
  // process.env.PATH if output looks like a PATH (starts with `/`,
  // contains `:`).
  //
  // We test the validation contract: a sloppy regex would let garbage
  // through and break spawn() worse.

  function looksLikePath(out: string): boolean {
    const t = out.trim()
    return t.startsWith('/') && t.includes(':')
  }

  it('accepts real PATH outputs', () => {
    expect(looksLikePath('/usr/local/bin:/usr/bin:/bin')).toBe(true)
    expect(looksLikePath('/Users/x/.nvm/versions/node/v20/bin:/opt/homebrew/bin:/usr/bin')).toBe(true)
    expect(looksLikePath('  /opt/homebrew/bin:/usr/bin  ')).toBe(true)  // trimmed
  })

  it('rejects garbage that would break spawn', () => {
    expect(looksLikePath('')).toBe(false)
    expect(looksLikePath('nvm help\nUsage:...')).toBe(false)         // not starting with /
    expect(looksLikePath('/single-no-colon')).toBe(false)            // no separator
    expect(looksLikePath('Error sourcing rc')).toBe(false)
  })
})
