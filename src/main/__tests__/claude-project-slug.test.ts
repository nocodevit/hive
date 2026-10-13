import { describe, it, expect } from 'vitest'
import { claudeProjectSlug } from '../../shared/claude-project-slug'

describe('claudeProjectSlug', () => {
  it('turns path separators into dashes', () => {
    expect(claudeProjectSlug('/Users/me/FrontEndProjects/cube-new-missy')).toBe('-Users-me-FrontEndProjects-cube-new-missy')
  })
  it('also replaces underscores, dots and spaces, as Claude Code does', () => {
    // Observed on disk: .../f5m189_n64ldt.../T/x-fixture is filed under ...-f5m189-n64ldt...-T-x-fixture
    expect(claudeProjectSlug('/private/var/folders/pv/f5m189_n64/T/hive-e2e-fixture')).toBe('-private-var-folders-pv-f5m189-n64-T-hive-e2e-fixture')
    expect(claudeProjectSlug('/Users/me/proj/.claude/worktrees/a.b')).toBe('-Users-me-proj--claude-worktrees-a-b')
    expect(claudeProjectSlug('/Users/me/My Project')).toBe('-Users-me-My-Project')
  })
  it('keeps a leading dash in a path segment distinct only by position', () => {
    expect(claudeProjectSlug('/tmp/claude-501/-Users-me-Documents/x')).toBe('-tmp-claude-501--Users-me-Documents-x')
  })
  it('handles the empty string', () => {
    expect(claudeProjectSlug('')).toBe('')
  })
})
