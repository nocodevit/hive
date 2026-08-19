import { describe, it, expect } from 'vitest'
import {
  applyEvent,
  beginPause,
  buildRopePresets,
  checkCircuitBreakers,
  composeGoalCondition,
  composeSlashGoalCommand,
  detectAskUserQuestion,
  endPause,
  formatDuration,
  formatRemaining,
  initialState,
  liveElapsedMs,
  parseStreamJsonLine,
  type HandoffBreakers,
  type HandoffConfig,
  type HandoffState
} from '../handoff-supervisor'

const T0 = 1_700_000_000_000

function baseConfig(overrides: Partial<HandoffConfig> = {}): HandoffConfig {
  return {
    runId: 'hnd_1',
    chatId: 'chat-agent-1',
    agentId: 'agent-1',
    goals: ['do stuff'],
    breakers: {
      maxTurns: 60,
      maxCostUsd: 5,
      maxWallTimeMs: 2 * 60 * 60 * 1000
    },
    ...overrides
  }
}

function baseState(overrides: Partial<HandoffState> = {}): HandoffState {
  return {
    runId: 'hnd_1',
    chatId: 'chat-agent-1',
    agentId: 'agent-1',
    status: 'running',
    turnCount: 0,
    totalCostUsd: 0,
    startedAt: T0,
    elapsedMs: 0,
    pausedMs: 0,
    ...overrides
  }
}

describe('buildRopePresets (UI autofill helper)', () => {
  it('quick < normal < marathon on every axis', () => {
    const p = buildRopePresets()
    expect(p.quick.maxTurns).toBeLessThan(p.normal.maxTurns)
    expect(p.normal.maxTurns).toBeLessThan(p.marathon.maxTurns)
    expect(p.quick.maxCostUsd).toBeLessThan(p.normal.maxCostUsd)
    expect(p.normal.maxCostUsd).toBeLessThan(p.marathon.maxCostUsd)
  })
})

describe('composeGoalCondition', () => {
  it('single goal returns as-is', () => {
    expect(composeGoalCondition(['tests pass'], {})).toBe('tests pass')
  })

  it('multiple goals joined with AND ALSO + numbered', () => {
    expect(composeGoalCondition(['tests pass', 'lint clean'], {})).toBe('(1) tests pass AND ALSO (2) lint clean')
  })

  it('appends turn clause when maxTurns is set', () => {
    expect(composeGoalCondition(['x'], { maxTurns: 30 })).toBe('x (or stop after 30 turns)')
  })

  it('no turn clause when maxTurns undefined', () => {
    expect(composeGoalCondition(['x'], { maxCostUsd: 5 })).toBe('x')
  })

  it('empty goals returns empty string', () => {
    expect(composeGoalCondition([], {})).toBe('')
    expect(composeGoalCondition(['   ', '', '\n'], {})).toBe('')
  })

  it('trims whitespace and skips blanks in the list', () => {
    expect(composeGoalCondition(['  a  ', '', 'b'], {})).toBe('(1) a AND ALSO (2) b')
  })
})

describe('composeSlashGoalCommand', () => {
  it('prefixes /goal + composed condition', () => {
    expect(composeSlashGoalCommand(['tests pass'], { maxTurns: 30 })).toBe('/goal tests pass (or stop after 30 turns)')
  })
})

describe('parseStreamJsonLine', () => {
  it('parses one valid object', () => {
    expect(parseStreamJsonLine('{"type":"result","total_cost_usd":0.12}')).toEqual({ type: 'result', total_cost_usd: 0.12 })
  })
  it('returns null for blanks / garbage / scalars', () => {
    expect(parseStreamJsonLine('')).toBeNull()
    expect(parseStreamJsonLine('not-json')).toBeNull()
    expect(parseStreamJsonLine('42')).toBeNull()
    expect(parseStreamJsonLine('[1,2]')).toBeNull()
  })
})

