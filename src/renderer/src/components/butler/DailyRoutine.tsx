import { useEffect, useState, type MutableRefObject } from 'react'
import { ROUTINE_IDS, ROUTINE_NAME, scheduleLabel, type RoutineId, type RoutineSettings, type RoutinesView } from '../../../../shared/butler-routines'
import { WEEKDAY_CHIPS, toggleWeekday } from '../../lib/butler-today'

type View = RoutinesView & { saved: boolean; errors?: Record<string, string> }

const timeInput = 'w-[76px] px-1.5 py-0.5 rounded-md bg-bg-secondary border border-border text-[12px] font-mono text-text-primary focus:outline-none focus:border-accent'

/** Daily routine rows (settings section and wizard step). Changes apply to launchd at once. */
export function DailyRoutine({ framed = true, commitRef }: { framed?: boolean; commitRef?: MutableRefObject<(() => Promise<void>) | null> }) {
  const [v, setV] = useState<View | null>(null)
  const [draft, setDraft] = useState<RoutineSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.routines.get().then(r => { setV(r); setDraft(r.settings) }).catch(() => {})
  }, [])

  const apply = async (s: RoutineSettings) => {
    setDraft(s)
    if (!v?.saved) return
    setBusy(true)
    const r = await window.api.routines.save(s).catch(() => null)
    setBusy(false)
    if (r) { setV(r); setDraft(r.settings) }
  }
  const turnOn = async () => {
    if (!draft) return
    setBusy(true)
    const r = await window.api.routines.save(draft).catch(() => null)
    setBusy(false)
    if (r) { setV(r); setDraft(r.settings) }
  }
  if (commitRef) commitRef.current = v && !v.saved ? turnOn : null
  const setRoutine = (id: RoutineId, patch: Partial<RoutineSettings['routines'][RoutineId]>) =>
    draft && apply({ ...draft, routines: { ...draft.routines, [id]: { ...draft.routines[id], ...patch } } })

  if (!v || !draft) return null
  const body = (
    <div className="flex flex-col gap-1.5">
      {ROUTINE_IDS.map(id => {
        const r = draft.routines[id]
        const last = v.lastRuns[id]
        const err = v.errors?.[id] || (last && !last.ok ? last.error : '')
        return (
          <div key={id} className="flex items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={r.enabled} disabled={busy} aria-label={ROUTINE_NAME[id]}
              onChange={e => setRoutine(id, { enabled: e.target.checked })} className="accent-accent cursor-pointer" />
            <span className="flex-1 text-text-primary">{ROUTINE_NAME[id]}</span>
            {r.schedule.kind === 'times' ? (
              <span className="flex gap-1">
                {r.schedule.times.map((t, i) => (
                  <input key={i} type="time" value={t} className={timeInput} aria-label={`${ROUTINE_NAME[id]} time ${i + 1}`}
                    onChange={e => {
                      if (r.schedule.kind !== 'times' || !e.target.value) return
                      const times = [...r.schedule.times]; times[i] = e.target.value
                      setRoutine(id, { schedule: { kind: 'times', times } })
                    }} />
                ))}
              </span>
            ) : (
              <span className="text-[12px] font-mono text-text-muted">{scheduleLabel(r.schedule)}</span>
            )}
            <span className="w-4 text-center text-[11px]" title={err || (last ? new Date(last.at).toLocaleString() : '')}>
              {err ? <span className="text-status-waiting">!</span> : last?.ok ? <span className="text-status-working">✓</span> : ''}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-1 pt-1" role="group" aria-label="Days">
        {WEEKDAY_CHIPS.map(([d, l]) => (
          <button key={d} aria-pressed={draft.weekdays.includes(d)} aria-label={`Day ${d}`} disabled={busy}
            onClick={() => apply({ ...draft, weekdays: toggleWeekday(draft.weekdays, d) })}
            className={`w-6 h-6 rounded-md text-[11px] font-bold cursor-pointer ${draft.weekdays.includes(d) ? 'bg-accent-subtle text-accent' : 'bg-bg-primary text-text-muted'}`}>{l}</button>
        ))}
        <span className="flex-1" />
        {!v.saved && framed && <button onClick={turnOn} disabled={busy} className="px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">Turn on</button>}
      </div>
    </div>
  )
  if (!framed) return body
  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Daily routine</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-2.5">{body}</div>
    </div>
  )
}
