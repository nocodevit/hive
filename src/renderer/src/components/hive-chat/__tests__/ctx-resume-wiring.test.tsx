// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

import HiveChat from '../index'

/**
 * Integration test for the resume-ctx-bar fix. Mounts HiveChat, walks
 * past StartChooser (clicks Start new for a quick-path that still wires
 * listeners the same way), then injects a synthetic `_historical`
 * assistant event carrying usage. Asserts the ctx % renders in Line 2
 * — proving:
 *   (a) `extractCtxTotalFromUsage` is wired into the historical branch
 *   (b) `setLatestInputTokens` actually fires from that branch
 *   (c) the ctx pct render derives from `latestInputTokens` correctly
 */

let onEventCb: ((ev: any) => void) | null = null
let onUsageCb: ((u: any) => void) | null = null
let onStderrCb: ((line: string) => void) | null = null
const noop = () => () => {}
const noopAsync = async () => ({ ok: true })

beforeEach(() => {
  onEventCb = null
  onUsageCb = null
  onStderrCb = null
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
      onStderr: (_id: string, cb: any) => { onStderrCb = cb; return noop() },
      onExit: (_id: string, _cb: any) => noop(),
      onError: (_id: string, _cb: any) => noop(),
      onUsage: (_id: string, cb: any) => { onUsageCb = cb; return noop() },
      onPrepend: (_id: string, _cb: any) => noop(),
      onRcOutput: (_id: string, _cb: any) => noop(),
      onRcExit: (_id: string, _cb: any) => noop(),
      onAutoContinue: (_id: string, _cb: any) => noop()
    },
    settings: { get: async () => undefined, set: vi.fn(), addClaudeAllowRule: vi.fn(noopAsync) },
    fs: { readFile: vi.fn(async () => '') },
    system: { username: vi.fn(async () => 'tester') }
  }
})

afterEach(() => { cleanup() })

describe('post-resume ctx % wiring', () => {
  it('historical assistant.usage seeds ctx % bar (no live result needed)', async () => {
    render(<HiveChat id="t1" cwd="/Users/x/test" agent="hive-x" agentName="Tester" continueSession={true} rebaseOnStart={false} visible={true} />)

    // StartChooser shows. Click Start new to bypass picker and fire chat.start.
    await waitFor(() => expect(screen.getByText(/Start new/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /✦\s*Start new/ }))

    // Listeners get wired in the post-chooser useEffect. Wait for the
    // chat surface to be live (sub-100ms; React commits after click).
    await waitFor(() => expect(onEventCb).toBeTruthy())

    // 1) Inject system/init so modelKnown=true and contextSize is set.
    //    Without [1m] suffix contextSize stays empty → ctx pct stays 0 even
    //    if tokens flow. Use claude-opus-4-7[1m].
    act(() => {
      onEventCb!({
        type: 'system', subtype: 'init',
        model: 'claude-opus-4-7[1m]',
        session_id: 'aaaaaaaa-1111-1111-1111-111111111111'
      })
    })

    // Bar should still read "context —" (no usage yet).
    await waitFor(() => expect(screen.getByText('context —')).toBeInTheDocument())

    // 2) Inject historical assistant event with usage at ~28% of 1M.
    //    iterations[-1] = 280k → ctx pct should render as 28%.
    act(() => {
      onEventCb!({
        type: 'assistant',
        _historical: true,
        message: {
          id: 'msg_x', model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'replayed reply' }],
          usage: {
            input_tokens: 1, cache_read_input_tokens: 280_000, cache_creation_input_tokens: 0,
            iterations: [
              { input_tokens: 1, cache_read_input_tokens: 280_000, cache_creation_input_tokens: 0 }
            ]
          }
        }
      })
    })

    // Now Line 2 should show "28%" derived from the historical usage.
    await waitFor(() => expect(screen.getByText('28%')).toBeInTheDocument())
    // And "context —" placeholder should be gone.
    expect(screen.queryByText('context —')).not.toBeInTheDocument()
  })

  it('historical SUBAGENT assistant.usage is ignored (does NOT poison ctx %)', async () => {
    render(<HiveChat id="t2" cwd="/Users/x/test" agent="hive-x" agentName="Tester" continueSession={true} rebaseOnStart={false} visible={true} />)
    await waitFor(() => expect(screen.getByText(/Start new/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /✦\s*Start new/ }))
    await waitFor(() => expect(onEventCb).toBeTruthy())

    act(() => {
      onEventCb!({
        type: 'system', subtype: 'init',
        model: 'claude-opus-4-7[1m]',
        session_id: 'aaaaaaaa-1111-1111-1111-111111111111'
      })
    })

    // Subagent assistant — has parent_tool_use_id. usage describes the
    // subagent's window, not the parent's; using it would flash the
    // bar with bogus % (alex-data showed 181% from this exact case).
    act(() => {
      onEventCb!({
        type: 'assistant',
        _historical: true,
        parent_tool_use_id: 'toolu_xxx',
        message: {
          id: 'msg_subagent', model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'subagent reply' }],
          usage: { iterations: [{ input_tokens: 1, cache_read_input_tokens: 950_000 }] }
        }
      })
    })

    // No ctx pct should appear — subagent usage was correctly ignored.
    await waitFor(() => expect(screen.getByText('context —')).toBeInTheDocument())
    expect(screen.queryByText(/95%/)).not.toBeInTheDocument()
  })
})
