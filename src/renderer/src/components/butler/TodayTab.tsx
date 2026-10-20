import { useEffect, useState } from 'react'
import type { JournalDay } from '../../../../shared/butler-routines'
import { dayTitle, headline, previousDay, shiftDate } from '../../lib/butler-today'

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

  const load = async (d?: string) => {
    const j = await window.api.journal.day(d)
    const all = await window.api.journal.dates()
    if (!d) setToday(j.date)
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
      {day.feishu && (
        <details className="rounded-xl bg-bg-primary px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">Feishu</summary>
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
