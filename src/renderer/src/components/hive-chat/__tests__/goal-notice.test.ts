import { describe, it, expect } from 'vitest'
import { parseGoalNotice, splitGoalCondition, goalCommandArgs } from '../goal-notice'

const REAL = 'work through the plan you presented via ExitPlanMode above, item by item. After finishing each item, briefly state which item you completed and how you verified it (test output, file paths, commit sha). Only consider done when every item is both implemented AND verified. While doing so, follow these standing rules: 1. Start every MR by invoking Skill(dev-workflow) — actually invoke it; do not recite its steps from memory. 2. Test via the remote gate. 3. If there is UI, strictly follow the style guide; do not invent any component or style. 4. Keep code quality high: clear naming, no dead code, and adequate test coverage. 5. Resolve every non-blocking minor issue on your own; only come back to confirm with me once everything is finished, not piecemeal. 6. After opening each MR, act on the AI review verdict: if it flags problems, resolve them; if it reports no problems, merge.'

describe('parseGoalNotice', () => {
  it('recognises the three replies Claude Code gives to /goal', () => {
    expect(parseGoalNotice(`Goal set: ${REAL}`)).toEqual({ kind: 'set', condition: REAL })
    expect(parseGoalNotice('Goal cleared: ship it')).toEqual({ kind: 'cleared', condition: 'ship it' })
    expect(parseGoalNotice('Goal cleared')).toEqual({ kind: 'cleared', condition: '' })
    expect(parseGoalNotice('No goal set')).toEqual({ kind: 'none' })
  })
  it('leaves ordinary replies alone', () => {
    expect(parseGoalNotice('The goal set by the team is…')).toBeNull()
    expect(parseGoalNotice('I set a goal: finish')).toBeNull()
    expect(parseGoalNotice('')).toBeNull()
  })
})

describe('splitGoalCondition', () => {
  it('splits the real goal into its aim and six rules', () => {
    const parts = splitGoalCondition(REAL)
    expect(parts.intro).toMatch(/^work through the plan/)
    expect(parts.intro).toMatch(/follow these standing rules:$/)
    expect(parts.rules).toHaveLength(6)
    expect(parts.rules[0]).toBe('Start every MR by invoking Skill(dev-workflow) — actually invoke it; do not recite its steps from memory.')
    expect(parts.rules[1]).toBe('Test via the remote gate.')
    expect(parts.rules[5]).toMatch(/^After opening each MR.*merge\.$/)
  })
  it('keeps a goal without a list whole', () => {
    expect(splitGoalCondition('finish the migration and open an MR')).toEqual({ intro: 'finish the migration and open an MR', rules: [] })
  })
  it('does not treat stray numbers as a list', () => {
    expect(splitGoalCondition('ship v2.5 after 1. review').rules).toEqual([])
    expect(splitGoalCondition('steps: 1. build 3. test').rules).toEqual([])
  })
  it('handles a list at the very start and line breaks', () => {
    expect(splitGoalCondition('1. build\n2. test\n3. deploy')).toEqual({ intro: '', rules: ['build', 'test', 'deploy'] })
  })
})

describe('goalCommandArgs', () => {
  it('extracts what was typed after /goal', () => {
    expect(goalCommandArgs('/goal ship it')).toBe('ship it')
    expect(goalCommandArgs('  /goal\nmulti\nline ')).toBe('multi\nline')
    expect(goalCommandArgs('/goal clear')).toBe('clear')
    expect(goalCommandArgs('/goal')).toBe('')
  })
  it('ignores anything else', () => {
    expect(goalCommandArgs('/goals')).toBeNull()
    expect(goalCommandArgs('set a /goal')).toBeNull()
    expect(goalCommandArgs('/compact')).toBeNull()
  })
})
