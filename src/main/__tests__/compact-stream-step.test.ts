// Orphan-notice preemption: claude --resume queues "N background shell
// command task(s) ... have no completion record" ahead of /compact. Its
// $0 result used to settle runCompactViaPrint before /compact ran
// (cube-support, 2026-10-09). Event order below is from a real repro.

import { describe, it, expect } from 'vitest'
import { compactStreamStep } from '../chat'

const run = (events: any[]) => {
  const state = { sawBoundary: false, resultEvent: null as any }
  for (let i = 0; i < events.length; i++) {
    if (compactStreamStep(state, events[i]) === 'done') return { doneAt: i, state }
  }
  return { doneAt: -1, state }
}

const orphanResult = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, duration_ms: 23 }
const compactResult = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.38, duration_ms: 27656 }

describe('compactStreamStep', () => {
  it('waits past the orphan-notice result and settles on the compact result', () => {
    const events = [
      { type: 'system', subtype: 'task_notification' },
      { type: 'system', subtype: 'init' },
      orphanResult,
      { type: 'system', subtype: 'status' },
      { type: 'system', subtype: 'init' },
      { type: 'system', subtype: 'compact_boundary' },
      { type: 'user' },
      compactResult,
    ]
    const { doneAt, state } = run(events)
    expect(doneAt).toBe(7)
    expect(state.resultEvent).toBe(compactResult)
  })

  it('settles on the compact result when nothing is queued ahead', () => {
    const { doneAt, state } = run([{ type: 'system', subtype: 'init' }, { type: 'system', subtype: 'compact_boundary' }, compactResult])
    expect(doneAt).toBe(2)
    expect(state.resultEvent).toBe(compactResult)
  })

  it('settles immediately on an error result', () => {
    const err = { type: 'result', subtype: 'error_during_execution', is_error: true }
    const { doneAt, state } = run([{ type: 'system', subtype: 'init' }, err])
    expect(doneAt).toBe(1)
    expect(state.resultEvent).toBe(err)
  })

  it('keeps the last result for the exit handler when no boundary ever comes', () => {
    const { doneAt, state } = run([{ type: 'system', subtype: 'init' }, orphanResult])
    expect(doneAt).toBe(-1)
    expect(state.sawBoundary).toBe(false)
    expect(state.resultEvent).toBe(orphanResult)
  })

  it('ignores malformed events', () => {
    const { doneAt } = run([null, undefined, {}, { type: 'assistant' }])
    expect(doneAt).toBe(-1)
  })
})
