import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ROUTINE_IDS, ROUTINE_NAME, type JournalDay, type RoutinesView } from '../../../../shared/butler-routines'
import { dayTitle, headline, meetingLines, nextMeeting, previousDay, routineToday, shiftDate, summaryBody, type RoutineState } from '../../lib/butler-today'

const TAG: Record<'draft' | 'jira' | 'mail', { text: string; cls: string }> = {
  draft: { text: 'draft', cls: 'bg-accent-subtle text-accent' },
  jira: { text: 'Jira', cls: 'bg-bg-secondary text-text-muted' },
  mail: { text: 'mail', cls: 'bg-bg-secondary text-text-muted' }
}

const STATE_CLS: Record<RoutineState, string> = {
  ran: 'text-status-working', failed: 'text-status-waiting', missed: 'text-status-waiting', next: 'text-text-muted', off: 'text-text-muted'
}

const NO_MENTIONS = /^\s*(\*\*[^*]+\*\*\s*)?no new mentions\s*$/i

/** The evening report: **Needs you** / **Open** / **Done** with one short item per line. */
function Summary({ text }: { text: string }) {
  return (
    <div className="whitespace-normal [&_p]:my-1 [&_p:first-child]:mt-0 [&_strong]:text-text-primary [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-4 [&_ul]:pl-4 [&_li]:my-0.5 [&_blockquote]:text-text-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryBody(text).replace(/([^\n])\n(?=[^\n])/g, '$1  \n')}</ReactMarkdown>
    </div>
  )
}

/** One folded line: icon · label · headline; opens to the full text. */
function Row({ icon, label, line, children }: { icon: string; label: string; line: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-border last:border-b-0" aria-label={label}>
      <summary className="flex items-center gap-2.5 py-2 cursor-pointer list-none text-[13px]">
        <span className="w-[18px] text-center" aria-hidden>{icon}</span>
        <span className="w-[64px] flex-shrink-0 text-[12px] text-text-muted">{label}</span>
        <span className="flex-1 min-w-0 truncate text-text-primary">{line}</span>
        <span className="text-[12px] text-text-muted transition-transform group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div className="pb-2.5 pl-7 text-[12px] text-text-secondary whitespace-pre-wrap leading-relaxed">{children}</div>
    </details>
  )
}

