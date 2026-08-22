import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v2.5.3 Nancy incident (2026-08-22): user pressed Stop, only ONE
 * interruptSession fired but /goal kept looping (interrupt cancels
 * the current turn; /goal fires the next turn on the tick after).
 * User then typed 15 stop messages that all got consumed as
 * /goal-loop input feeding claude to continue.
 *
 * Fix: stopHandoff now escalates
 *   1. sendUserMessage(chatId, '/goal clear')
 *   2. interruptSession(chatId)
 *   3. 5s fallback → stopChat(chatId) if any new result event lands
 *
 * Source-file assertions lock the escalation order (real E2E of a
 * runaway /goal loop can't run in vitest without spawning claude).
 */

const HANDOFF_TS = readFileSync(join(__dirname, '..', 'handoff.ts'), 'utf-8')

describe('stopHandoff v2.5.3 three-stage escalation', () => {
  it('imports stopChat from chat.ts (nuclear-option dependency)', () => {
    expect(HANDOFF_TS).toMatch(/import\s+\{[^}]*stopChat[^}]*\}\s+from\s+'\.\/chat'/)
  })

  it('stopHandoff sends "/goal clear" via sendUserMessage BEFORE interrupt', () => {
    // Order matters: /goal clear only lands if claude gets a chance to
    // parse it on the next turn boundary. Firing interrupt first could
    // kill the child before the clear message is queued.
    const stopFn = HANDOFF_TS.match(/export function stopHandoff[\s\S]*?^\}/m)
    expect(stopFn, 'stopHandoff not found').not.toBeNull()
    const body = stopFn![0]
    const clearIdx = body.indexOf(`sendUserMessage(h.config.chatId, '/goal clear')`)
    const interruptIdx = body.indexOf('interruptSession(h.config.chatId)')
    expect(clearIdx, '"/goal clear" not sent').toBeGreaterThan(-1)
    expect(interruptIdx, 'interruptSession not called').toBeGreaterThan(-1)
    expect(clearIdx, '/goal clear must come BEFORE interrupt').toBeLessThan(interruptIdx)
  })

  it('stopHandoff arms a fallback that hard-kills if /goal keeps advancing turns', () => {
    // Fallback fn `armGoalKillFallback` scheduled after interrupt.
    expect(HANDOFF_TS).toMatch(/armGoalKillFallback\(runId\)/)
    // Fallback function body references stopChat + a setTimeout window.
    const fallback = HANDOFF_TS.match(/function armGoalKillFallback[\s\S]*?^\}/m)
    expect(fallback, 'armGoalKillFallback not defined').not.toBeNull()
    expect(fallback![0]).toMatch(/setTimeout/)
    expect(fallback![0]).toMatch(/stopChat\(chatId\)/)
    // 5s window (5000ms) — matches design (Nancy log showed loop
    // completed one turn ~every 30-60s, so 5s is tight enough to
    // detect but generous enough for network / API round-trip).
    expect(fallback![0]).toMatch(/5[_,]?000/)
  })

  it('stopHandoff transitions status → stopped BEFORE firing the escalation', () => {
    // Otherwise a race between the fallback and finalize could leave
    // the state showing running while the process is dying.
    const stopFn = HANDOFF_TS.match(/export function stopHandoff[\s\S]*?^\}/m)![0]
    const statusIdx = stopFn.indexOf(`status = 'stopped'`)
    const clearIdx = stopFn.indexOf('sendUserMessage')
    expect(statusIdx, 'status flip not found').toBeGreaterThan(-1)
    expect(statusIdx, 'status must flip before escalation').toBeLessThan(clearIdx)
  })

  it('stopHandoff covers all three live statuses (running / paused / compacting)', () => {
    const stopFn = HANDOFF_TS.match(/export function stopHandoff[\s\S]*?^\}/m)![0]
    expect(stopFn).toMatch(/status === 'running'/)
    expect(stopFn).toMatch(/status === 'paused'/)
    // v2.5.3: compacting was added so a stop mid-compact also escalates.
    expect(stopFn).toMatch(/status === 'compacting'/)
  })
})
