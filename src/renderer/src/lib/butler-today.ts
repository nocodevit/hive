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

export type RoutineState = 'ran' | 'failed' | 'next' | 'missed' | 'off'

interface RoutineLike {
  enabled: boolean
  schedule: { kind: 'times'; times: string[] } | { kind: 'interval'; everyMin: number; fromHour: number; toHour: number }
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const at = (now: Date, t: string) => { const [h, m] = t.split(':').map(Number); const d = new Date(now); d.setHours(h, m, 0, 0); return d }

/** Where a routine stands today: ran / failed (with time), next (time), missed, off. */
export function routineToday(r: RoutineLike, weekdays: number[], last: { at: number; ok: boolean; late?: boolean } | undefined, now: Date): { state: RoutineState; label: string } {
  if (!r.enabled) return { state: 'off', label: 'off' }
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const ranToday = last && last.at >= start.getTime() ? last : undefined
  const wd = now.getDay() === 0 ? 7 : now.getDay()
  const slots = !weekdays.includes(wd) ? [] : r.schedule.kind === 'times'
    ? r.schedule.times.map(t => at(now, t))
    : Array.from({ length: Math.max(0, Math.floor((r.schedule.toHour - r.schedule.fromHour) * 60 / r.schedule.everyMin) + 1) },
      (_, i) => { const d = new Date(start); d.setHours((r.schedule as { fromHour: number }).fromHour, i * (r.schedule as { everyMin: number }).everyMin); return d })
  const next = slots.find(d => d > now)
  if (ranToday) {
    const when = hm(new Date(ranToday.at))
    const tail = next && r.schedule.kind === 'interval' ? ` · next ${hm(next)}` : ''
    return ranToday.ok ? { state: 'ran', label: `ran ${when}${ranToday.late ? ' (late)' : ''}${tail}` } : { state: 'failed', label: `failed ${when}${tail}` }
  }
  if (!slots.length) return { state: 'off', label: 'not today' }
  if (slots[0] > now) return { state: 'next', label: `next ${hm(slots[0])}` }
  return next ? { state: 'missed', label: `missed ${hm(slots.filter(d => d <= now).pop()!)} · next ${hm(next)}` } : { state: 'missed', label: `missed ${hm(slots[slots.length - 1])}` }
}
