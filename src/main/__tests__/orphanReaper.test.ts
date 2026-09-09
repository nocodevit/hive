import { describe, it, expect } from 'vitest'
import {
  parsePsForReap,
  isHiveChatClaude,
  orphanedHiveClaudePids
} from '../orphanReaper'

// Real command shapes observed in `ps` (trimmed).
const HIVE_CHAT =
  '/Users/me/.local/bin/claude --print --input-format stream-json --output-format stream-json --include-partial-messages --include-hook-events --permission-mode bypassPermissions --permission-prompt-tool stdio --verbose --agent hive-agent-1 -n Tim'
const DESKTOP_APP =
  '/Applications/Claude.app/Contents/.../claude --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio --include-partial-messages --resume=abc'
const TERMINAL_CLAUDE = 'claude --resume 20d44052-7537-4bba-9da2-2ee60ed57569'

describe('parsePsForReap', () => {
  it('parses pid/ppid/command rows', () => {
    const rows = parsePsForReap(` 65856     1 ${HIVE_CHAT}\n 1830  71108 ${TERMINAL_CLAUDE}\n`)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ pid: 65856, ppid: 1, command: HIVE_CHAT })
    expect(rows[1].pid).toBe(1830)
    expect(rows[1].ppid).toBe(71108)
  })

  it('skips blank / malformed lines', () => {
    expect(parsePsForReap('\n   \ngarbage no numbers\n')).toEqual([])
  })
})

describe('isHiveChatClaude', () => {
  it('matches a Hive chat claude --print child', () => {
    expect(isHiveChatClaude(HIVE_CHAT)).toBe(true)
  })

  it('does NOT match the Claude Desktop app (no --include-hook-events)', () => {
    // Guards the critical safety property: never kill the user's other claude.
    expect(isHiveChatClaude(DESKTOP_APP)).toBe(false)
  })

  it('does NOT match a plain terminal claude', () => {
    expect(isHiveChatClaude(TERMINAL_CLAUDE)).toBe(false)
  })

  it('does NOT match unrelated processes', () => {
    expect(isHiveChatClaude('/bin/zsh -l')).toBe(false)
    expect(isHiveChatClaude('node vite build')).toBe(false)
  })
})

describe('orphanedHiveClaudePids', () => {
  it('returns ONLY orphaned (ppid=1) Hive chat children', () => {
    const rows = [
      { pid: 65856, ppid: 1, command: HIVE_CHAT },          // orphan → reap
      { pid: 200, ppid: 71108, command: HIVE_CHAT },        // live under Hive → keep
      { pid: 1830, ppid: 1, command: DESKTOP_APP },         // orphan but NOT Hive → keep
      { pid: 300, ppid: 1, command: TERMINAL_CLAUDE }       // orphan but NOT Hive → keep
    ]
    expect(orphanedHiveClaudePids(rows, 999)).toEqual([65856])
  })

  it('never returns its own pid', () => {
    const rows = [{ pid: 42, ppid: 1, command: HIVE_CHAT }]
    expect(orphanedHiveClaudePids(rows, 42)).toEqual([])
  })

  it('returns empty when nothing is orphaned', () => {
    expect(orphanedHiveClaudePids([{ pid: 1, ppid: 71108, command: HIVE_CHAT }], 999)).toEqual([])
    expect(orphanedHiveClaudePids([], 999)).toEqual([])
  })
})
