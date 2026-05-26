/**
 * Pure helpers for HiveChat's `usage` state shape.
 *
 * Why this exists: the `chat:usage` IPC broadcast can fire with partial
 * data — e.g. ccusage returns cost/burn even when the /usage TUI scrape
 * (queryUsagePctViaPty) times out and returns null. Previously the
 * renderer did `setUsage(u as any)`, which REPLACED state wholesale and
 * therefore wiped the still-valid fiveHour/sevenDay percentages every
 * time a cc-only broadcast arrived. Symptom: the % bars flick to `—`
 * for ~30s after every compact / message_stop refresh, and stay there
 * if the next PTY scrape also fails.
 *
 * Fix: merge incoming partial updates instead of replacing wholesale.
 * Reset sites (user clicked "start new session") use preserveAccountUsage
 * to drop session/cost fields but keep the account-level subscription %
 * fields visible — those are account-scoped, don't change with the
 * session swap, and clearing them just makes the bar briefly show `—`
 * for no UX benefit while waiting for the post-startup refresh.
 */

export interface UsageState {
  costUSD?: number
  burnPerHour?: number
  projectedUSD?: number
  remainingMinutes?: number
  totalTokens?: number
  fiveHour?: number
  sevenDay?: number
  fiveHourReset?: string
  sevenDayReset?: string
}

/**
 * Merge an incoming partial usage update into prior state. Incoming
 * fields win over prior ones (so a fresh number replaces a stale one),
 * but missing fields preserve prior values — so cc-only broadcasts
 * don't wipe fiveHour/sevenDay.
 */
export function mergeUsage(prev: UsageState, incoming: UsageState): UsageState {
  return { ...prev, ...incoming }
}

/**
 * Drop session/cost-scoped fields but keep account-level subscription
 * %% fields. Used when the user explicitly starts a new session — the
 * 5h/7d %% are account-scoped and don't change with the session swap,
 * so clearing them only causes the bar to briefly show `—` while
 * waiting for the post-startup refresh to repopulate.
 */
export function preserveAccountUsage(prev: UsageState): UsageState {
  const out: UsageState = {}
  if (prev.fiveHour !== undefined) out.fiveHour = prev.fiveHour
  if (prev.sevenDay !== undefined) out.sevenDay = prev.sevenDay
  if (prev.fiveHourReset !== undefined) out.fiveHourReset = prev.fiveHourReset
  if (prev.sevenDayReset !== undefined) out.sevenDayReset = prev.sevenDayReset
  return out
}
