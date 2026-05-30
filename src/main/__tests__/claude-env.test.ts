import { describe, it, expect } from 'vitest'
import { CLAUDE_INSTALL_COMMAND, claudeStatus } from '../claude-env'

describe('CLAUDE_INSTALL_COMMAND', () => {
  it('is the official native installer', () => {
    expect(CLAUDE_INSTALL_COMMAND).toBe('curl -fsSL https://claude.ai/install.sh | bash')
  })

  // Guard the core lesson: claude and node are separate concerns. The install
  // path must never reach for npm/node — that couples Hive to a toolchain it
  // has no business caring about.
  it('does not depend on node or npm', () => {
    expect(CLAUDE_INSTALL_COMMAND).not.toMatch(/npm/)
    expect(CLAUDE_INSTALL_COMMAND).not.toMatch(/\bnode\b/)
  })
})

describe('claudeStatus', () => {
  it('reports installed when claude can run', () => {
    const s = claudeStatus(true)
    expect(s.installed).toBe(true)
    expect(s.installCommand).toBe(CLAUDE_INSTALL_COMMAND)
  })

  it('reports not installed when claude cannot run, still surfacing the command', () => {
    const s = claudeStatus(false)
    expect(s.installed).toBe(false)
    expect(s.installCommand).toBe(CLAUDE_INSTALL_COMMAND)
  })
})
