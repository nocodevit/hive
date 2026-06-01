// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

import HiveChat from '../index'

/**
 * Integration test for the v1.7.121 5h/7d %% merge fix. Mounts HiveChat,
 * bypasses StartChooser, fires synthetic `chat:usage` broadcasts at the
 * mocked IPC handler, and asserts ModelUsageBar's % does NOT get wiped
 * by a follow-up cc-only broadcast — the exact regression that was
 * making the bars flicker to `—` after every compact / message_stop.
 *
 * Why this matters beyond the pure usage-state.test.ts unit tests: the
 * helpers are trivially correct in isolation; what was broken before was
 * the WIRING — `setUsage(u as any)` vs `setUsage(prev => mergeUsage(...))`.
 * This test exercises the wired callback, not the helpers.
 */

let onEventCb: ((ev: any) => void) | null = null
let onUsageCb: ((u: any) => void) | null = null
const noop = () => () => {}
const noopAsync = async () => ({ ok: true })

beforeEach(() => {
  onEventCb = null
  onUsageCb = null
  ;(globalThis as any).window.api = {
    chat: {
      start: vi.fn(noopAsync),
      stop: vi.fn(noopAsync),
      send: vi.fn(noopAsync),
      compact: vi.fn(noopAsync),
      resumeSmart: vi.fn(noopAsync),
      startWithSummary: vi.fn(noopAsync),
      startRemoteControl: vi.fn(noopAsync),
      resumeFromRemoteControl: vi.fn(noopAsync),
      cancelAutoContinue: vi.fn(noopAsync),
      respondPermission: vi.fn(noopAsync),
      interrupt: vi.fn(noopAsync),
      loadOlder: vi.fn(noopAsync),
      scrapeContext: vi.fn(async () => ({ ok: false, error: 'unused-in-test' })),
      getPrevSessionInfo: vi.fn(async () => null),
      getRecentSessions: vi.fn(async () => []),
      onEvent: (_id: string, cb: any) => { onEventCb = cb; return noop() },
      onStderr: (_id: string, _cb: any) => noop(),
      onExit: (_id: string, _cb: any) => noop(),
      onError: (_id: string, _cb: any) => noop(),
      onUsage: (_id: string, cb: any) => { onUsageCb = cb; return noop() },
      onPrepend: (_id: string, _cb: any) => noop(),
      onRcOutput: (_id: string, _cb: any) => noop(),
      onRcExit: (_id: string, _cb: any) => noop(),
      onAutoContinue: (_id: string, _cb: any) => noop(),
      onCompactStuck: (_id: string, _cb: any) => noop()
    },
    settings: { get: async () => undefined, set: vi.fn(), addClaudeAllowRule: vi.fn(noopAsync) },
    fs: { readFile: vi.fn(async () => '') },
    system: { username: vi.fn(async () => 'tester') }
  }
})

afterEach(() => { cleanup() })

async function mountAndArm() {
  render(
    <HiveChat id="t-usage" cwd="/Users/x/test" agent="hive-x"
              agentName="Tester" continueSession={true}
              rebaseOnStart={false} visible={true} />
  )
  await waitFor(() => expect(screen.getByText(/Start new/)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /✦\s*Start new/ }))
  await waitFor(() => expect(onUsageCb).toBeTruthy())
  // Need system/init so ModelUsageBar renders (modelKnown gate).
  act(() => {
    onEventCb!({
      type: 'system', subtype: 'init',
      model: 'claude-opus-4-7[1m]',
      session_id: 'aaaaaaaa-1111-1111-1111-111111111111'
    })
  })
}

describe('chat:usage merge wiring (v1.7.121 regression)', () => {
  it('cc-only broadcast does NOT wipe fiveHour/sevenDay set by a prior pct broadcast', async () => {
    await mountAndArm()

    // 1) Backend's startup refresh succeeded — broadcast carries both
    //    cc fields and the PTY-scraped %.
    act(() => {
      onUsageCb!({
        costUSD: 1.23, burnPerHour: 0.5,
        fiveHour: 23, sevenDay: 5,
        fiveHourReset: '4h 12m', sevenDayReset: '6d 2h'
      })
    })
    await waitFor(() => expect(screen.getByText('23%')).toBeInTheDocument())
    expect(screen.getByText('5%')).toBeInTheDocument()

    // 2) Next message_stop fires refresh. ccusage succeeds (it always
    //    does), PTY scrape returns null. chat.ts broadcasts cc-only.
    //    PRE-FIX BUG: setUsage(u as any) replaced state → fiveHour/sevenDay
    //    became undefined → ModelUsageBar rendered `—` for both.
    //    POST-FIX: mergeUsage preserves prior account-level fields.
    act(() => {
      onUsageCb!({
        costUSD: 1.45, burnPerHour: 0.5,
        projectedUSD: 8.2, remainingMinutes: 90
      })
    })

    // The % MUST still be visible.
    expect(screen.getByText('23%')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
    // And there must be NO em-dash placeholders in the % slots.
    // (em-dash also lives in "context —"; we can't simply assert absence
    //  globally. Instead: positively confirm 23%/5% are still here.)
  })

  it('partial pct update overlays new % onto prior state', async () => {
    await mountAndArm()
    act(() => {
      onUsageCb!({ fiveHour: 23, sevenDay: 5, fiveHourReset: '4h 12m' })
    })
    await waitFor(() => expect(screen.getByText('23%')).toBeInTheDocument())

    // Backend fires a refresh with only fiveHour updated (hypothetical
    // partial update). sevenDay should remain at 5 due to merge.
    act(() => {
      onUsageCb!({ fiveHour: 30 })
    })
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
  })

  it('explicit-undefined pct in incoming overrides prior (sentinel contract)', async () => {
    // Documents the contract: callers wanting to clear must pass undefined
    // explicitly. Used by usage-state.ts spread merge semantics.
    await mountAndArm()
    act(() => {
      onUsageCb!({ fiveHour: 23, sevenDay: 5 })
    })
    await waitFor(() => expect(screen.getByText('23%')).toBeInTheDocument())

    act(() => {
      onUsageCb!({ fiveHour: undefined })
    })
    // fiveHour explicitly cleared, falls back to `—`. sevenDay untouched.
    expect(screen.queryByText('23%')).not.toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
  })
})
