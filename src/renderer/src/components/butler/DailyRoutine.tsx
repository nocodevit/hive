import { useEffect, useState, type MutableRefObject } from 'react'
import { ROUTINE_DESC, ROUTINE_IDS, ROUTINE_NAME, ROUTINE_SKILL, scheduleLabel, type RoutineId, type RoutineSettings, type RoutinesView } from '../../../../shared/butler-routines'
import { openSkill } from '../../lib/butler-skills'
import { WEEKDAY_CHIPS, toggleWeekday } from '../../lib/butler-today'

type View = RoutinesView & { saved: boolean; errors?: Record<string, string> }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 24-hour "HH:MM" text box. The native time input renders AM/PM by locale
 * and clipped it ("08:30 A"); this one is fixed-width and always fits.
 */
function TimeBox({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const bad = !HHMM.test(text)
  const commit = () => { if (!bad && text !== value) onCommit(text); if (bad) setText(value) }
  return (
    <input value={text} aria-label={label} inputMode="numeric" maxLength={5} placeholder="08:30"
      onChange={e => setText(e.target.value.replace(/[^\d:]/g, ''))}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={`w-[58px] px-1.5 py-0.5 rounded-md bg-bg-secondary border text-[12px] font-mono text-center text-text-primary focus:outline-none ${bad ? 'border-red-400' : 'border-border focus:border-accent'}`} />
  )
}

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
          <div key={id} className="flex items-center gap-2.5 text-[13px] flex-wrap">
            <input type="checkbox" checked={r.enabled} disabled={busy} aria-label={ROUTINE_NAME[id]}
              onChange={e => setRoutine(id, { enabled: e.target.checked })} className="accent-accent cursor-pointer" />
            <span className="flex-1 min-w-[160px]">
              <span className="block text-text-primary">{ROUTINE_NAME[id]}</span>
              <span className="block text-[11px] text-text-muted">{ROUTINE_DESC[id]}</span>
            </span>
            {ROUTINE_SKILL[id] && (
              <button onClick={() => openSkill(ROUTINE_SKILL[id])} aria-label={`${ROUTINE_NAME[id]} skill`}
                className="text-[11px] font-semibold text-accent cursor-pointer">Skill ›</button>
            )}
            {r.schedule.kind === 'times' ? (
              <span className="flex gap-1 flex-wrap justify-end">
                {r.schedule.times.map((t, i) => (
                  <TimeBox key={i} value={t} label={`${ROUTINE_NAME[id]} time ${i + 1}`}
                    onCommit={v => {
                      if (r.schedule.kind !== 'times') return
                      const times = [...r.schedule.times]; times[i] = v
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
