// @vitest-environment jsdom
//
// v2.15.2 regression pin — the auto-flush useEffect must actually
// fire when the compact settles.
//
// User complaint: 'compact时, queue用户输入的功能, 你是不是丢失了'.
// The chip showed 'Queued: hello' during compact, compact finished,
// new session came alive, but the draft never got sent.
//
// Root cause: real event ordering during /compact is:
//   1. User types → pendingDraft='hello', compactInProgress=true
//   2. Old --print child killed → onExit fires:
//      setExited(1)                     (blocks the auto-send gate)
//      setCompactStartedAt(null)         (flips compactInProgress false)
//      → React fires useEffect ONCE with [compactInProgress=false]
//      → auto-send condition fails: `exited === null` is FALSE
//      → skipped, but the effect has been consumed
//   3. Compaction runs 30-90s
//   4. New --print spawned → system:init → setExited(null)
//      → `exited` flips null but useEffect deps was only [compactInProgress]
//      → NO re-fire → pendingDraft stuck forever
//
// Pre-v2.15.2 code had deps=[compactInProgress]; v2.15.2 changes to
// [compactInProgress, exited, pendingDraft] so the effect re-fires
// when the new child comes alive. This test pins that behavior.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEffect, useState } from 'react'

/**
 * Mirror of the auto-flush hook from index.tsx. Keep in sync with
 * the real one (line ~1294 of index.tsx). If the real deps array
 * changes, this test's `deps` argument must change too so we
 * regression-pin the actual behavior.
 */
function useAutoFlush(
  compactInProgress: boolean,
  pendingDraft: string | null,
  exited: number | null,
  onFlush: (draft: string) => void,
  setPendingDraft: (v: string | null) => void
) {
  useEffect(() => {
    if (!compactInProgress && pendingDraft !== null && exited === null) {
      const draft = pendingDraft
      setPendingDraft(null)
      onFlush(draft)
    }
    // MUST match real code — testing this exact dep array.
  }, [compactInProgress, exited, pendingDraft])
}

describe('v2.15.2 auto-flush useEffect fires when new child comes alive', () => {
  it('flushes the queued draft only after the new session is alive (compactInProgress→false AND exited→null)', () => {
    const onFlush = vi.fn()
    let compactInProgress = true
    let pendingDraft: string | null = null
    let exited: number | null = null
    let setPendingDraftReal: (v: string | null) => void = () => {}

    const { rerender } = renderHook(() => {
      const [pd, setPd] = useState<string | null>(pendingDraft)
      setPendingDraftReal = setPd
      useAutoFlush(compactInProgress, pd, exited, onFlush, setPd)
      return { pd }
    })

    // Step 1: user types 'hello' during compact.
    act(() => { setPendingDraftReal('hello') })
    expect(onFlush).not.toHaveBeenCalled()

    // Step 2: old child killed. onExit fires — setExited AND
    // setCompactStartedAt(null). compactInProgress flips false but
    // exited is non-null. Auto-send condition fails.
    compactInProgress = false
    exited = 1
    rerender()
    expect(onFlush).not.toHaveBeenCalled()

    // Step 3: new child spawned. system:init handler calls
    // setExited(null). THIS is the moment the auto-send should fire.
    // Pre-v2.15.2 (deps=[compactInProgress]) it did not — because
    // compactInProgress didn't change on this render. Post-v2.15.2
    // (deps includes exited + pendingDraft) it fires.
    exited = null
    rerender()

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith('hello')
  })

  it('does NOT fire during compact (compactInProgress=true), even if pendingDraft set', () => {
    const onFlush = vi.fn()
    let compactInProgress = true
    let exited: number | null = null
    let setPendingDraftReal: (v: string | null) => void = () => {}

    const { rerender } = renderHook(() => {
      const [pd, setPd] = useState<string | null>(null)
      setPendingDraftReal = setPd
      useAutoFlush(compactInProgress, pd, exited, onFlush, setPd)
      return null
    })

    act(() => { setPendingDraftReal('mid-compact-typed') })
    expect(onFlush).not.toHaveBeenCalled()

    // Compact still in progress — no flush.
    rerender()
    expect(onFlush).not.toHaveBeenCalled()

    // Also exited is null (as if child never died) — still should not
    // fire while compactInProgress=true.
    expect(compactInProgress).toBe(true)
  })

  it('does NOT flush twice on subsequent re-renders (body clears pendingDraft)', () => {
    const onFlush = vi.fn()
    let compactInProgress = true
    let exited: number | null = 1
    let setPendingDraftReal: (v: string | null) => void = () => {}

    const { rerender } = renderHook(() => {
      const [pd, setPd] = useState<string | null>(null)
      setPendingDraftReal = setPd
      useAutoFlush(compactInProgress, pd, exited, onFlush, setPd)
      return null
    })

    act(() => { setPendingDraftReal('hi') })
    compactInProgress = false
    exited = null
    rerender()
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Force a spurious re-render — pendingDraft is null now, condition fails.
    rerender()
    rerender()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire if pendingDraft is null (user never typed during compact)', () => {
    const onFlush = vi.fn()
    let compactInProgress = true
    let exited: number | null = null

    const { rerender } = renderHook(() => {
      const [pd, setPd] = useState<string | null>(null)
      useAutoFlush(compactInProgress, pd, exited, onFlush, setPd)
      return null
    })

    compactInProgress = false
    exited = 1
    rerender()
    exited = null
    rerender()
    expect(onFlush).not.toHaveBeenCalled()
  })
})