/** Butler → Today: one day at a time — status chips, the next meeting, the plan, then folded rows. */
export function TodayTab({ visible }: { visible: boolean }) {
  const [today, setToday] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [day, setDay] = useState<JournalDay | null>(null)
  const [prev, setPrev] = useState<JournalDay | null>(null)
  const [dates, setDates] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [routines, setRoutines] = useState<RoutinesView | null>(null)
  const [toApprove, setToApprove] = useState(0)
  const [allMeetings, setAllMeetings] = useState(false)

  const load = async (d?: string) => {
    const j = await window.api.journal.day(d)
    const all = await window.api.journal.dates()
    if (!d) setToday(j.date)
    window.api.routines.get().then((v: RoutinesView) => setRoutines(v)).catch(() => {})
    window.api.approvals.list().then((a: unknown[]) => setToApprove(a.length)).catch(() => {})
    setDate(j.date); setDay(j); setDates(all)
    const p = previousDay(all, j.date)
    setPrev(p ? await window.api.journal.day(p) : null)
  }
  useEffect(() => { if (visible) void load(date && date !== today ? date : undefined).catch(() => {}) }, [visible])

  if (!day || !date) return null
  const isToday = date === today
  const toggle = async (index: number, text: string, done: boolean) => {
    setDay({ ...day, plan: day.plan.map(i => i.index === index ? { ...i, done } : i) })
    const r = await window.api.journal.toggle(date, index, text, done)
    if (!r.ok) void load(date)
  }
  // Ignore: the item leaves Today (kept in the journal as "- [-]"); an email task's email is marked read.
  const ignore = async (index: number, text: string) => {
    setDay({ ...day, plan: day.plan.map(i => i.index === index ? { ...i, ignored: true } : i) })
    const r = await window.api.journal.ignore(date, index, text)
    if (!r.ok) void load(date)
  }
  const makePlan = async () => {
    setRunning(true)
    await window.api.routines.run('morning-plan').catch(() => {})
    setRunning(false)
    void load()
  }
  // dates are newest first: ‹ goes to the older neighbour, › to the newer one.
  const older = dates.find(d => d < date) ?? null
  const newer = [...dates].reverse().find(d => d > date) ?? (!isToday && today ? today : null)
  const go = (d: string | null) => { if (d) void load(d === today ? undefined : d) }

  const now = new Date()
  const states = routines && isToday
    ? ROUTINE_IDS.map(id => ({ id, ...routineToday(routines.settings.routines[id], routines.settings.weekdays, routines.lastRuns[id], now) }))
    : []
  const active = states.filter(s => s.state !== 'off')
  const ran = active.filter(s => s.state === 'ran').length
  const trouble = active.filter(s => s.state === 'failed' || s.state === 'missed')

  const meetings = meetingLines(day.meetings)
  const next = isToday ? nextMeeting(meetings, now) : null
  const plan = day.plan.filter(i => !i.ignored)
  const done = plan.filter(i => i.done).length
  const feishu = day.feishu && !NO_MENTIONS.test(day.feishu.replace(/\n+/g, ' ')) ? day.feishu : ''
  const prevLabel = prev && prev.date === shiftDate(date, -1) ? 'Yesterday' : prev ? dayTitle(prev.date) : ''

  const arrow = 'w-[26px] h-[26px] rounded-lg text-[14px] text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent'
  const chip = 'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px]'

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5 pt-1">
        <button onClick={() => go(older)} disabled={!older} aria-label="Previous day" className={arrow}>‹</button>
        <h3 className="flex-1 text-[15px] font-semibold text-text-primary">{dayTitle(date)}</h3>
        {!isToday && <button onClick={() => go(today)} className="text-[12px] font-semibold text-accent cursor-pointer">Today</button>}
        <button onClick={() => go(newer)} disabled={!newer} aria-label="Next day" className={arrow}>›</button>
      </div>

      {isToday && (active.length > 0 || toApprove > 0) && (
        <div className="flex flex-wrap gap-1.5" aria-label="Status">
          {active.length > 0 && <span className={`${chip} bg-bg-primary text-text-secondary`}><i className="w-1.5 h-1.5 rounded-full bg-status-working" /><b className="font-semibold text-text-primary">{ran}</b>/{active.length} routines</span>}
          {trouble.length > 0 && <span className={`${chip} bg-status-waiting/15 text-status-waiting`}>⚠ <b className="font-semibold">{trouble.length}</b> {trouble.some(t => t.state === 'failed') ? 'failed' : 'missed'}</span>}
          {toApprove > 0 && <span className={`${chip} bg-bg-primary text-text-secondary`}><b className="font-semibold text-text-primary">{toApprove}</b> to approve</span>}
        </div>
      )}

      {meetings.length > 0 && (
        <div className="rounded-xl bg-accent-subtle px-3 py-2.5" aria-label="Meetings">
          <div className="flex items-center gap-2.5">
            {next ? (
              <>
                <span className="font-mono text-[13px] font-medium text-accent">{next.m.start}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-text-primary truncate">{next.m.title}</div>
                  <div className="text-[11px] text-text-muted">{next.when}</div>
                </div>
              </>
            ) : (
              <span className="flex-1 text-[13px] text-text-primary">{meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}{isToday ? ' · none left' : ''}</span>
            )}
            {(meetings.length > 1 || !next) && (
              <button onClick={() => setAllMeetings(o => !o)} aria-expanded={allMeetings} className="text-[11.5px] font-semibold text-accent cursor-pointer">
                {next ? `+${meetings.length - 1}` : 'All'} {allMeetings ? '▴' : '▾'}
              </button>
            )}
          </div>
          {allMeetings && (
            <div className="mt-2 flex flex-col gap-1 text-[12px]">
              {meetings.map((m, i) => (
                <div key={i} className="flex gap-2.5"><span className="w-[84px] font-mono text-[11px] text-text-muted">{m.start ? `${m.start}–${m.end}` : 'all day'}</span><span className="flex-1 min-w-0 truncate text-text-primary">{m.title}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-baseline gap-2 pb-0.5">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Plan</span>
          {day.planLate && <span className="text-[10px] font-semibold text-status-waiting" title={day.planLate}>late</span>}
          {plan.length > 0 && <span className="font-mono text-[11px] text-text-muted">{done}/{plan.length}</span>}
        </div>
        {plan.map(it => (
          <div key={`${it.index}-${it.text}`} className="group flex items-center gap-2.5 py-2 border-b border-border last:border-b-0 text-[13px]">
            <label className="flex flex-1 min-w-0 items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={it.done} onChange={e => toggle(it.index, it.text, e.target.checked)} className="accent-accent cursor-pointer" />
              <span className={`flex-1 min-w-0 ${it.done ? 'line-through text-text-muted' : 'text-text-primary'}`}>{it.text}</span>
            </label>
            {it.source && <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${TAG[it.source].cls}`}>{TAG[it.source].text}</span>}
            {!it.done && (
              <button onClick={() => ignore(it.index, it.text)} aria-label={`Ignore ${it.text}`}
                title={(it.source === 'mail' || it.source === 'draft') && it.ref ? 'Ignore · marks the email read' : 'Ignore'}
                className="w-6 h-6 rounded-md text-[12px] text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-bg-hover hover:text-text-primary cursor-pointer">✕</button>
            )}
          </div>
        ))}
        {!plan.length && (
          <div className="flex items-center gap-2 py-2 text-[13px]">
            <span className="flex-1 text-text-muted">No plan</span>
            {isToday && <button onClick={makePlan} disabled={running} className="px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">{running ? '…' : 'Make plan'}</button>}
          </div>
        )}
      </div>

      {(day.summary || day.butler || feishu || day.jira || states.length > 0 || (isToday && prev?.summary)) && (
        <div className="rounded-xl bg-bg-primary px-3" aria-label="Updates">
          {day.summary && <Row icon="✨" label="Summary" line={headline(day.summary)}><Summary text={day.summary} /></Row>}
          {day.butler && <Row icon="🎩" label="Butler" line={headline(day.butler).replace(/^-\s*/, '')}>{day.butler}</Row>}
          {feishu && <Row icon="💬" label="@ you" line={headline(feishu)}>{feishu}</Row>}
          {day.jira && <Row icon="🎫" label="Jira" line={headline(day.jira)}>{day.jira}</Row>}
          {states.length > 0 && (
            <Row icon="📋" label="Routines" line={trouble.length ? trouble.map(t => `${ROUTINE_NAME[t.id]} ${t.label}`).join(' · ') : ran === active.length && active.length ? 'all ran' : `${ran}/${active.length} ran`}>
              <span className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1">
                {states.map(s => (
                  <span key={s.id} className="contents">
                    <span className="text-text-primary">{ROUTINE_NAME[s.id]}</span>
                    <span className={`font-mono text-[11px] ${STATE_CLS[s.state]}`} title={s.state === 'failed' ? routines?.lastRuns[s.id]?.error : undefined}>{s.label}</span>
                  </span>
                ))}
              </span>
            </Row>
          )}
          {isToday && prev?.summary && <Row icon="🌙" label={prevLabel} line={headline(prev.summary)}><Summary text={prev.summary} /></Row>}
        </div>
      )}
    </div>
  )
}
