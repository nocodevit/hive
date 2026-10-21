import { useEffect, useRef, useState } from 'react'
import { NOTIFY_EVENTS, NOTIFY_EVENT_LABEL, type NotifySettings, type NotifyView, type TelegramStatus } from '../../../shared/notify'
import { Switch } from './butler/Switch'
import { TimeBox } from './butler/DailyRoutine'

const sectionLabel = 'block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2'
const btn = 'whitespace-nowrap shrink-0 px-2.5 py-1 rounded-lg bg-bg-primary border border-border text-[12px] font-semibold text-text-primary cursor-pointer disabled:opacity-50'
const row = 'flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border last:border-0'

const TG_ERROR: Record<string, string> = {
  not_a_token: 'Not a bot token',
  rejected: 'Telegram rejected it',
  network: 'No connection to Telegram',
  no_token: 'Paste the token first'
}
const POLL_MS = 3000
const POLL_FOR_MS = 3 * 60_000

/** Away push · Telegram: guided setup (BotFather → token → /start) and status. */
function TelegramSetup({ status, onStatus }: { status: TelegramStatus; onStatus: (s: TelegramStatus) => void }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [polling, setPolling] = useState(false)
  const stopAt = useRef(0)
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  // Waiting for /start: Hive looks for the chat itself.
  useEffect(() => {
    if (status.state !== 'needs_start') { setPolling(false); return }
    stopAt.current = Date.now() + POLL_FOR_MS
    setPolling(true)
  }, [status.state])
  useEffect(() => {
    if (!polling) return
    let alive = true
    const tick = async () => {
      if (!alive) return
      if (Date.now() > stopAt.current) { setPolling(false); return }
      const r = await window.api.telegram.findChat().catch(() => null)
      if (!alive) return
      if (r?.ok) { onStatusRef.current(r.status); setPolling(false); setMsg('Test message sent'); return }
      setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => { alive = false }
  }, [polling])

  const check = async () => {
    setBusy(true); setMsg('')
    const r = await window.api.telegram.setToken(token).catch(() => ({ ok: false as const, error: 'network' }))
    setBusy(false)
    if (r.ok) { setToken(''); onStatus(r.status) } else setMsg(TG_ERROR[r.error] || r.error)
  }
  const disconnect = async () => {
    const r = await window.api.telegram.disconnect()
    if (r.ok) onStatus(r.status)
    setOpen(false); setMsg('')
  }
  const test = async () => {
    setBusy(true)
    const r = await window.api.telegram.test().catch(() => ({ ok: false }))
    setBusy(false)
    setMsg(r.ok ? 'Test message sent' : 'Could not send')
  }

  if (status.state === 'ready') return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="text-[13px] text-text-primary">@{status.bot}{status.chatName ? ` · ${status.chatName}` : ''}</span>
      <button onClick={test} disabled={busy} className={btn}>Test</button>
      <button onClick={disconnect} className="text-[12px] font-semibold text-text-muted cursor-pointer">Disconnect</button>
      {msg && <span role="status" className="w-full text-right text-[12px] text-text-muted">{msg}</span>}
    </div>
  )

  if (status.state === 'needs_start') return (
    <div className="flex flex-col items-end gap-1.5 text-[13px]">
      <span className="text-text-primary">Send <code className="px-1 rounded bg-bg-primary">/start</code> to <a href={`https://t.me/${status.bot}`} target="_blank" rel="noreferrer" className="text-accent font-semibold">@{status.bot}</a></span>
      <span role="status" className="text-[12px] text-text-muted">{polling ? 'Waiting for /start…' : msg || 'Not seen yet'}</span>
      <span className="flex gap-2">
        {!polling && <button onClick={() => { stopAt.current = Date.now() + POLL_FOR_MS; setPolling(true) }} className={btn}>Check again</button>}
        <button onClick={disconnect} className="text-[12px] font-semibold text-text-muted cursor-pointer">Cancel</button>
      </span>
    </div>
  )

  if (!open) return <button onClick={() => setOpen(true)} className={btn}>Set up</button>
  return (
    <div className="flex flex-col items-stretch gap-1.5 w-[340px] text-[12px]">
      <div className="flex items-center gap-2">
        <span className="w-4 text-text-muted font-bold">1</span>
        <button onClick={() => void window.api.telegram.openBotFather()} className={btn}>Open BotFather</button>
        <span className="text-text-muted">send /newbot, name it, copy the token</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-4 text-text-muted font-bold">2</span>
        <input type="password" value={token} onChange={e => setToken(e.target.value)} aria-label="Bot token" placeholder="Paste token"
          onKeyDown={e => { if (e.key === 'Enter' && token.trim()) void check() }}
          className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-primary border border-border text-[12px] font-mono text-text-primary focus:outline-none focus:border-accent" />
        <button onClick={check} disabled={busy || !token.trim()} className={btn}>{busy ? '…' : 'Check'}</button>
      </div>
      {msg && <span role="alert" className="text-status-waiting">{msg}</span>}
    </div>
  )
}

