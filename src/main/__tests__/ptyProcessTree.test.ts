import { describe, it, expect } from 'vitest'
import { parsePsRows, commandIsClaudeCli, hasClaudeDescendant } from '../ptyProcessTree'

describe('parsePsRows', () => {
  it('parses pid / ppid / command from `ps -Ao pid=,ppid=,command=` output', () => {
    const out = [
      '    1     0 /sbin/launchd',
      '  900   500 -zsh',
      '  901   900 claude --agent hive-alex -n "Alex"'
    ].join('\n')
    expect(parsePsRows(out)).toEqual([
      { pid: 1, ppid: 0, command: '/sbin/launchd' },
      { pid: 900, ppid: 500, command: '-zsh' },
      { pid: 901, ppid: 900, command: 'claude --agent hive-alex -n "Alex"' }
    ])
  })

  it('skips blank / malformed lines', () => {
    expect(parsePsRows('\n  not a row\n  10  5 node foo\n')).toEqual([
      { pid: 10, ppid: 5, command: 'node foo' }
    ])
  })
})

describe('commandIsClaudeCli', () => {
  it('matches the lowercase claude CLI invocation', () => {
    expect(commandIsClaudeCli('claude --agent hive-alex -n "Alex"')).toBe(true)
  })
  it('matches a resolved binary path ending in claude or claude.exe', () => {
    expect(commandIsClaudeCli('/Users/x/.bin/claude -c')).toBe(true)
    expect(commandIsClaudeCli('/Users/x/node_modules/.bin/claude.exe --agent hive-mint')).toBe(true)
  })
  it('matches a bare claude with no args', () => {
    expect(commandIsClaudeCli('claude')).toBe(true)
  })
  it('does NOT match the capital-C Claude Desktop app', () => {
    expect(commandIsClaudeCli('/Applications/Claude.app/Contents/MacOS/Claude')).toBe(false)
    expect(commandIsClaudeCli('chrome_crashpad_handler --annotation=_productName=Claude')).toBe(false)
  })
  it('does NOT match an unrelated command', () => {
    expect(commandIsClaudeCli('-zsh')).toBe(false)
    expect(commandIsClaudeCli('node /path/to/server.js')).toBe(false)
  })
})

describe('hasClaudeDescendant', () => {
  const rows = parsePsRows([
    '  500     1 /Applications/Hive.app/Contents/MacOS/Hive',
    '  900   500 -zsh',                                        // term A shell
    '  901   900 claude --agent hive-alex -n "Alex"',         // claude in term A
    '  950   500 -zsh',                                        // term B shell (no claude)
    '  633     1 /Applications/Claude.app/Contents/MacOS/Claude' // desktop app
  ].join('\n'))

  it('finds the claude session under the term-A shell pid', () => {
    expect(hasClaudeDescendant(rows, 900)).toBe(true)
  })

  it('returns false for a shell with no claude child', () => {
    expect(hasClaudeDescendant(rows, 950)).toBe(false)
  })

  it('does not leak across terminals (rootPid scoping)', () => {
    // Rooting at term B must NOT see term A's claude.
    expect(hasClaudeDescendant(rows, 950)).toBe(false)
  })

  it('finds claude nested deeper than a direct child', () => {
    const nested = parsePsRows([
      '  900   500 -zsh',
      '  910   900 sh -c "git pull && claude --agent hive-pink"',
      '  920   910 claude --agent hive-pink -n "Pink"'
    ].join('\n'))
    expect(hasClaudeDescendant(nested, 900)).toBe(true)
  })

  it('returns false for an unknown root pid', () => {
    expect(hasClaudeDescendant(rows, 99999)).toBe(false)
  })
})
