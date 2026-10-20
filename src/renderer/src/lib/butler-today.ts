// Pure helpers for the Butler Today tab and the routine rows.

/** "2026-10-20" → "Tue 20 Oct". */
export function dayTitle(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** First real line of a summary (skips the "> late" note). */
export function headline(summary: string): string {
  return summary.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('>')) ?? ''
}

/** The newest day before `today` in a newest-first list. */
export function previousDay(dates: string[], today: string): string | null {
  return dates.find(d => d < today) ?? null
}

/** launchd weekdays 1..7 (Mon..Sun) with their one-letter chips. */
export const WEEKDAY_CHIPS: Array<[number, string]> = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [7, 'S']]

export function toggleWeekday(days: number[], d: number): number[] {
  return days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort()
}
