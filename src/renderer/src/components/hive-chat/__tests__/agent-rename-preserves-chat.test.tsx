// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

import HiveChat from '../index'

/**
 * Regression test: renaming an agent (Editor tab → Name field → typing)
 * must NOT tear down the live chat session.
 *
 * Bug: the main IPC-wiring useEffect included `agentName` in its deps
 * array. `updateAgent(id, {name})` fires on every keystroke, App re-
 * renders Terminal → HiveChat with a new `agentName` prop, React sees
 * a dep change, runs cleanup → `window.api.chat.stop(id)`, which kills
 * the live --print subprocess. Main then broadcasts chat:exit; the
 * renderer's auto-open-chooser useEffect flips `chooserMode` back to
 * true. User's exact repro: "点击 agent edit → 改 agent 名字 → 点击
 * terminal tab → chat 消失，变回 starter page".
 *
 * Fix: agentName is a display-only label (used as `-n` flag on FIRST
 * spawn, captured at each handler call via closure). It has no reason
 * to be a session-defining dep. Removed from the deps array; effect
 * only re-runs on id/cwd/agent/continueSession/rebaseOnStart/chooserMode.
 */

let onEventCb: ((ev: any) => void) | null = null
const noop = () => () => {}
const noopAsync = async () => ({ ok: true })
const stopSpy = vi.fn(noopAsync)

beforeEach(() => {
  onEventCb = null
  stopSpy.mockClear()
  ;(globalThis as any).window.api = {
    chat: {
      start: vi.fn(noopAsync),
      stop: stopSpy,
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
      allowToolForSession: vi.fn(noopAsync),
      onEvent: (_id: string, cb: any) => { onEventCb = cb; return noop() },
      onStderr: (_id: string, _cb: any) => noop(),
      onExit: (_id: string, _cb: any) => noop(),
      onError: (_id: string, _cb: any) => noop(),
      onUsage: (_id: string, _cb: any) => noop(),
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

describe('agent rename does not kill the live chat', () => {
  it('re-rendering HiveChat with a new agentName does NOT call chat.stop', async () => {
    // Mount with an active session (bypass chooser by clicking Start new,
    // which flips chooserMode=false and wires the main effect).
    const { rerender } = render(
      <HiveChat id="t1" cwd="/Users/x/proj" agent="hive-x" agentName="Alice"
        continueSession={false} rebaseOnStart={false} visible={true} />
    )
    fireEvent.click(await screen.findByRole('button', { name: /✦\s*Start new/ }))
    await waitFor(() => expect(onEventCb).toBeTruthy())
    // chat.stop was NOT called during initial mount (only fires on unmount
    // or dep-change cleanup). Baseline before we simulate the rename.
    expect(stopSpy).not.toHaveBeenCalled()

    // Simulate what App.tsx does when user types in the name field:
    // re-render the same HiveChat instance with a different agentName.
    // Any other prop stays identical.
    rerender(
      <HiveChat id="t1" cwd="/Users/x/proj" agent="hive-x" agentName="Bob"
        continueSession={false} rebaseOnStart={false} visible={true} />
    )
    rerender(
      <HiveChat id="t1" cwd="/Users/x/proj" agent="hive-x" agentName="Bobby"
        continueSession={false} rebaseOnStart={false} visible={true} />
    )

    // If agentName is still in the effect's deps, each rerender's cleanup
    // fired chat.stop(). If the fix stuck, stopSpy has zero calls.
    expect(stopSpy).not.toHaveBeenCalled()
  })

  it('a genuine session-defining prop (cwd) DOES still tear down (regression guard the other way)', async () => {
    const { rerender } = render(
      <HiveChat id="t2" cwd="/Users/x/proj-a" agent="hive-x" agentName="Alice"
        continueSession={false} rebaseOnStart={false} visible={true} />
    )
    fireEvent.click(await screen.findByRole('button', { name: /✦\s*Start new/ }))
    await waitFor(() => expect(onEventCb).toBeTruthy())
    expect(stopSpy).not.toHaveBeenCalled()

    // Agent moved to a new worktree — cwd genuinely changed. Session
    // MUST respawn in the new dir, so cleanup must fire.
    rerender(
      <HiveChat id="t2" cwd="/Users/x/proj-b" agent="hive-x" agentName="Alice"
        continueSession={false} rebaseOnStart={false} visible={true} />
    )
    await waitFor(() => expect(stopSpy).toHaveBeenCalled())
  })
})
