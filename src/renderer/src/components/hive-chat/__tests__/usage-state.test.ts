import { describe, expect, it } from 'vitest'
import { mergeUsage, preserveAccountUsage } from '../usage-state'

describe('mergeUsage', () => {
  it('returns prev when incoming is empty', () => {
    const prev = { fiveHour: 23, sevenDay: 5 }
    expect(mergeUsage(prev, {})).toEqual({ fiveHour: 23, sevenDay: 5 })
  })

  it('overlays incoming fields onto prev', () => {
    const prev = { fiveHour: 23, sevenDay: 5 }
    expect(mergeUsage(prev, { fiveHour: 30 })).toEqual({ fiveHour: 30, sevenDay: 5 })
  })

  it('preserves prev fiveHour/sevenDay when incoming is cc-only (the core regression)', () => {
    // Exact pre-fix bug: chat.ts:622 broadcasts `{ ...(cc||{}), ...(pct||{}) }`.
    // When ccusage succeeds but /usage TUI scrape returns null, the broadcast
    // carries only cost fields — the old `setUsage(u)` then wiped the still-
    // valid fiveHour/sevenDay and the bar showed `—` until the next refresh
    // happened to succeed. mergeUsage keeps them.
    const prev = { fiveHour: 23, sevenDay: 5, fiveHourReset: '4h 12m' }
    const ccOnly = { costUSD: 1.23, burnPerHour: 0.5 }
    const out = mergeUsage(prev, ccOnly)
    expect(out.fiveHour).toBe(23)
    expect(out.sevenDay).toBe(5)
    expect(out.fiveHourReset).toBe('4h 12m')
    expect(out.costUSD).toBe(1.23)
    expect(out.burnPerHour).toBe(0.5)
  })

  it('an explicit undefined in incoming overrides prev (sentinel semantics)', () => {
    // Object spread copies own enumerable keys including explicit-undefined.
    // Documents the contract: callers wanting to clear must pass undefined
    // explicitly, not omit the key (which is what preserveAccountUsage does
    // to avoid this trap — it omits keys rather than setting to undefined).
    const prev = { fiveHour: 23 }
    expect(mergeUsage(prev, { fiveHour: undefined }).fiveHour).toBeUndefined()
  })

  it('does not mutate prev', () => {
    const prev = { fiveHour: 23 }
    mergeUsage(prev, { fiveHour: 99 })
    expect(prev.fiveHour).toBe(23)
  })
})

describe('preserveAccountUsage', () => {
  it('keeps account-level fields, drops session/cost fields', () => {
    const prev = {
      costUSD: 1.23, burnPerHour: 0.5, projectedUSD: 2,
      remainingMinutes: 45, totalTokens: 80000,
      fiveHour: 23, sevenDay: 5,
      fiveHourReset: '4h 12m', sevenDayReset: '6d 2h'
    }
    expect(preserveAccountUsage(prev)).toEqual({
      fiveHour: 23, sevenDay: 5,
      fiveHourReset: '4h 12m', sevenDayReset: '6d 2h'
    })
  })

  it('omits keys (not undefined-valued) when prev had no account fields', () => {
    // Important: omits rather than sets to undefined, so a subsequent
    // mergeUsage(prev, this) call won't clobber pre-existing values.
    const out = preserveAccountUsage({ costUSD: 1.23 })
    expect(Object.keys(out)).toEqual([])
  })

  it('returns empty object when prev is empty', () => {
    expect(preserveAccountUsage({})).toEqual({})
  })

  it('does not mutate prev', () => {
    const prev = { fiveHour: 23, costUSD: 1.23 }
    preserveAccountUsage(prev)
    expect(prev.costUSD).toBe(1.23)
  })

  it('round-trip: preserve + merge keeps account % across a reset', () => {
    // Simulates the post-compact flow:
    //   1. user clicks compact/resume → renderer resets via preserveAccountUsage
    //   2. backend startup refresh broadcasts cc-only (pct scrape failed)
    //   3. mergeUsage applies incoming on top
    //   Expected: account % survives, cc fields applied, no `—` flicker.
    const before = { fiveHour: 23, sevenDay: 5, costUSD: 9.99, totalTokens: 80000 }
    const afterReset = preserveAccountUsage(before)
    const afterCcOnlyBroadcast = mergeUsage(afterReset, { costUSD: 0.12, burnPerHour: 0.04 })
    expect(afterCcOnlyBroadcast.fiveHour).toBe(23)
    expect(afterCcOnlyBroadcast.sevenDay).toBe(5)
    expect(afterCcOnlyBroadcast.costUSD).toBe(0.12)
  })
})