describe('detectAskUserQuestion', () => {
  it('true when assistant event contains tool_use{name:AskUserQuestion}', () => {
    const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'x', input: {} }] } }
    expect(detectAskUserQuestion(ev)).toBe(true)
  })
  it('false when tool_use name is anything else', () => {
    const ev = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }
    expect(detectAskUserQuestion(ev)).toBe(false)
  })
  it('false for user / result / system events', () => {
    expect(detectAskUserQuestion({ type: 'user', message: { content: 'hi' } })).toBe(false)
    expect(detectAskUserQuestion({ type: 'result', total_cost_usd: 0.1 })).toBe(false)
    expect(detectAskUserQuestion({ type: 'system', subtype: 'init' })).toBe(false)
  })
  it('false on malformed content (non-array, missing message)', () => {
    expect(detectAskUserQuestion({ type: 'assistant' })).toBe(false)
    expect(detectAskUserQuestion({ type: 'assistant', message: { content: 'string' } })).toBe(false)
  })
})

describe('applyEvent', () => {
  it('increments turnCount + adds cost on a result event', () => {
    const s = applyEvent(baseState(), { type: 'result', total_cost_usd: 0.15 }, T0 + 30_000)
    expect(s.turnCount).toBe(1)
    expect(s.totalCostUsd).toBeCloseTo(0.15, 6)
    expect(s.elapsedMs).toBe(30_000)
  })

  it('leaves turnCount/cost untouched on non-result events', () => {
    for (const type of ['assistant', 'user', 'system']) {
      const s = applyEvent(baseState({ turnCount: 3, totalCostUsd: 0.9 }), { type }, T0 + 5_000)
      expect(s.turnCount).toBe(3)
      expect(s.totalCostUsd).toBeCloseTo(0.9, 6)
    }
  })

  it('elapsed excludes accumulated pausedMs', () => {
    const s = applyEvent(baseState({ pausedMs: 60_000 }), { type: 'assistant' }, T0 + 90_000)
    expect(s.elapsedMs).toBe(30_000)
  })

  it('elapsed excludes CURRENT pause window (pauseStartedAt set)', () => {
    const s = applyEvent(baseState({ pauseStartedAt: T0 + 30_000 }), { type: 'assistant' }, T0 + 90_000)
    // raw 90s - currentPause 60s = 30s
    expect(s.elapsedMs).toBe(30_000)
  })

  it('clamps negative cost to 0', () => {
    const s = applyEvent(baseState(), { type: 'result', total_cost_usd: -0.5 }, T0 + 1000)
    expect(s.totalCostUsd).toBe(0)
  })

  it('non-numeric total_cost_usd counted as 0 (still increments turn)', () => {
    const s = applyEvent(baseState(), { type: 'result', total_cost_usd: 'nope' }, T0 + 1000)
    expect(s.turnCount).toBe(1)
    expect(s.totalCostUsd).toBe(0)
  })
})

describe('checkCircuitBreakers', () => {
  it('trip:false when under all caps', () => {
    expect(checkCircuitBreakers(baseState({ turnCount: 10, totalCostUsd: 1 }), baseConfig(), T0 + 60_000, false).trip).toBe(false)
  })

  it('askUserQuestion trips first when both askQ and turn cap would trip', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 60 }), baseConfig({ breakers: { maxTurns: 60, stopOnAskUserQuestion: true } }), T0 + 1000, true)
    expect(res.trip).toBe(true)
    if (res.trip) expect(res.reason).toBe('askUserQuestion')
  })

  it('askUserQuestion NOT tripped when the breaker is disabled', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 1 }), baseConfig({ breakers: { maxTurns: 60 } }), T0 + 1000, true)
    expect(res.trip).toBe(false)
  })

  it('turn cap tripping at boundary (>=, not >)', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 60 }), baseConfig({ breakers: { maxTurns: 60 } }), T0 + 1000, false)
    expect(res.trip).toBe(true)
    if (res.trip) expect(res.reason).toBe('turns')
  })

  it('cost cap tripped when turn is fine', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 5, totalCostUsd: 5.01 }), baseConfig({ breakers: { maxCostUsd: 5 } }), T0 + 1000, false)
    expect(res.trip).toBe(true)
    if (res.trip) {
      expect(res.reason).toBe('cost')
      expect(res.detail).toContain('$5.00')
      expect(res.detail).toContain('$5.01')
    }
  })

  it('wall cap uses liveElapsedMs (excludes pause)', () => {
    // 3 hours real elapsed, but 2 hours were paused → live elapsed = 1h → under 2h cap
    const res = checkCircuitBreakers(
      baseState({ pausedMs: 2 * 60 * 60 * 1000 }),
      baseConfig({ breakers: { maxWallTimeMs: 2 * 60 * 60 * 1000 } }),
      T0 + 3 * 60 * 60 * 1000,
      false
    )
    expect(res.trip).toBe(false)
  })

  it('breakers with undefined field are inactive (never trip on that axis)', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 1000, totalCostUsd: 1000 }), baseConfig({ breakers: {} }), T0 + 999_999_999, false)
    expect(res.trip).toBe(false)
  })
})

