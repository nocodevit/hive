import { describe, expect, it } from 'vitest'
import { EMPTY_RECALL, pushAfterSend, recallDown, recallUp } from '../recall'

describe('recallUp', () => {
  const hist = ['first', 'second', 'third']  // newest is 'third' (idx 0 when browsing)

  it('returns null on empty history', () => {
    expect(recallUp([], EMPTY_RECALL, '', true)).toBeNull()
  })

  it('returns null when cursor not at top and not browsing', () => {
    expect(recallUp(hist, EMPTY_RECALL, 'some draft', false)).toBeNull()
  })

  it('allows ↑ when cursor not at top BUT already browsing', () => {
    const r = recallUp(hist, { idx: 0, draft: '' }, 'third', false)
    expect(r).not.toBeNull()
    expect(r!.input).toBe('second')
    expect(r!.state.idx).toBe(1)
  })

  it('first ↑ saves current draft and returns newest', () => {
    const r = recallUp(hist, EMPTY_RECALL, 'mid-typing', true)!
    expect(r.input).toBe('third')
    expect(r.state).toEqual({ idx: 0, draft: 'mid-typing' })
  })

  it('second ↑ returns second-most-recent', () => {
    const r = recallUp(hist, { idx: 0, draft: 'saved' }, 'third', true)!
    expect(r.input).toBe('second')
    expect(r.state).toEqual({ idx: 1, draft: 'saved' })
  })

  it('↑ past the oldest entry returns null', () => {
    expect(recallUp(hist, { idx: 2, draft: 'saved' }, 'first', true)).toBeNull()
  })

  it('preserves draft across multiple ↑ steps', () => {
    let state = EMPTY_RECALL
    let input = 'half-typed'
    const a = recallUp(hist, state, input, true)!
    state = a.state; input = a.input
    const b = recallUp(hist, state, input, true)!
    state = b.state; input = b.input
    expect(state.draft).toBe('half-typed')
    expect(input).toBe('second')
  })
})

describe('recallDown', () => {
  const hist = ['first', 'second', 'third']

  it('returns null when not browsing', () => {
    expect(recallDown(hist, EMPTY_RECALL)).toBeNull()
  })

  it('↓ from oldest moves to second-oldest', () => {
    const r = recallDown(hist, { idx: 2, draft: 'saved' })!
    expect(r.input).toBe('second')
    expect(r.state).toEqual({ idx: 1, draft: 'saved' })
  })

  it('↓ from newest restores draft and exits browsing', () => {
    const r = recallDown(hist, { idx: 0, draft: 'my draft' })!
    expect(r.input).toBe('my draft')
    expect(r.state).toEqual(EMPTY_RECALL)
  })

  it('returns null on empty history even if state claims browsing', () => {
    expect(recallDown([], { idx: 0, draft: 'x' })).toBeNull()
  })
})

describe('pushAfterSend', () => {
  it('appends to history and resets state', () => {
    const { history, state } = pushAfterSend(['a', 'b'], 'c', 100)
    expect(history).toEqual(['a', 'b', 'c'])
    expect(state).toEqual(EMPTY_RECALL)
  })

  it('clamps to max, dropping oldest', () => {
    const { history } = pushAfterSend(['a', 'b', 'c'], 'd', 2)
    expect(history).toEqual(['c', 'd'])
  })

  it('no-ops clamp when under max', () => {
    const { history } = pushAfterSend([], 'one', 100)
    expect(history).toEqual(['one'])
  })
})

describe('end-to-end recall flow', () => {
  it('up, up, edit, down, down → restores draft', () => {
    let state = EMPTY_RECALL
    const hist = ['oldest', 'mid', 'newest']
    const originalDraft = 'drafting...'

    // ↑ from drafting → newest, saves draft
    const up1 = recallUp(hist, state, originalDraft, true)!
    state = up1.state
    expect(up1.input).toBe('newest')
    expect(state.draft).toBe(originalDraft)

    // ↑ again → mid
    const up2 = recallUp(hist, state, up1.input, true)!
    state = up2.state
    expect(up2.input).toBe('mid')
    expect(state.draft).toBe(originalDraft)

    // user edits while in history (doesn't affect state)
    // ↓ → back to newest (state.idx: 1 → 0)
    const down1 = recallDown(hist, state)!
    state = down1.state
    expect(down1.input).toBe('newest')
    expect(state.idx).toBe(0)

    // ↓ → restores draft, exits
    const down2 = recallDown(hist, state)!
    state = down2.state
    expect(down2.input).toBe(originalDraft)
    expect(state).toEqual(EMPTY_RECALL)
  })
})
