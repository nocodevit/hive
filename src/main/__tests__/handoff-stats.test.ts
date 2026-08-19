import { describe, it, expect } from 'vitest'
import {
  emptyStats,
  extractEditedFilePath,
  extractCommitFromBash,
  extractBashCommand,
  extractTestSummary,
  isToolErrorResult,
  extractAskUserQuestion,
  foldStats
} from '../handoff-supervisor'

describe('handoff-supervisor v2.3.0 stats extractors', () => {
  describe('extractEditedFilePath', () => {
    it('pulls file_path from Edit tool_use', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/foo.ts' } }] } }
      expect(extractEditedFilePath(ev)).toBe('/tmp/foo.ts')
    })
    it('handles Write and MultiEdit too', () => {
      expect(extractEditedFilePath({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/a' } }] } })).toBe('/a')
      expect(extractEditedFilePath({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'MultiEdit', input: { file_path: '/b' } }] } })).toBe('/b')
    })
    it('returns null on non-edit tools', () => {
      expect(extractEditedFilePath({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })).toBeNull()
    })
    it('returns null on user / system / malformed events', () => {
      expect(extractEditedFilePath({ type: 'user', message: { content: 'hi' } })).toBeNull()
      expect(extractEditedFilePath({ type: 'system' })).toBeNull()
      expect(extractEditedFilePath({ type: 'assistant' })).toBeNull()
    })
  })

  describe('extractCommitFromBash', () => {
    it('extracts single-line commit message from -m "..."', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: my thing"' } }] } }
      expect(extractCommitFromBash(ev)).toBe('fix: my thing')
    })
    // NOTE: current regex requires -m directly after `git commit` (optional
    // whitespace but no --flag args in between). This is intentional to
    // keep the pattern greedy-safe on Bash's arbitrary flag ordering; a
    // real-world `git commit --no-verify -m ...` won't be extracted, but
    // we don't lose data — the commit still happens, just not indexed
    // in report card. Acceptable tradeoff for v2.3.0.
    it('EXTRACTED FROM: git commit -m "..."  (simple form only, v2.3.0 limitation)', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "chore: bump"' } }] } }
      expect(extractCommitFromBash(ev)).toBe('chore: bump')
    })
    it('takes only first line of multi-line commit', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "feat: X\n\nbody"' } }] } }
      expect(extractCommitFromBash(ev)).toBe('feat: X')
    })
    it('returns null for non-commit bash', () => {
      expect(extractCommitFromBash({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }] } })).toBeNull()
    })
  })

  describe('extractBashCommand', () => {
    it('returns the raw command for tool_use Bash', () => {
      expect(extractBashCommand({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })).toBe('npm test')
    })
    it('returns null for non-Bash tools', () => {
      expect(extractBashCommand({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x' } }] } })).toBeNull()
    })
  })

  describe('extractTestSummary', () => {
    it('parses "47 passed, 3 failed" from a tool_result attributed to npm test', () => {
      const ev = { type: 'user', message: { content: [{ type: 'tool_result', content: 'Tests: 47 passed | 3 failed', is_error: false }] } }
      const s = extractTestSummary(ev, 'npm test')
      expect(s).toEqual({ command: 'npm test', passed: 47, failed: 3, ok: false })
    })
    it('ok=true when zero failed and no is_error', () => {
      const ev = { type: 'user', message: { content: [{ type: 'tool_result', content: '47 passed', is_error: false }] } }
      const s = extractTestSummary(ev, 'vitest run')
      expect(s?.ok).toBe(true)
    })
    it('null when lastBashCmd was not a test-run pattern', () => {
      const ev = { type: 'user', message: { content: [{ type: 'tool_result', content: '47 passed' }] } }
      expect(extractTestSummary(ev, 'ls')).toBeNull()
    })
    it('null when no lastBashCmd context', () => {
      const ev = { type: 'user', message: { content: [{ type: 'tool_result', content: '47 passed' }] } }
      expect(extractTestSummary(ev, null)).toBeNull()
    })
  })

  describe('isToolErrorResult', () => {
    it('true when tool_result has is_error=true', () => {
      expect(isToolErrorResult({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'oops' }] } })).toBe(true)
    })
    it('false when is_error is missing or false', () => {
      expect(isToolErrorResult({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })).toBe(false)
      expect(isToolErrorResult({ type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } })).toBe(false)
    })
  })

  describe('extractAskUserQuestion', () => {
    it('extracts the question and options (nested questions[0] shape)', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', options: [{ label: 'A', description: 'apple' }, { label: 'B' }] }] } }] } }
      expect(extractAskUserQuestion(ev)).toEqual({ question: 'A or B?', options: [{ label: 'A', description: 'apple' }, { label: 'B', description: undefined }] })
    })
    it('extracts simpler {question, options} shape', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { question: 'yes?', options: [{ label: 'yes' }] } }] } }
      expect(extractAskUserQuestion(ev)?.question).toBe('yes?')
    })
    it('falls back to a placeholder for empty/missing input', () => {
      const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] } }
      expect(extractAskUserQuestion(ev)?.question).toMatch(/agent asked a question/)
    })
    it('returns null when NOT an AskUserQuestion tool_use', () => {
      expect(extractAskUserQuestion({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })).toBeNull()
      expect(extractAskUserQuestion({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })).toBeNull()
    })
  })

  describe('foldStats — end-to-end integration', () => {
    it('accumulates files, commits, test-run, errors across a mini session', () => {
      let state = emptyStats()
      let lastBash: string | null = null
      // Edit A
      const step1 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } }] } }, lastBash)
      state = step1.stats; lastBash = step1.nextBashCmd
      // Edit B
      const step2 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/b.ts' } }] } }, lastBash)
      state = step2.stats; lastBash = step2.nextBashCmd
      // Bash npm test
      const step3 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } }, lastBash)
      state = step3.stats; lastBash = step3.nextBashCmd
      // tool_result of npm test
      const step4 = foldStats(state, { type: 'user', message: { content: [{ type: 'tool_result', content: '47 passed, 0 failed', is_error: false }] } }, lastBash)
      state = step4.stats; lastBash = step4.nextBashCmd
      // git commit
      const step5 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "ship"' } }] } }, lastBash)
      state = step5.stats; lastBash = step5.nextBashCmd
      // tool error
      const step6 = foldStats(state, { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'ENOENT' }] } }, lastBash)
      state = step6.stats

      expect(state.filesEdited).toEqual(['/a.ts', '/b.ts'])
      expect(state.commits.map(c => c.msg)).toEqual(['ship'])
      expect(state.lastTestRun?.ok).toBe(true)
      expect(state.toolErrorsRecovered).toBe(1)
    })

    it('dedupes files edited (same path twice = one entry)', () => {
      let state = emptyStats()
      const s1 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x.ts' } }] } }, null)
      state = s1.stats
      const s2 = foldStats(state, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x.ts' } }] } }, null)
      expect(s2.stats.filesEdited).toEqual(['/x.ts'])
    })
  })
})
