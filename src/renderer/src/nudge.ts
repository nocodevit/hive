// "Nudge all agents" — for a project, inject a uniform "keep going" message into
// every agent that has an ACTIVE session. Purpose: on a flaky connection an
// agent's turn can silently stall (a dropped stream, a rate-limit pause that
// never got re-poked); a nudge re-pokes every live one at once so the user
// doesn't have to click into each chat and retype the same thing.
//
// Only agents WITH an active session are nudged — a nudge is a message into a
// running session, so an agent with no live session has nothing to receive it.

/** The message pushed to each active agent. Deliberately generic + directive. */
export const NUDGE_MESSAGE =
  'Continue where you left off — resume exactly what you were doing and keep going.'

/**
 * The agentIds in `projectId` that have an active session and should be nudged.
 * `isActive(id)` is injected (the renderer passes its live-session predicate) so
 * this stays pure and unit-testable.
 */
export function nudgeTargets(
  agents: ReadonlyArray<{ id: string; projectId?: string }>,
  projectId: string,
  isActive: (id: string) => boolean
): string[] {
  return agents.filter((a) => a.projectId === projectId && isActive(a.id)).map((a) => a.id)
}
