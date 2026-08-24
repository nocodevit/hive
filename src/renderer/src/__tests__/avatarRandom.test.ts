// @vitest-environment jsdom
//
// randomAvatar tests — the whole point of this module is that new agents
// stop being clones of the default. Tests lock that promise in:
// (a) all fields fall inside their published option pools (no runtime
//     value that AvatarEditor can't render), and (b) across many calls
//     the outputs are actually different (a broken RNG that returns the
//     first element every time would silently regress to "same default
//     for everyone").

import { describe, it, expect } from 'vitest'
import { randomAvatar } from '../avatarRandom'
import { defaultAvatar } from '../types'

// Mirrors the private constants in avatarRandom.ts. Duplicated
// deliberately so a typo there fails the assertion here.
const POOLS = {
  skinTone:    ['#fde0c4', '#f5d0a9', '#dba97a', '#c68642', '#8d5524', '#5c3317'],
  hairColor:   ['#2c1810', '#4a3728', '#8b6914', '#c4a35a', '#d4a76a', '#e8c07a', '#7c3aed', '#06b6d4', '#f43f5e'],
  hairStyle:   ['short', 'parted', 'spiky', 'bun', 'long'],
  topStyle:    ['tee', 'hoodie', 'jacket', 'tank'],
  topColor:    ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#1e293b', '#f8fafc'],
  bottomStyle: ['pants', 'shorts', 'skirt'],
  bottomColor: ['#1e293b', '#3b82f6', '#6b7280', '#7c3aed', '#0f172a', '#ec4899'],
}

describe('randomAvatar', () => {
  it('produces values inside the published option pools', () => {
    // 50 samples: guards against a bug like `arr[Math.floor(Math.random())]`
    // silently returning arr[0] every time by making a mis-index eventually
    // land outside the pool.
    for (let i = 0; i < 50; i++) {
      const a = randomAvatar()
      expect(POOLS.skinTone).toContain(a.skinTone)
      expect(POOLS.hairStyle).toContain(a.hairStyle)
      expect(POOLS.hairColor).toContain(a.hairColor)
      expect(POOLS.topStyle).toContain(a.topStyle)
      expect(POOLS.topColor).toContain(a.topColor)
      expect(POOLS.bottomStyle).toContain(a.bottomStyle)
      expect(POOLS.bottomColor).toContain(a.bottomColor)
      expect(a.hat).toBe('none')
      expect(a.accessories).toEqual([])
    }
  })

  it('actually randomizes across calls', () => {
    // The whole point of the feature. If randomAvatar() started returning
    // the default clone again, the new-agent flow would silently regress.
    // With 40 samples and 6+ options per field, the odds of *every*
    // sample matching the default for even one field are astronomical.
    const samples = Array.from({ length: 40 }, () => randomAvatar())
    const uniqueSkinTones = new Set(samples.map((s) => s.skinTone))
    const uniqueTopColors = new Set(samples.map((s) => s.topColor))
    expect(uniqueSkinTones.size).toBeGreaterThan(1)
    expect(uniqueTopColors.size).toBeGreaterThan(1)
  })

  it('does not return the exact defaultAvatar shape', () => {
    // Statistical: across 30 samples, at least one field on at least one
    // sample must differ from the default. Anything else = RNG broken.
    const samples = Array.from({ length: 30 }, () => randomAvatar())
    const allIdenticalToDefault = samples.every((s) =>
      s.skinTone === defaultAvatar.skinTone &&
      s.hairStyle === defaultAvatar.hairStyle &&
      s.topColor === defaultAvatar.topColor
    )
    expect(allIdenticalToDefault).toBe(false)
  })
})