/**
 * Notifications (App Settings section and the Butler wizard step): Mac
 * switch + test, quiet hours, away push via Telegram, per-event switches
 * folded under More.
 */
export function NotificationSettings({ framed = true }: { framed?: boolean }) {
  const [v, setV] = useState<NotifyView | null>(null)
  const [test, setTest] = useState<'idle' | 'sending' | 'shown' | 'blocked'>('idle')

  useEffect(() => { window.api.notify.get().then(setV).catch(() => {}) }, [])
  if (!v) return null
  const s = v.settings
  const save = async (next: NotifySettings) => {
    setV({ ...v, settings: next })
    setV(await window.api.notify.save(next))
  }
  const sendTest = async () => {
    setTest('sending')
    const r = await window.api.notify.test().catch(() => ({ ok: false, shown: false }))
    setTest(r.shown ? 'shown' : 'blocked')
  }
  const onTelegram = (t: TelegramStatus) => setV(cur => (cur ? { ...cur, telegram: t } : cur))

  const body = (
    <div className="rounded-xl bg-bg-secondary border border-border overflow-hidden">
      <div className={row}>
        <span className="text-sm text-text-primary">Mac notifications</span>
        <Switch on={s.mac} label="Mac notifications" onChange={on => save({ ...s, mac: on })} />
      </div>
      <div className={`${row} flex-wrap`}>
        <button onClick={sendTest} disabled={!s.mac || test === 'sending'} className={btn}>Send a test</button>
        <span role="status" className="flex items-center gap-2 text-[12px] text-text-muted">
          {test === 'shown' && <>Sent · not showing?</>}
          {test === 'blocked' && <span className="text-status-waiting">Blocked by macOS</span>}
          {(test === 'shown' || test === 'blocked' || !v.macSupported) && (
            <button onClick={() => void window.api.notify.openSystemSettings()} className="font-semibold text-accent cursor-pointer">Open System Settings</button>
          )}
        </span>
      </div>
      <div className={row}>
        <span className="text-sm text-text-primary">Quiet hours</span>
        <span className="flex items-center gap-2">
          {s.quiet.on && (
            <>
              <TimeBox value={s.quiet.start} label="Quiet from" onCommit={t => save({ ...s, quiet: { ...s.quiet, start: t } })} />
              <span className="text-text-muted text-[12px]">–</span>
              <TimeBox value={s.quiet.end} label="Quiet until" onCommit={t => save({ ...s, quiet: { ...s.quiet, end: t } })} />
            </>
          )}
          <Switch on={s.quiet.on} label="Quiet hours" onChange={on => save({ ...s, quiet: { ...s.quiet, on } })} />
        </span>
      </div>
      <div className={`${row} items-start`}>
        <span className="text-sm text-text-primary pt-1">Away push · Telegram</span>
        <span className="flex items-center gap-2">
          <TelegramSetup status={v.telegram} onStatus={onTelegram} />
          {v.telegram.state === 'ready' && (
            <Switch on={s.away.telegram} label="Away push" onChange={on => save({ ...s, away: { ...s.away, telegram: on } })} />
          )}
        </span>
      </div>
      <details className="px-4 py-2.5 text-[13px]">
        <summary className="cursor-pointer select-none text-[12px] font-semibold text-text-muted">More</summary>
        <div className="mt-2 flex flex-col gap-2" role="group" aria-label="Notify me about">
          {NOTIFY_EVENTS.map(k => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="text-text-primary">{NOTIFY_EVENT_LABEL[k]}</span>
              <Switch on={s.events[k]} label={NOTIFY_EVENT_LABEL[k]} onChange={on => save({ ...s, events: { ...s.events, [k]: on } })} />
            </div>
          ))}
          <p className="text-[11px] text-text-muted">Away = screen locked or idle 10 min</p>
        </div>
      </details>
    </div>
  )
  if (!framed) return body
  return (
    <div>
      <label className={sectionLabel}>Notifications</label>
      {body}
    </div>
  )
}
