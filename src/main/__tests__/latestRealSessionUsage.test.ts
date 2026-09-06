import { describe, it, expect } from 'vitest'
import { latestRealSessionUsage } from '../chat-recent-sessions'

// Minimal assistant-event factory.
const asst = (model: string, input?: number, extra: Record<string, number> = {}) => ({
  type: 'assistant',
  message: {
    model,
    ...(input === undefined ? {} : { usage: { input_tokens: input, ...extra } })
  }
})

describe('latestRealSessionUsage', () => {
  it('ignores a trailing <synthetic> turn — the Model <synthetic> / 0.0K chooser bug', () => {
    // Real turn establishes model + tokens; a <synthetic> turn (0 usage) follows.
    // Last-write-wins would have shown '<synthetic>' + 0; we must keep the real one.
    const events = [
      asst('claude-opus-5', 120_000),
      asst('<synthetic>', 0)
    ]
    expect(latestRealSessionUsage(events)).toEqual({ model: 'claude-opus-5', peakInputTokens: 120_000 })
  })

  it('takes the LATEST real turn (post-compact), not the peak', () => {
    // Pre-compact 200K then post-compact 24K: resume shows the post-compact figure.
    const events = [asst('claude-opus-5', 200_000), asst('claude-opus-5', 24_000)]
    expect(latestRealSessionUsage(events).peakInputTokens).toBe(24_000)
  })

  it('sums input + cache_read + cache_creation tokens', () => {
    const events = [asst('claude-sonnet-5', 1_000, { cache_read_input_tokens: 5_000, cache_creation_input_tokens: 400 })]
    expect(latestRealSessionUsage(events).peakInputTokens).toBe(6_400)
  })

  it('uses the last iteration when usage.iterations is present', () => {
    const events = [{
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { iterations: [{ input_tokens: 10 }, { input_tokens: 88_000 }] } }
    }]
    expect(latestRealSessionUsage(events).peakInputTokens).toBe(88_000)
  })

  it('skips non-assistant and null events', () => {
    const events = [null, { type: 'user' }, asst('claude-opus-5', 42_000), { type: 'result' }]
    expect(latestRealSessionUsage(events as any)).toEqual({ model: 'claude-opus-5', peakInputTokens: 42_000 })
  })

  it('returns defaults for an all-synthetic or empty session', () => {
    expect(latestRealSessionUsage([])).toEqual({ model: '', peakInputTokens: 0 })
    expect(latestRealSessionUsage([asst('<synthetic>', 0), asst('<synthetic>', 0)])).toEqual({ model: '', peakInputTokens: 0 })
  })
})
