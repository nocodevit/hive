import { describe, it, expect } from 'vitest'
import { patternForAllowRule } from '../permission-rule-format'

describe('patternForAllowRule', () => {
  describe('MCP tools — bare name, no parens', () => {
    it('mcp__stargate__jira_update_issue → mcp__stargate__jira_update_issue', () => {
      expect(patternForAllowRule('mcp__stargate__jira_update_issue', undefined))
        .toBe('mcp__stargate__jira_update_issue')
    })

    it('ignores ruleContent for MCP tools even when claude sends one', () => {
      expect(patternForAllowRule('mcp__stargate__jira_search', 'anything'))
        .toBe('mcp__stargate__jira_search')
    })

    it('handles the historical undefined case (the reason ~44 broken rules were in settings.json)', () => {
      // Before this helper, the writer produced `mcp__X(undefined)` — a
      // shape claude 2.1.220 rejects on startup, triggering the Settings
      // Warning menu that also broke the 5h/7d scrape (see PR #29).
      expect(patternForAllowRule('mcp__stargate__jira_update_issue', undefined))
        .not.toContain('undefined')
      expect(patternForAllowRule('mcp__stargate__jira_update_issue', undefined))
        .not.toContain('(')
    })

    it('server-wildcard form (mcp__stargate__*) passes through unchanged', () => {
      expect(patternForAllowRule('mcp__stargate__*', undefined))
        .toBe('mcp__stargate__*')
    })
  })

  describe('non-MCP tools — Tool(pattern) format preserved', () => {
    it('Bash(npm *) — the canonical existing shape', () => {
      expect(patternForAllowRule('Bash', 'npm *')).toBe('Bash(npm *)')
    })

    it('Read with a file path', () => {
      expect(patternForAllowRule('Read', '/Users/x/notes.md'))
        .toBe('Read(/Users/x/notes.md)')
    })

    it('Edit with a glob', () => {
      expect(patternForAllowRule('Edit', 'src/**/*.ts'))
        .toBe('Edit(src/**/*.ts)')
    })
  })

  describe('edge cases', () => {
    it('tool named exactly "mcp__" (empty server) still treated as MCP — bare', () => {
      expect(patternForAllowRule('mcp__', 'ignored')).toBe('mcp__')
    })

    it('tool that merely contains mcp__ mid-string is NOT treated as MCP', () => {
      // The check is startsWith, not includes. Guards against a
      // hypothetical Tool called `wrap_mcp__X` being mis-classified.
      expect(patternForAllowRule('wrap_mcp__X', 'foo'))
        .toBe('wrap_mcp__X(foo)')
    })
  })
})
