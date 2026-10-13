import { describe, it, expect } from 'vitest'
import { stopHookFeedback, isGoalClearCommand, shouldPreemptOnSend, hookLoopStep, HOOK_LOOP_IDLE, GOAL_LOOP_STUCK_AFTER, type HookLoopState } from '../../shared/goal-loop'

const userText = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })

describe('stopHookFeedback', () => {
  it('extracts the hook text from a feedback round', () => {
    expect(stopHookFeedback(userText('Stop hook feedback:\n[work through the plan, item by item]'))).toBe('[work through the plan, item by item]')
    expect(stopHookFeedback({ type: 'user', message: { content: 'Stop hook feedback: not done' } })).toBe('not done')
  })
  it('ignores ordinary user text, tool results and other events', () => {
    expect(stopHookFeedback(userText('please stop'))).toBeNull()
    expect(stopHookFeedback(userText('I saw "Stop hook feedback:" in the log'))).toBeNull()
    expect(stopHookFeedback({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'Stop hook feedback: x' }] } })).toBeNull()
    expect(stopHookFeedback({ type: 'assistant', message: { content: [{ type: 'text', text: 'Stop hook feedback: x' }] } })).toBeNull()
    expect(stopHookFeedback(null)).toBeNull()
    expect(stopHookFeedback({ type: 'user' })).toBeNull()
  })
})

describe('isGoalClearCommand', () => {
  it('matches the slash command only', () => {
    expect(isGoalClearCommand('/goal clear')).toBe(true)
    expect(isGoalClearCommand('  /goal   clear \n')).toBe(true)
    expect(isGoalClearCommand('/GOAL CLEAR')).toBe(true)
  })
  it('does not match prose or other goal commands', () => {
    expect(isGoalClearCommand('clear goal!')).toBe(false)
    expect(isGoalClearCommand('/goal clear everything and then deploy')).toBe(false)
    expect(isGoalClearCommand('/goal ship the feature')).toBe(false)
    expect(isGoalClearCommand('please run /goal clear')).toBe(false)
  })
})

describe('hookLoopStep', () => {
  const hook = userText('Stop hook feedback:\n[finish the plan]')
  const say = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const tool = { type: 'assistant', message: { content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', name: 'Bash', input: {} }] } }
  const result = { type: 'result', subtype: 'success' }
  const run = (evs: unknown[], from: HookLoopState = HOOK_LOOP_IDLE) => evs.reduce((s: HookLoopState, e) => hookLoopStep(s, e), from)

  it('counts consecutive hook rounds with nothing done in between', () => {
    expect(run([hook, say('waiting'), hook, say('waiting'), hook]).idleRounds).toBe(3)
  })
  it('a round that follows real work is round 1 again', () => {
    expect(run([hook, say('waiting'), hook, tool, hook]).idleRounds).toBe(1)
    expect(run([tool, hook]).idleRounds).toBe(1)
    expect(run([tool, hook, say('nothing left'), hook]).idleRounds).toBe(2)
  })
  it('resets when the turn ends, but not on a subagent result', () => {
    expect(run([hook, hook, result])).toEqual(HOOK_LOOP_IDLE)
    expect(run([hook, hook, { type: 'result', parent_tool_use_id: 't1' }]).idleRounds).toBe(2)
  })
  it('ignores unrelated events', () => {
    expect(run([{ type: 'system', subtype: 'init' }, { type: 'stream_event' }, null, userText('hello')])).toEqual(HOOK_LOOP_IDLE)
  })
})

describe('shouldPreemptOnSend', () => {
  it('preempts anything once the loop is stuck spinning', () => {
    expect(shouldPreemptOnSend({ text: '先别做了，改做 X', working: true, idleRounds: GOAL_LOOP_STUCK_AFTER })).toBe(true)
    expect(shouldPreemptOnSend({ text: 'clear goal!', working: true, idleRounds: 5 })).toBe(true)
  })
  it('lets an ordinary message wait while the goal is still doing work', () => {
    expect(shouldPreemptOnSend({ text: 'also update the docs', working: true, idleRounds: 0 })).toBe(false)
    expect(shouldPreemptOnSend({ text: 'also update the docs', working: true, idleRounds: 1 })).toBe(false)
  })
  it('preempts /goal clear during any running turn', () => {
    expect(shouldPreemptOnSend({ text: '/goal clear', working: true, idleRounds: 0 })).toBe(true)
  })
  it('never interrupts an idle session', () => {
    expect(shouldPreemptOnSend({ text: '/goal clear', working: false, idleRounds: 0 })).toBe(false)
    expect(shouldPreemptOnSend({ text: 'hi', working: false, idleRounds: 4 })).toBe(false)
  })
})
