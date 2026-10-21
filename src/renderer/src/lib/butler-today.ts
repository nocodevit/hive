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

/** The summary without its headline line, which the folded row already shows. */
export function summaryBody(summary: string): string {
  const lines = summary.split('\n')
  const i = lines.findIndex(l => l.trim() && !l.trim().startsWith('>'))
  return i < 0 ? summary : [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim()
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

export interface MeetingLine { start: string | null; end: string | null; title: string }

/** "- 14:00–14:30 Review" / "- all day Birthday" lines from the journal's Meetings section. */
export function meetingLines(text: string): MeetingLine[] {
  return text.split('\n').map(l => l.trim().replace(/^[-*]\s*/, '')).filter(Boolean).flatMap(l => {
    const m = /^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})\s+(.+)$/.exec(l)
    if (m) return [{ start: m[1], end: m[2], title: m[3] }]
    const a = /^all day\s+(.+)$/i.exec(l)
    return a ? [{ start: null, end: null, title: a[1] }] : []
  })
}

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** The next (or current) timed meeting: "in 50 min · 30 min" / "now · 15 min left". */
export function nextMeeting(lines: MeetingLine[], now: Date): { m: MeetingLine; when: string } | null {
  const n = now.getHours() * 60 + now.getMinutes()
  const m = lines.find(x => x.start && x.end && mins(x.end) > n)
  if (!m || !m.start || !m.end) return null
  const s = mins(m.start), e = mins(m.end)
  const left = (x: number) => (x >= 60 ? `${Math.floor(x / 60)}h${x % 60 ? ` ${x % 60}m` : ''}` : `${x} min`)
  return { m, when: s <= n ? `now · ${left(e - n)} left` : `in ${left(s - n)} · ${left(e - s)}` }
}
