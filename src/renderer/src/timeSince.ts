// timeSince.ts — v2.8.0 helper for the dept-list agent-row time-since
// chip ("4m", "2h", "1d"). Compact, monospace-friendly, tabular so a
// list of rows lines up. Buckets chosen to avoid noisy "1s / 2s /
// 3s" churn on the live agent — anything under a minute reads as
// "now".
//
// Return values pinned to at-most-3 characters so the chip cell can
// be a fixed 24pt wide slot without reflowing the row on tick.

export function formatTimeSince(sinceMs: number | undefined, nowMs = Date.now()): string {
  if (!sinceMs) return ''  // never seen
  const delta = Math.max(0, nowMs - sinceMs)
  const s = Math.floor(delta / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(d / 365)}y`
}
