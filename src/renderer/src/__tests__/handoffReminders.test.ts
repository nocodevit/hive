import { describe, it, expect } from 'vitest'
import {
  PLAN_REMINDERS,
  DEFAULT_REMINDER_KEYS,
  appendPlanReminders
} from '../components/handoffReminders'

const PLAN_BASE =
  'work through the plan you presented via ExitPlanMode above, item by item'

describe('PLAN_REMINDERS', () => {
  it('captures the six standing reminders the user dictated', () => {
    expect(PLAN_REMINDERS.map((r) => r.key)).toEqual([
      'dev-workflow',
      'vitest-only',
      'styleguide',
      'code-quality',
      'batch-confirm',
      'ai-review'
    ])
  })

  it('has unique keys and non-empty label + rule for each', () => {
    const keys = PLAN_REMINDERS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of PLAN_REMINDERS) {
      expect(r.label.trim().length).toBeGreaterThan(0)
      expect(r.rule.trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps wording GENERIC — no project-specific proper nouns leak in', () => {
    // Guards the user's "措辞尽量通用" decision: these must not name a specific
    // project's styleguide/workflow so they read sensibly for any agent.
    const all = PLAN_REMINDERS.map((r) => `${r.label} ${r.rule}`).join(' ').toLowerCase()
    expect(all).not.toContain('cube')
  })
})

describe('DEFAULT_REMINDER_KEYS', () => {
  it('is EVERY reminder — all default-checked', () => {
    expect([...DEFAULT_REMINDER_KEYS]).toEqual(PLAN_REMINDERS.map((r) => r.key))
  })
})

describe('appendPlanReminders', () => {
  it('returns the base goal UNCHANGED when nothing is checked', () => {
    expect(appendPlanReminders(PLAN_BASE, new Set())).toBe(PLAN_BASE)
  })

  it('appends checked reminders as ONE guardrail block, not separate goals', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(DEFAULT_REMINDER_KEYS))
    expect(out.startsWith(PLAN_BASE)).toBe(true)
    expect(out).toContain('standing rules')
    // Every rule text is present, numbered.
    for (const r of PLAN_REMINDERS) expect(out).toContain(r.rule)
    expect(out).toContain('1. ')
    expect(out).toContain('6. ')
    // Must NOT introduce a separate /goal condition (that joiner is "AND ALSO").
    expect(out).not.toContain('AND ALSO')
  })

  it('includes only the checked subset, ordered by PLAN_REMINDERS not set order', () => {
    // Insert out of declaration order; output must still be styleguide before ai-review.
    const out = appendPlanReminders(PLAN_BASE, new Set(['ai-review', 'styleguide']))
    const styleRule = PLAN_REMINDERS.find((r) => r.key === 'styleguide')!.rule
    const aiRule = PLAN_REMINDERS.find((r) => r.key === 'ai-review')!.rule
    expect(out).toContain(styleRule)
    expect(out).toContain(aiRule)
    expect(out.indexOf(styleRule)).toBeLessThan(out.indexOf(aiRule))
    // Unchecked reminders stay out.
    const qualityRule = PLAN_REMINDERS.find((r) => r.key === 'code-quality')!.rule
    expect(out).not.toContain(qualityRule)
  })

  it('renumbers from 1 for a partial selection', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(['code-quality']))
    expect(out).toContain('1. ')
    expect(out).not.toContain('2. ')
  })
})

describe('appendPlanReminders — custom rule (v2.18.0)', () => {
  it('appends the custom rule LAST so fixed rules keep stable numbers', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(DEFAULT_REMINDER_KEYS), 'never force-push')
    const lastFixed = PLAN_REMINDERS[PLAN_REMINDERS.length - 1].rule
    expect(out).toContain('never force-push')
    expect(out.indexOf(lastFixed)).toBeLessThan(out.indexOf('never force-push'))
    // Six standing + one custom.
    expect(out).toContain('7. never force-push')
  })

  it('works as the ONLY rule when every standing box is unchecked', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(), 'ship behind a feature flag')
    expect(out).toBe(`${PLAN_BASE}. While doing so, follow these standing rules: 1. ship behind a feature flag`)
  })

  it('is ignored when blank — an empty box never adds a dangling item', () => {
    // The box has no checkbox of its own: empty text IS the opt-out, so these
    // must be byte-identical to passing nothing at all.
    const noneChecked = appendPlanReminders(PLAN_BASE, new Set())
    expect(appendPlanReminders(PLAN_BASE, new Set(), '')).toBe(noneChecked)
    expect(appendPlanReminders(PLAN_BASE, new Set(), '   ')).toBe(noneChecked)
    expect(appendPlanReminders(PLAN_BASE, new Set(), '\n\t ')).toBe(noneChecked)
    expect(appendPlanReminders(PLAN_BASE, new Set(), undefined)).toBe(noneChecked)
    // …and must not leave a trailing numbered stub when others ARE checked.
    const one = appendPlanReminders(PLAN_BASE, new Set(['code-quality']), '  ')
    expect(one).toContain('1. ')
    expect(one).not.toContain('2. ')
  })

  it('trims surrounding whitespace off the custom rule', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(), '  keep the diff small  ')
    expect(out).toContain('1. keep the diff small')
    expect(out).not.toContain('1.   keep')
  })

  it('still never introduces a separate /goal condition', () => {
    const out = appendPlanReminders(PLAN_BASE, new Set(DEFAULT_REMINDER_KEYS), 'anything')
    expect(out).not.toContain('AND ALSO')
  })
})
