import { describe, it, expect } from 'vitest'
import { ctxPctFromPrev, restartResumeMode, RESTART_COMPACT_THRESHOLD } from '../bulkRestart'

// Stand-in for parseContextSize: "1M" → 1e6, "200K" → 2e5, else 0.
const parseSize = (s: string): number =>
  s === '1M' ? 1_000_000 : s === '200K' ? 200_000 : 0

describe('ctxPctFromPrev', () => {
  it('computes percent of the context window used', () => {
    expect(ctxPctFromPrev({ contextSize: '1M', peakInputTokens: 350_000 }, parseSize)).toBe(35)
    expect(ctxPctFromPrev({ contextSize: '200K', peakInputTokens: 40_000 }, parseSize)).toBe(20)
  })
  it('is 0 when unknown / no window / no tokens', () => {
    expect(ctxPctFromPrev(null, parseSize)).toBe(0)
    expect(ctxPctFromPrev({ contextSize: '?', peakInputTokens: 100 }, parseSize)).toBe(0)
    expect(ctxPctFromPrev({ contextSize: '1M', peakInputTokens: 0 }, parseSize)).toBe(0)
  })
})

describe('restartResumeMode', () => {
  it('compacts at/above 30%, plain-resumes below', () => {
    expect(RESTART_COMPACT_THRESHOLD).toBe(30)
    expect(restartResumeMode(true, 30)).toBe('compact-resume')
    expect(restartResumeMode(true, 55)).toBe('compact-resume')
    expect(restartResumeMode(true, 29)).toBe('resume')
    expect(restartResumeMode(true, 0)).toBe('resume')
  })
  it("starts new when there is no prior session", () => {
    expect(restartResumeMode(false, 90)).toBe('new')
    expect(restartResumeMode(false, 0)).toBe('new')
  })
  it('honors a custom threshold', () => {
    expect(restartResumeMode(true, 50, 80)).toBe('resume')
    expect(restartResumeMode(true, 85, 80)).toBe('compact-resume')
  })
})
