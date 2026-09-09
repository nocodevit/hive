/**
 * Standing-rule reminders for the "Execute the plan I approved above" handoff
 * preset (HandoffModal). The user kept retyping the same fixed instructions in
 * the Custom box every handoff; these turn that recurring block into fixed,
 * default-on checkboxes that appear only when the `plan` preset is selected.
 *
 * Framing matters: each reminder is an OPERATING RULE appended INSIDE the single
 * plan goal — NOT a separate goal. /goal joins separate goals with "AND ALSO"
 * and its Haiku evaluator treats each as a verifiable done-condition. "Keep code
 * quality high" is not something the evaluator can independently verify, so as a
 * standalone goal it would burn turns forever. As a guardrail inside the plan
 * goal it simply steers behavior without gating completion.
 */
export interface PlanReminder {
  /** Stable id used for checkbox state + tests. */
  key: string
  /** Short text shown next to the checkbox. */
  label: string
  /** The operating rule appended to the plan goal when checked. */
  rule: string
}

// Wording is intentionally GENERIC (no project-specific names like a particular
// style guide or workflow), so these read sensibly for any agent/repo.
export const PLAN_REMINDERS: PlanReminder[] = [
  {
    key: 'dev-workflow',
    // The label deliberately does NOT list the steps. The previous wording
    // spelled out "sync → implement → test → bump → commit", and an agent read
    // that enumeration AS the workflow: it never opened the skill, so the
    // self-review step — which is IN the skill and not in the list — was
    // skipped on 18 consecutive MRs and the external reviewer caught what it
    // should have. A partial restatement of a sequence is the thing that gets
    // followed, because it is nearer and cheaper than the source.
    label: 'Invoke the repo dev-workflow skill for every MR — every step, in order',
    rule: 'Start every MR by invoking Skill(dev-workflow) — actually invoke it; do not recite its steps from memory.'
  },
  {
    key: 'styleguide',
    label: "If there is UI, strictly follow the style guide — don't invent components or styles",
    rule: 'If there is UI, strictly follow the style guide; do not invent any component or style.'
  },
  {
    key: 'code-quality',
    label: 'Keep code quality high',
    rule: 'Keep code quality high: clear naming, no dead code, and adequate test coverage.'
  },
  {
    key: 'batch-confirm',
    label: 'Handle all non-blocking minor issues yourself, then confirm once at the end',
    rule: 'Resolve every non-blocking minor issue on your own; only come back to confirm with me once everything is finished, not piecemeal.'
  },
  {
    key: 'ai-review',
    label: 'After the MR, act on the AI review verdict (fix issues, or merge if clean)',
    rule: 'After opening each MR, act on the AI review verdict: if it flags problems, resolve them; if it reports no problems, merge.'
  }
]

/** Every reminder key — the default-checked set (all reminders on by default). */
export const DEFAULT_REMINDER_KEYS: readonly string[] = PLAN_REMINDERS.map((r) => r.key)

// "How to test" is a single CHOICE, not a checkbox — the user picks ONE way the
// agent should verify. 'other' takes free text. The chosen method's rule is
// injected into the plan goal (right after the dev-workflow rule).
export interface TestMethod {
  key: string
  label: string
  /** Goal text for this method; empty for 'other' (the custom text is used). */
  rule: string
}
export const TEST_METHODS: TestMethod[] = [
  { key: 'local', label: 'Local pr:check', rule: 'Test by running the local pr:check.' },
  { key: 'remote', label: 'Remote gate', rule: 'Test via the remote gate.' },
  { key: 'other', label: 'Other', rule: '' }
]
export const DEFAULT_TEST_METHOD = 'local'

/**
 * The goal text for the chosen test method. For 'other', the trimmed custom text
 * is used; a blank custom text yields '' (nothing injected). Pure/testable.
 */
export function resolveTestRule(methodKey: string, customText?: string): string {
  if (methodKey === 'other') return (customText || '').trim()
  const m = TEST_METHODS.find((t) => t.key === methodKey)
  return m ? m.rule : ''
}

/**
 * Append the checked standing-rule reminders to the base plan goal as ONE
 * guardrail block. Returns the base text unchanged when nothing is checked, so
 * an empty selection can never alter the goal. Order follows PLAN_REMINDERS (not
 * the set's insertion order) for a stable, deterministic string.
 *
 * `customRule` is the user's own one-off rule for this run, typed into the
 * "Custom rule" box under the standing list. It is appended LAST so the fixed
 * rules keep their stable numbering no matter what is typed, and it is treated
 * as absent when blank — an empty or whitespace-only box must never add a
 * dangling numbered item. It carries no checkbox of its own: typing text is the
 * opt-in, clearing it is the opt-out.
 */
export function appendPlanReminders(
  basePlanText: string,
  checkedKeys: ReadonlySet<string>,
  customRule?: string,
  testRule?: string
): string {
  const rules = PLAN_REMINDERS.filter((r) => checkedKeys.has(r.key)).map((r) => r.rule)
  // The chosen "how to test" rule sits right after dev-workflow (index 0), so it
  // reads as rule 2 — matching the standing-rules ordering the user set. splice
  // at 1 lands at the end when the list is shorter, so it's always included.
  const test = (testRule || '').trim()
  if (test) rules.splice(1, 0, test)
  const custom = (customRule || '').trim()
  if (custom) rules.push(custom)
  if (rules.length === 0) return basePlanText
  const block = rules.map((r, i) => `${i + 1}. ${r}`).join(' ')
  return `${basePlanText}. While doing so, follow these standing rules: ${block}`
}
