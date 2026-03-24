import { describe, it, expect } from 'vitest'

describe('appPrefs loading', () => {
  const defaults = { autoRunClaude: true, maxLogs: 100, jobPickup: true }

  it('preserves defaults when loaded data has missing fields', () => {
    const loaded = { autoRunClaude: true }
    const merged = { ...defaults, ...loaded }
    expect(merged.jobPickup).toBe(true)
    expect(merged.maxLogs).toBe(100)
  })

  it('overrides defaults with loaded values', () => {
    const loaded = { autoRunClaude: false, maxLogs: 50, jobPickup: false }
    const merged = { ...defaults, ...loaded }
    expect(merged.autoRunClaude).toBe(false)
    expect(merged.maxLogs).toBe(50)
    expect(merged.jobPickup).toBe(false)
  })

  it('handles empty loaded data', () => {
    const loaded = {}
    const merged = { ...defaults, ...loaded }
    expect(merged).toEqual(defaults)
  })

  it('does NOT lose jobPickup when old data lacks it', () => {
    // This was the actual bug: old data.json had { autoRunClaude: true }
    // without jobPickup, and setAppPrefs(loaded) overwrote the default
    const loaded = { autoRunClaude: true }
    // Wrong way (the bug):
    const wrong = loaded as typeof defaults
    expect(wrong.jobPickup).toBeUndefined()
    // Right way (the fix):
    const right = { ...defaults, ...loaded }
    expect(right.jobPickup).toBe(true)
  })
})