describe('initialState', () => {
  it('starts running with zero counters + no pause + empty stats', () => {
    expect(initialState(baseConfig(), T0)).toEqual({
      runId: 'hnd_1', chatId: 'chat-agent-1', agentId: 'agent-1',
      status: 'running', turnCount: 0, totalCostUsd: 0,
      startedAt: T0, elapsedMs: 0, pausedMs: 0,
      stats: { filesEdited: [], commits: [], toolErrorsRecovered: 0 }
    })
  })
})

describe('beginPause / endPause', () => {
  it('beginPause flips status to paused + records pauseStartedAt', () => {
    const s = beginPause(baseState(), T0 + 10_000)
    expect(s.status).toBe('paused')
    expect(s.pauseStartedAt).toBe(T0 + 10_000)
  })

  it('beginPause is a no-op if not running', () => {
    const s = beginPause(baseState({ status: 'stopped' }), T0 + 10_000)
    expect(s.status).toBe('stopped')
    expect(s.pauseStartedAt).toBeUndefined()
  })

  it('endPause accumulates pausedMs + clears pauseStartedAt', () => {
    const s = endPause(baseState({ status: 'paused', pauseStartedAt: T0 + 10_000, pausedMs: 5_000 }), T0 + 40_000)
    expect(s.status).toBe('running')
    expect(s.pauseStartedAt).toBeUndefined()
    expect(s.pausedMs).toBe(35_000)
  })

  it('endPause is a no-op if not paused', () => {
    const s = endPause(baseState(), T0 + 1000)
    expect(s.status).toBe('running')
    expect(s.pausedMs).toBe(0)
  })
})

describe('liveElapsedMs', () => {
  it('subtracts pausedMs + current pause window', () => {
    const s = baseState({ pausedMs: 10_000, pauseStartedAt: T0 + 100_000 })
    expect(liveElapsedMs(s, T0 + 300_000)).toBe(300_000 - 10_000 - 200_000)
  })
  it('clamps at 0 (never negative even if pause > elapsed somehow)', () => {
    const s = baseState({ pausedMs: 999_999_999 })
    expect(liveElapsedMs(s, T0 + 1000)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('h m only when hours', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m')
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2h 0m')
  })
  it('m s when under 1h', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
  })
  it('s when under 1m', () => {
    expect(formatDuration(45_000)).toBe('45s')
  })
  it('clamps negatives', () => {
    expect(formatDuration(-1000)).toBe('0s')
  })
})

describe('formatRemaining', () => {
  it('shows minutes when < 1h left', () => {
    const s = baseState()
    const c = baseConfig({ breakers: { maxWallTimeMs: 30 * 60 * 1000 } })
    expect(formatRemaining(s, c, T0 + 5 * 60 * 1000)).toBe('~25m left')
  })
  it('shows h+m when >= 1h', () => {
    const s = baseState()
    const c = baseConfig({ breakers: { maxWallTimeMs: 2 * 60 * 60 * 1000 } })
    expect(formatRemaining(s, c, T0 + 30 * 60 * 1000)).toBe('~1h 30m left')
  })
  it('returns "no wall cap" when maxWallTimeMs undefined', () => {
    expect(formatRemaining(baseState(), baseConfig({ breakers: {} as HandoffBreakers }), T0)).toBe('no wall cap')
  })
})
