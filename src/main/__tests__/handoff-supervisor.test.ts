import { describe, it, expect } from 'vitest'
import {
  buildRopePresets,
  goalWithTurnCap,
  parseStreamJsonLine,
  applyEvent,
  checkCircuitBreakers,
  initialState,
  configFromRope,
  formatRemaining,
  type HandoffConfig,
  type HandoffState
} from '../handoff-supervisor'

const T0 = 1_700_000_000_000 // fixed epoch ms so nothing is time-relative

function baseConfig(overrides: Partial<HandoffConfig> = {}): HandoffConfig {
  return {
    runId: 'hnd_1',
    agentId: 'agent-1',
    cwd: '/tmp',
    goal: 'do stuff',
    rope: 'normal',
    maxTurns: 60,
    maxCostUsd: 5,
    maxWallTimeMs: 2 * 60 * 60 * 1000,
    ...overrides
  }
}
function baseState(overrides: Partial<HandoffState> = {}): HandoffState {
  return {
    runId: 'hnd_1',
    agentId: 'agent-1',
    status: 'running',
    turnCount: 0,
    totalCostUsd: 0,
    startedAt: T0,
    elapsedMs: 0,
    ...overrides
  }
}

describe('buildRopePresets', () => {
  it('quick < normal < marathon on every axis', () => {
    const p = buildRopePresets()
    expect(p.quick.maxTurns).toBeLessThan(p.normal.maxTurns)
    expect(p.normal.maxTurns).toBeLessThan(p.marathon.maxTurns)
    expect(p.quick.maxCostUsd).toBeLessThan(p.normal.maxCostUsd)
    expect(p.normal.maxCostUsd).toBeLessThan(p.marathon.maxCostUsd)
    expect(p.quick.maxWallTimeMs).toBeLessThan(p.normal.maxWallTimeMs)
    expect(p.normal.maxWallTimeMs).toBeLessThan(p.marathon.maxWallTimeMs)
  })

  it('normal defaults match documented values ($5 · 60 turn · 2h)', () => {
    const p = buildRopePresets()
    expect(p.normal).toEqual({ maxTurns: 60, maxCostUsd: 5, maxWallTimeMs: 2 * 60 * 60 * 1000 })
  })
})

describe('goalWithTurnCap', () => {
  it('appends the turn clause on its own paragraph', () => {
    expect(goalWithTurnCap('write tests', 30)).toBe('write tests\n\n(or stop after 30 turns)')
  })
  it('strips leading/trailing whitespace before appending', () => {
    expect(goalWithTurnCap('  make it green  \n', 15)).toBe('make it green\n\n(or stop after 15 turns)')
  })
})

describe('parseStreamJsonLine', () => {
  it('parses one valid JSON object', () => {
    expect(parseStreamJsonLine('{"type":"result","total_cost_usd":0.12}')).toEqual({ type: 'result', total_cost_usd: 0.12 })
  })
  it('returns null for blanks', () => {
    expect(parseStreamJsonLine('')).toBeNull()
    expect(parseStreamJsonLine('   \n')).toBeNull()
  })
  it('returns null for garbage', () => {
    expect(parseStreamJsonLine('not-json-at-all')).toBeNull()
    expect(parseStreamJsonLine('{"broken')).toBeNull()
  })
  it('returns null for JSON scalars/arrays — we only accept objects', () => {
    expect(parseStreamJsonLine('42')).toBeNull()
    expect(parseStreamJsonLine('"hello"')).toBeNull()
    expect(parseStreamJsonLine('[1,2,3]')).toBeNull()
  })
})

describe('applyEvent', () => {
  it('increments turnCount + adds cost on a result event', () => {
    const s = applyEvent(baseState(), { type: 'result', total_cost_usd: 0.15 }, T0 + 30_000)
    expect(s.turnCount).toBe(1)
    expect(s.totalCostUsd).toBeCloseTo(0.15, 6)
    expect(s.elapsedMs).toBe(30_000)
  })

  it('leaves turnCount/cost untouched on non-result events (assistant, user, system)', () => {
    for (const type of ['assistant', 'user', 'system']) {
      const s = applyEvent(baseState({ turnCount: 3, totalCostUsd: 0.9 }), { type }, T0 + 5_000)
      expect(s.turnCount).toBe(3)
      expect(s.totalCostUsd).toBeCloseTo(0.9, 6)
      expect(s.elapsedMs).toBe(5_000)
    }
  })

  it('accumulates cost across many result events', () => {
    let s = baseState()
    s = applyEvent(s, { type: 'result', total_cost_usd: 0.1 }, T0 + 1000)
    s = applyEvent(s, { type: 'result', total_cost_usd: 0.2 }, T0 + 2000)
    s = applyEvent(s, { type: 'result', total_cost_usd: 0.3 }, T0 + 3000)
    expect(s.turnCount).toBe(3)
    expect(s.totalCostUsd).toBeCloseTo(0.6, 6)
  })

  it('treats missing / non-numeric total_cost_usd as 0 (still counts the turn)', () => {
    const a = applyEvent(baseState(), { type: 'result' }, T0 + 1000)
    expect(a.turnCount).toBe(1)
    expect(a.totalCostUsd).toBe(0)
    const b = applyEvent(baseState(), { type: 'result', total_cost_usd: 'oops' }, T0 + 1000)
    expect(b.turnCount).toBe(1)
    expect(b.totalCostUsd).toBe(0)
  })

  it('clamps negative cost to 0 (defensive; claude should never emit negative)', () => {
    const s = applyEvent(baseState(), { type: 'result', total_cost_usd: -0.5 }, T0 + 1000)
    expect(s.totalCostUsd).toBe(0)
  })
})

