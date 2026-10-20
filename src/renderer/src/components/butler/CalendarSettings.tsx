import { useEffect, useState } from 'react'
import type { CalendarSettings as Settings, DayAgenda } from '../../lib/feishu-agent-types'

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Two sources: Feishu calendar (via Feishu sign-in) and Mac Calendar (Allow once). */
export function CalendarConnect() {
  const [s, setS] = useState<Settings | null>(null)
  const [mac, setMac] = useState<'idle' | 'asking' | 'denied'>('idle')
  useEffect(() => { window.api.calendar.get().then(setS).catch(() => {}) }, [])
  if (!s) return null
  const set = async (patch: Partial<Settings>) => setS(await window.api.calendar.set(patch))
  const allow = async () => {
    setMac('asking')
    const r = await window.api.calendar.allowMac()
    setMac(r.granted ? 'idle' : 'denied')
    setS(await window.api.calendar.get())
  }
  return (
    <>
      <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-primary text-[13px] text-text-primary cursor-pointer">
        <input type="checkbox" checked={s.feishu} onChange={e => set({ feishu: e.target.checked })} className="accent-[var(--accent)]" />
        <span className="flex-1 font-semibold">Feishu calendar</span>
        <span className="text-[11px] text-text-muted">via Feishu</span>
      </label>
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-primary text-[13px] text-text-primary">
        <input type="checkbox" aria-label="Mac Calendar" checked={s.mac} onChange={e => e.target.checked ? allow() : set({ mac: false })} className="accent-[var(--accent)] cursor-pointer" />
        <span className="flex-1 font-semibold">Mac Calendar</span>
        {mac === 'denied' && <span className="text-[11px] text-status-waiting">Denied · System Settings → Privacy → Calendars</span>}
        {!s.mac && <button onClick={allow} disabled={mac === 'asking'} className="px-2.5 py-1 rounded-lg bg-bg-secondary border border-border text-[12px] font-semibold cursor-pointer disabled:opacity-50">{mac === 'asking' ? '…' : 'Allow'}</button>}
      </div>
    </>
  )
}

function AgendaPreview() {
  const [a, setA] = useState<DayAgenda | null>(null)
  useEffect(() => { window.api.calendar.agenda().then(setA).catch(() => {}) }, [])
  if (!a) return <div className="text-[12px] text-text-muted">Loading…</div>
  const errs = Object.entries(a.errors).filter(([, v]) => v)
  return (
    <div className="flex flex-col gap-1">
      {!a.events.length && <div className="text-[12px] text-text-muted">No events today</div>}
      {a.events.map((e, i) => (
        <div key={`${e.source}-${e.start}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px]">
          <span className="font-mono text-[11px] text-text-muted w-[44px] shrink-0">{e.allDay ? 'all day' : time(e.start)}</span>
          <span className="flex-1 min-w-0 truncate text-text-primary">{e.title}</span>
          <span className="text-[11px] text-text-muted shrink-0">{e.source === 'feishu' ? 'Feishu' : 'Mac'}</span>
        </div>
      ))}
      {errs.map(([k, v]) => <div key={k} className="text-[11px] text-red-400 font-mono truncate">{k}: {v}</div>)}
    </div>
  )
}

/** App Settings → Calendar. */
export function CalendarSettings() {
  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Calendar</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-3 flex flex-col gap-2">
        <CalendarConnect />
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">Today</summary>
          <div className="mt-2"><AgendaPreview /></div>
        </details>
      </div>
    </div>
  )
}
