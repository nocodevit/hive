import { describe, it, expect } from 'vitest'
import {
  getWorkerSoulAddendum,
  getQaSoulAddendum,
  getManagerSoulAddendum,
  getCriticSoulAddendum,
} from '../souls'

/**
 * v1.7.99: writeAgentDefinition wraps the auto-injected task-group
 * orchestration addendum with <!-- hive:taskgroup:begin v=1 --> ...
 * <!-- hive:taskgroup:end --> per docs/soul-conventions.md §3-4.
 *
 * The markers let tooling locate / refresh / replace the Hive-managed
 * orchestration block without touching user-authored soul above.
 *
 * This file replicates JUST the marker-wrapping logic from
 * src/main/index.ts:writeAgentDefinition (the file uses electron
 * imports we can't pull into vitest cheaply). If the production fn
 * stops wrapping, these tests fail loudly even though the prod path
 * is mocked.
 */
function wrapAddendum(soul: string, taskGroupRole?: string): string {
  let out = soul
  let addendum = ''
  if (taskGroupRole === 'manager') {
    addendum = getManagerSoulAddendum({
      todoSource: 'docs/todo.md',
      reportScriptPath: '.claude/hive-report.sh',
    })
  } else if (taskGroupRole === 'worker') {
    addendum = getWorkerSoulAddendum({ maxRetries: 3, reportScriptPath: '.claude/hive-report.sh' })
  } else if (taskGroupRole === 'qa') {
    addendum = getQaSoulAddendum({ reportScriptPath: '.claude/hive-report.sh' })
  } else if (taskGroupRole === 'critic') {
    addendum = getCriticSoulAddendum({ reportScriptPath: '.claude/hive-report.sh' })
  }
  if (addendum) {
    out += '\n\n<!-- hive:taskgroup:begin v=1 -->\n'
    out += addendum.replace(/^\n+|\n+$/g, '') + '\n'
    out += '<!-- hive:taskgroup:end -->\n'
  }
  return out
}

describe('writeAgentDefinition marker wrapping (v=1)', () => {
  const baseSoul = '# Identity\nYou are Alex.\n\n## Role\nSenior software engineer.\n'

  it('no taskGroupRole → no markers', () => {
    const out = wrapAddendum(baseSoul)
    expect(out).toBe(baseSoul)
    expect(out).not.toContain('hive:taskgroup')
  })

  it('worker → wraps with v=1 markers, content between', () => {
    const out = wrapAddendum(baseSoul, 'worker')
    expect(out).toContain('<!-- hive:taskgroup:begin v=1 -->')
    expect(out).toContain('<!-- hive:taskgroup:end -->')
    expect(out).toContain('Hive Orchestration — Worker')
    // begin must precede end
    const begin = out.indexOf('<!-- hive:taskgroup:begin v=1 -->')
    const end = out.indexOf('<!-- hive:taskgroup:end -->')
    expect(begin).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(begin)
  })

  it('qa → wraps QA addendum', () => {
    const out = wrapAddendum(baseSoul, 'qa')
    expect(out).toContain('<!-- hive:taskgroup:begin v=1 -->')
    expect(out).toContain('Hive Orchestration — QA')
    expect(out).toContain('<!-- hive:taskgroup:end -->')
  })

  it('manager → wraps Manager addendum', () => {
    const out = wrapAddendum(baseSoul, 'manager')
    expect(out).toContain('<!-- hive:taskgroup:begin v=1 -->')
    expect(out).toContain('Hive Orchestration — Manager')
    expect(out).toContain('<!-- hive:taskgroup:end -->')
  })

  it('critic → wraps Critic addendum', () => {
    const out = wrapAddendum(baseSoul, 'critic')
    expect(out).toContain('<!-- hive:taskgroup:begin v=1 -->')
    expect(out).toContain('Hive Orchestration — Critic')
    expect(out).toContain('<!-- hive:taskgroup:end -->')
  })

  it('user soul stays above markers untouched (no leakage)', () => {
    const customSoul = '# Identity\nMy custom identity.\n\n## Role\nSpecialist.\n## Lesson Learnt\n- never delete prod data\n'
    const out = wrapAddendum(customSoul, 'worker')
    const beginIdx = out.indexOf('<!-- hive:taskgroup:begin v=1 -->')
    const userPart = out.slice(0, beginIdx)
    expect(userPart).toContain('My custom identity')
    expect(userPart).toContain('never delete prod data')
    expect(userPart).not.toContain('Hive Orchestration')
  })

  it('begin / end each on own line (per spec §3.98)', () => {
    const out = wrapAddendum(baseSoul, 'worker')
    expect(out).toMatch(/(^|\n)<!-- hive:taskgroup:begin v=1 -->\n/)
    expect(out).toMatch(/\n<!-- hive:taskgroup:end -->\n?/)
  })

  it('exactly one begin / end pair (per spec §3.99)', () => {
    const out = wrapAddendum(baseSoul, 'qa')
    const beginCount = (out.match(/<!-- hive:taskgroup:begin/g) || []).length
    const endCount = (out.match(/<!-- hive:taskgroup:end/g) || []).length
    expect(beginCount).toBe(1)
    expect(endCount).toBe(1)
  })
})