describe('checkCircuitBreakers', () => {
  it('returns trip:false when under all caps', () => {
    const res = checkCircuitBreakers(baseState({ turnCount: 10, totalCostUsd: 1 }), baseConfig(), T0 + 60_000)
    expect(res.trip).toBe(false)
  })

  it('trips on turn cap first when multiple breach', () => {
    const res = checkCircuitBreakers(
      baseState({ turnCount: 60, totalCostUsd: 10 }),
      baseConfig({ maxTurns: 60, maxCostUsd: 5 }),
      T0 + 3 * 60 * 60 * 1000
    )
    expect(res.trip).toBe(true)
    if (res.trip) {
      expect(res.reason).toBe('turns')
      expect(res.detail).toContain('60')
    }
  })

  it('trips on cost when turn cap is fine but cost exceeded', () => {
    const res = checkCircuitBreakers(
      baseState({ turnCount: 5, totalCostUsd: 5.01 }),
      baseConfig({ maxCostUsd: 5 }),
      T0 + 1000
    )
    expect(res.trip).toBe(true)
    if (res.trip) {
      expect(res.reason).toBe('cost')
      expect(res.detail).toContain('$5.00')
      expect(res.detail).toContain('$5.01')
    }
  })

  it('trips on wall-time when turn + cost are fine', () => {
    const res = checkCircuitBreakers(
      baseState({ turnCount: 3, totalCostUsd: 0.5 }),
      baseConfig({ maxWallTimeMs: 60_000 }),
      T0 + 60_001
    )
    expect(res.trip).toBe(true)
    if (res.trip) {
      expect(res.reason).toBe('wall')
      expect(res.detail).toContain('1 min')
    }
  })

  it('does NOT trip at exactly the boundary minus 1', () => {
    const res = checkCircuitBreakers(
      baseState({ turnCount: 59, totalCostUsd: 4.99 }),
      baseConfig({ maxTurns: 60, maxCostUsd: 5, maxWallTimeMs: 100_000 }),
      T0 + 99_999
    )
    expect(res.trip).toBe(false)
  })

  it('DOES trip exactly at the boundary (>= not >)', () => {
    const res = checkCircuitBreakers(
      baseState({ turnCount: 60 }),
      baseConfig({ maxTurns: 60 }),
      T0 + 1000
    )
    expect(res.trip).toBe(true)
  })
})

describe('initialState + configFromRope', () => {
  it('initialState starts running with zero counters', () => {
    const s = initialState(baseConfig(), T0)
    expect(s).toEqual({
      runId: 'hnd_1',
      agentId: 'agent-1',
      status: 'running',
      turnCount: 0,
      totalCostUsd: 0,
      startedAt: T0,
      elapsedMs: 0
    })
  })

  it('configFromRope pulls preset values for the chosen rope', () => {
    const c = configFromRope('hnd_9', 'agent-9', '/tmp/x', 'do it', 'quick')
    expect(c.rope).toBe('quick')
    expect(c.maxTurns).toBe(15)
    expect(c.maxCostUsd).toBe(1)
    expect(c.maxWallTimeMs).toBe(15 * 60 * 1000)
    expect(c.agentId).toBe('agent-9')
    expect(c.goal).toBe('do it')
  })
})

describe('formatRemaining', () => {
  it('shows minutes when < 1 hour left', () => {
    const s = baseState({ startedAt: T0 })
    const c = baseConfig({ maxWallTimeMs: 30 * 60 * 1000 })
    expect(formatRemaining(s, c, T0 + 5 * 60 * 1000)).toBe('~25m left')
  })
  it('shows H when hours only, no minutes', () => {
    const s = baseState({ startedAt: T0 })
    const c = baseConfig({ maxWallTimeMs: 2 * 60 * 60 * 1000 })
    expect(formatRemaining(s, c, T0)).toBe('~2h left')
  })
  it('shows H + M when both', () => {
    const s = baseState({ startedAt: T0 })
    const c = baseConfig({ maxWallTimeMs: 2 * 60 * 60 * 1000 })
    expect(formatRemaining(s, c, T0 + 30 * 60 * 1000)).toBe('~1h 30m left')
  })
  it('clamps to 0m instead of negative when overrun', () => {
    const s = baseState({ startedAt: T0 })
    const c = baseConfig({ maxWallTimeMs: 60_000 })
    expect(formatRemaining(s, c, T0 + 5 * 60 * 1000)).toBe('~0m left')
  })
})
