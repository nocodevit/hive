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
    label: 'Follow the repo dev-workflow each MR (sync → implement → test → bump → commit)',
    rule: 'For every MR, follow the repository dev-workflow end to end — sync the branch, implement, test, bump the version, then commit — never skipping or reordering those steps.'
  },
  {
    key: 'vitest-only',
    label: "Verify with the relevant unit tests only — don't re-run them in the PR check",
    rule: 'Verify changes with the relevant unit tests only; do not duplicate that same test run again inside the PR/CI check step.'
  },
  {
    key: 'styleguide',
    label: "Follow the project's existing UI style guide — don't invent styles",
    rule: "For any UI work, follow the project's existing style guide exactly; do not invent new styles or deviate from it."
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

/**
 * Append the checked standing-rule reminders to the base plan goal as ONE
 * guardrail block. Returns the base text unchanged when nothing is checked, so
 * an empty selection can never alter the goal. Order follows PLAN_REMINDERS (not
 * the set's insertion order) for a stable, deterministic string.
 */
export function appendPlanReminders(basePlanText: string, checkedKeys: ReadonlySet<string>): string {
  const rules = PLAN_REMINDERS.filter((r) => checkedKeys.has(r.key)).map((r) => r.rule)
  if (rules.length === 0) return basePlanText
  const block = rules.map((r, i) => `${i + 1}. ${r}`).join(' ')
  return `${basePlanText}. While doing so, follow these standing rules: ${block}`
}
