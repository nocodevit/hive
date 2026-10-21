import { useEffect, useState } from 'react'
import { ROUTINE_DESC, ROUTINE_IDS, ROUTINE_NAME, type JournalDay, type RoutinesView } from '../../../../shared/butler-routines'
import { dayTitle, headline, previousDay, routineToday, shiftDate, type RoutineState } from '../../lib/butler-today'

const STATE_CLS: Record<RoutineState, string> = {
  ran: 'text-status-working', failed: 'text-status-waiting', missed: 'text-status-waiting', next: 'text-text-muted', off: 'text-text-muted'
}

const PILL: Record<'draft' | 'jira', { text: string; cls: string }> = {
  draft: { text: 'draft', cls: 'bg-accent-subtle text-accent' },
  jira: { text: 'Jira', cls: 'bg-bg-secondary text-text-muted' }
}

/** Butler → Today: the plan from the journal (ticking writes back), yesterday folded. */
export function TodayTab({ visible }: { visible: boolean }) {
  const [today, setToday] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<JournalDay | null>(null)
  const [prev, setPrev] = useState<JournalDay | null>(null)
  const [dates, setDates] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [running, setRunning] = useState(false)
  const [routines, setRoutines] = useState<RoutinesView | null>(null)

  const load = async (d?: string) => {
    const j = await window.api.journal.day(d)
    const all = await window.api.journal.dates()
    if (!d) setToday(j.date)
    window.api.routines.get().then((v: RoutinesView) => setRoutines(v)).catch(() => {})
    setDate(j.date); setDay(j); setDates(all)
    const p = previousDay(all, j.date)
    setPrev(p ? await window.api.journal.day(p) : null)
  }
  useEffect(() => { if (visible) void load(date && date !== today ? date : undefined).catch(() => {}) }, [visible])

  if (!day || !date) return null
  const toggle = async (index: number, text: string, done: boolean) => {
    setDay({ ...day, plan: day.plan.map(i => i.index === index ? { ...i, done } : i) })
    const r = await window.api.journal.toggle(date, index, text, done)
    if (!r.ok) void load(date)
  }
  const makePlan = async () => {
    setRunning(true)
    await window.api.routines.run('morning-plan').catch(() => {})
    setRunning(false)
    void load()
  }
  const prevTitle = prev ? (date === today && prev.date === shiftDate(date, -1) ? 'Yesterday' : dayTitle(prev.date)) : ''
  const prevLine = prev ? headline(prev.summary) : ''

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-1.5">
      {day.meetings && (
        <div className="rounded-xl bg-bg-primary px-3 py-2" aria-label="Meetings">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Meetings · {dayTitle(date)}</div>
          <div className="mt-1 text-[12px] text-text-primary whitespace-pre-wrap">{day.meetings}</div>
        </div>
      )}
      {routines && date === today && (
        <div className="rounded-xl bg-bg-primary px-3 py-2" aria-label="Routines">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Routines</div>
          {ROUTINE_IDS.map(id => {
            const r = routineToday(routines.settings.routines[id], routines.settings.weekdays, routines.lastRuns[id], new Date())
            return (
              <div key={id} className="mt-1 flex items-center gap-2 text-[12px]" title={ROUTINE_DESC[id]}>
                <span className="flex-1 min-w-0 truncate text-text-primary">{ROUTINE_NAME[id]}</span>
                <span className={STATE_CLS[r.state]} title={r.state === 'failed' ? routines.lastRuns[id]?.error : undefined}>{r.label}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Plan · {dayTitle(date)}</span>
        {day.planLate && <span className="px-1.5 py-0.5 rounded-md bg-bg-primary text-[10px] font-semibold text-status-waiting" title={day.planLate}>late</span>}
        {date !== today && <button onClick={() => load()} className="text-[11px] font-semibold text-accent cursor-pointer">Today</button>}
      </div>
      {day.plan.map(it => (
        <label key={`${it.index}-${it.text}`} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-bg-primary text-[13px] cursor-pointer">
          <input type="checkbox" checked={it.done} onChange={e => toggle(it.index, it.text, e.target.checked)} className="accent-accent cursor-pointer" />
          <span className={`flex-1 min-w-0 ${it.done ? 'line-through text-text-muted' : 'text-text-primary'}`}>{it.text}</span>
          {it.source && <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${PILL[it.source].cls}`}>{PILL[it.source].text}</span>}
        </label>
      ))}
      {!day.plan.length && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-primary text-[13px]">
          <span className="flex-1 text-text-muted">No plan yet</span>
          {date === today && <button onClick={makePlan} disabled={running} className="px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">{running ? '…' : 'Make plan'}</button>}
        </div>
      )}
      {day.jira && (
        <details className="rounded-xl bg-bg-primary px-3 py-2" aria-label="Jira">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted truncate">Jira · {headline(day.jira)}</summary>
          <div className="mt-1.5 text-[12px] text-text-primary whitespace-pre-wrap">{day.jira}</div>
        </details>
      )}
      {day.butler && (
        <details className="rounded-xl bg-bg-primary px-3 py-2" aria-label="Butler today">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted truncate">Butler today · {headline(day.butler)}</summary>
          <div className="mt-1.5 text-[12px] text-text-primary whitespace-pre-wrap">{day.butler}</div>
        </details>
      )}
      {day.feishu && (
        <details className="rounded-xl bg-bg-primary px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">@ you on Feishu</summary>
          <div className="mt-1.5 text-[12px] text-text-primary whitespace-pre-wrap">{day.feishu}</div>
        </details>
      )}
      {day.summary && (
        <details className="rounded-xl bg-bg-primary px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted truncate">Summary · {headline(day.summary)}</summary>
          <div className="mt-1.5 text-[12px] text-text-primary whitespace-pre-wrap">{day.summary}</div>
        </details>
      )}
      {prev && prev.summary && (
        <details className="rounded-xl bg-bg-primary px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted truncate">{prevTitle} · {prevLine}</summary>
          <div className="mt-1.5 text-[12px] text-text-primary whitespace-pre-wrap">{prev.summary}</div>
        </details>
      )}
      {dates.some(d => d !== date) && (
        picking ? (
          <select autoFocus aria-label="Older days" value="" onBlur={() => setPicking(false)}
            onChange={e => { setPicking(false); if (e.target.value) void load(e.target.value) }}
            className="self-start px-2 py-1 rounded-lg bg-bg-primary border border-border text-[12px] text-text-primary">
            <option value="">Pick a day</option>
            {dates.filter(d => d !== date).map(d => <option key={d} value={d}>{dayTitle(d)}</option>)}
          </select>
        ) : (
          <button onClick={() => setPicking(true)} className="self-start px-1 text-[12px] font-semibold text-text-muted hover:text-text-primary cursor-pointer">‹ Older days</button>
        )
      )}
    </div>
  )
}
