import { useCallback, useEffect, useState } from 'react'
import type { AskTopic, FeishuAgentSettings, FeishuAgentView, FeishuLogEntry, LockedTopic } from '../../lib/feishu-agent-types'

const RECALL_MS = 24 * 3600_000
const RELATION_OPTS: Array<[string, string]> = [['unknown', '—'], ['boss', 'Manager'], ['report', 'Reports to me'], ['peer', 'Colleague'], ['requester', 'Other team']]
const KIND_ICON: Record<FeishuLogEntry['kind'], string> = { answer: '💬', holding: '⏳', followup: '↩️' }

function useFeishuAgent() {
  const [v, setV] = useState<FeishuAgentView | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => window.api.feishuAgent.get().then(x => { if (alive) setV(x) }).catch(() => {})
    load()
    const off = window.api.feishuAgent.onChange(load)
    const offF = window.api.feishu.onStatus(load)
    return () => { alive = false; off(); offF() }
  }, [])
  const set = useCallback(async (patch: Partial<FeishuAgentSettings>) => setV(await window.api.feishuAgent.set(patch)), [])
  return { v, set, setV }
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`w-9 h-5 shrink-0 rounded-full cursor-pointer transition-colors relative disabled:opacity-50 ${on ? 'bg-accent' : 'bg-bg-hover'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

function Segmented({ value, onChange }: { value: 'everyone' | 'picked'; onChange: (v: 'everyone' | 'picked') => void }) {
  const opts = [['everyone', 'Everyone'], ['picked', 'People I pick']] as const
  return (
    <div className="inline-flex self-start gap-0.5 p-[3px] rounded-[10px] bg-bg-primary" role="radiogroup" aria-label="Answers">
      {opts.map(([id, label]) => (
        <button key={id} role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${value === id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted'}`}>{label}</button>
      ))}
    </div>
  )
}

const Pill = ({ tone, children }: { tone: 'ok' | 'warn' | 'off'; children: React.ReactNode }) => (
  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bg-primary ${tone === 'ok' ? 'text-status-working' : tone === 'warn' ? 'text-status-waiting' : 'text-text-muted'}`}>{children}</span>
)
const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold text-text-muted">{children}</span>
)
const Chip = ({ children, onRemove, title }: { children: React.ReactNode; onRemove?: () => void; title?: string }) => (
  <span title={title} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-primary text-[12px] text-text-primary">
    {children}
    {onRemove && <button onClick={onRemove} aria-label={`Remove ${typeof children === 'string' ? children : ''}`} className="text-text-muted hover:text-text-primary cursor-pointer">×</button>}
  </span>
)

function AddChip({ onAdd, label, options }: { onAdd: (v: string) => void; label: string; options?: Array<[string, string]> }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!open) return <button onClick={() => setOpen(true)} aria-label={label} className="px-2 py-0.5 rounded-full bg-bg-primary text-[12px] text-accent cursor-pointer">＋</button>
  if (options) return (
    <select autoFocus aria-label={label} onBlur={() => setOpen(false)} defaultValue=""
      onChange={e => { if (e.target.value) onAdd(e.target.value); setOpen(false) }}
      className="px-2 py-0.5 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary">
      <option value="">{options.length ? 'Pick…' : 'No one yet'}</option>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  )
  const done = () => { if (text.trim()) onAdd(text.trim()); setText(''); setOpen(false) }
  return (
    <input autoFocus aria-label={label} value={text} onChange={e => setText(e.target.value)} onBlur={done}
      onKeyDown={e => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { setText(''); setOpen(false) } }}
      className="w-24 px-2 py-0.5 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary focus:outline-none focus:border-accent" />
  )
}

const splitWords = (v: string) => [...new Set(v.split(/[,，、;；\n]/).map(w => w.trim()).filter(Boolean))]

/** "Always asks you": guardrail chips. A chip opens one line (what it covers + an example);
 *  an owner topic needs a name, keywords (the code gate) and a description (for the model). */
function AskFirstTopics({ locked, topics, onChange }: { locked: LockedTopic[]; topics: AskTopic[]; onChange: (t: AskTopic[]) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [words, setWords] = useState('')
  const [hint, setHint] = useState('')
  const kw = splitWords(words)
  const ready = !!name.trim() && kw.length > 0 && !!hint.trim() && !topics.some(t => t.name === name.trim()) && !locked.some(t => t.label === name.trim())
  const reset = () => { setName(''); setWords(''); setHint(''); setAdding(false) }
  const add = () => { if (!ready) return; onChange([...topics, { name: name.trim(), words: kw, hint: hint.trim() }]); reset() }
  const lockedOpen = locked.find(t => t.id === open)
  const topicOpen = topics.find(t => t.name === open)
  const toggle = (id: string) => setOpen(o => (o === id ? null : id))
  const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] text-text-primary cursor-pointer'
  const field = 'px-2 py-1 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary focus:outline-none focus:border-accent'
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Always asks you">
      <Label>Always asks you</Label>
      <div className="flex flex-wrap gap-1.5">
        {locked.map(t => (
          <button key={t.id} title="Locked" aria-expanded={open === t.id} onClick={() => toggle(t.id)}
            className={`${chip} ${open === t.id ? 'bg-accent-subtle' : 'bg-bg-primary'}`}>🔒 {t.label}</button>
        ))}
        {topics.map(t => (
          <span key={t.name} className={`${chip} ${open === t.name ? 'bg-accent-subtle' : 'bg-bg-primary'}`}>
            <button aria-expanded={open === t.name} onClick={() => toggle(t.name)} className="cursor-pointer">{t.name}</button>
            <button aria-label={`Remove ${t.name}`} onClick={() => { onChange(topics.filter(x => x.name !== t.name)); if (open === t.name) setOpen(null) }}
              className="text-text-muted hover:text-text-primary cursor-pointer">×</button>
          </span>
        ))}
        {!adding && <button onClick={() => setAdding(true)} aria-label="Add topic" className="px-2 py-0.5 rounded-full bg-bg-primary text-[12px] text-accent cursor-pointer">＋</button>}
      </div>
      {lockedOpen && (
        <div className="px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px] text-text-secondary" aria-label={`${lockedOpen.label} details`}>
          {lockedOpen.hint} · e.g. <span className="text-text-primary">“{lockedOpen.example}”</span>
        </div>
      )}
      {topicOpen && (
        <div className="px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px] text-text-secondary" aria-label={`${topicOpen.name} details`}>
          {topicOpen.hint} · keywords: <span className="font-mono text-text-primary">{topicOpen.words.join(', ')}</span>
        </div>
      )}
      {adding && (
        <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-bg-primary">
          {([['Name', 'Topic name', 'hiring', name, setName], ['Keywords', 'Topic keywords', '招人, 招聘, hire', words, setWords], ['Covers', 'Topic description', 'hiring plans, headcount', hint, setHint]] as const).map(([label, aria, ph, val, setVal], i) => (
            <label key={aria} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-text-muted">{label}</span>
              <input autoFocus={i === 0} aria-label={aria} placeholder={ph} value={val} onChange={e => setVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') reset() }} className={`flex-1 min-w-0 ${field}`} />
            </label>
          ))}
          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="px-2.5 py-1 rounded-lg text-[12px] text-text-muted cursor-pointer">Cancel</button>
            <button onClick={add} disabled={!ready} className="px-2.5 py-1 rounded-lg bg-accent text-white text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default">Add</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MinutesField({ label, ms, onCommit }: { label: string; ms: number; onCommit: (ms: number) => void }) {
  const [v, setV] = useState(String(Math.round(ms / 60_000)))
  useEffect(() => setV(String(Math.round(ms / 60_000))), [ms])
  const commit = () => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onCommit(Math.round(n * 60_000)); else setV(String(Math.round(ms / 60_000))) }
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      {label}
      <span className="flex items-center gap-1.5">
        <input value={v} inputMode="numeric" onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }}
          className="w-16 px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent" />
        <span>min</span>
      </span>
    </label>
  )
}

function PrefixField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      Prefix
      <input value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={e => { if (e.key === 'Enter') onCommit(v) }}
        className="px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent" />
    </label>
  )
}

function LogList() {
  const [items, setItems] = useState<FeishuLogEntry[]>([])
  const [err, setErr] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    const load = () => window.api.feishuAgent.log().then(x => { if (alive) setItems(x) }).catch(() => {})
    load()
    const off = window.api.feishuAgent.onChange(load)
    return () => { alive = false; off() }
  }, [])
  const recall = async (id: string) => {
    const r = await window.api.feishuAgent.recall(id)
    if (!r.ok) setErr(e => ({ ...e, [id]: r.error || 'failed' }))
    setItems(await window.api.feishuAgent.log())
  }
  if (!items.length) return <div className="text-[12px] text-text-muted">Nothing sent yet</div>
  return (
    <div className="flex flex-col gap-1">
      {items.map(e => {
        const canRecall = !e.recalled && Date.now() - e.time < RECALL_MS
        return (
          <div key={e.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px]">
            <span aria-hidden>{KIND_ICON[e.kind]}</span>
            <span className="font-semibold text-text-primary shrink-0 max-w-[110px] truncate">{e.chatName || 'Feishu'}</span>
            <span className={`flex-1 min-w-0 truncate ${e.recalled ? 'line-through text-text-muted' : 'text-text-secondary'}`} title={e.text}>{e.text}</span>
            <span className="text-[11px] text-text-muted font-mono shrink-0">{new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            {canRecall && <button onClick={() => recall(e.id)} className="text-[11px] font-semibold text-accent cursor-pointer shrink-0">Recall</button>}
            {e.recalled && <span className="text-[11px] text-text-muted shrink-0">recalled</span>}
            {err[e.id] && <span className="text-[11px] text-red-400 font-mono shrink-0">{err[e.id]}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** Wizard → Feishu: 代管 switch + who it answers. */
/** One scan right now, instead of waiting for the next minute. */
function ScanNow() {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState('')
  const scan = async () => {
    setBusy(true); setRes('')
    const r = await window.api.feishuAgent.scanNow().catch(e => ({ ok: false, handled: 0, error: String(e) }))
    setBusy(false)
    setRes(r.ok ? (r.handled ? `${r.handled} handled` : 'Nothing new') : r.error === 'busy' ? 'Scanning…' : (r.error || 'failed'))
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {res && <span role="status" aria-label="Scan result" className="text-[11px] text-text-muted">{res}</span>}
      <button onClick={scan} disabled={busy} className="px-2.5 py-1 rounded-lg bg-bg-primary border border-border text-[12px] text-text-primary cursor-pointer disabled:opacity-50">{busy ? 'Scanning…' : 'Scan now'}</button>
    </span>
  )
}

export function FeishuAgentQuick() {
  const { v, set } = useFeishuAgent()
  if (!v) return null
  return (
    <>
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-primary text-[13px] text-text-primary">
        <span className="flex-1 font-semibold">代管 · {v.prefix}</span>
        <Switch on={v.settings.enabled} label="代管" disabled={!v.connected && !v.settings.enabled} onChange={on => set({ enabled: on })} />
      </div>
      <Segmented value={v.settings.scope} onChange={scope => set({ scope })} />
    </>
  )
}

/** App Settings → Feishu 代管 (answer-for-me, main/feishuAgent.ts). */
export function FeishuAgentSettings() {
  const { v, set, setV } = useFeishuAgent()
  if (!v) return null
  const s = v.settings
  const senderOpts = Object.entries(v.senders).filter(([id]) => !s.picked.includes(id))
  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Feishu 代管</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[20px]" aria-hidden>💬</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary">代管 {s.enabled ? 'On' : 'Off'}</div>
            <div className="text-[12px] text-text-muted truncate">as {v.prefix}</div>
          </div>
          <Pill tone={v.connected ? 'ok' : 'off'}>{v.connected ? 'Connected' : 'Not connected'}</Pill>
          {s.enabled && <ScanNow />}
          <Switch on={s.enabled} label="代管" disabled={!v.connected && !s.enabled} onChange={on => set({ enabled: on })} />
        </div>
        {s.enabled && v.lastError && <div className="text-[11px] text-red-400 font-mono truncate" title={v.lastError}>{v.lastError}</div>}

        <div className="flex flex-col gap-1.5">
          <Label>Answers</Label>
          <Segmented value={s.scope} onChange={scope => set({ scope })} />
          {s.scope === 'picked' && (
            <div className="flex flex-wrap gap-1.5">
              {s.picked.map(id => <Chip key={id} title={id} onRemove={() => set({ picked: s.picked.filter(x => x !== id) })}>{v.senders[id] || id.slice(0, 10)}</Chip>)}
              <AddChip label="Add person" options={senderOpts} onAdd={id => set({ picked: [...s.picked, id] })} />
            </div>
          )}
        </div>

        <AskFirstTopics locked={v.locked} topics={s.askFirstTopics} onChange={askFirstTopics => set({ askFirstTopics })} />

        {Object.keys(v.senders).length > 0 && (
          <details>
            <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">People · how they relate to you</summary>
            <div className="mt-2 flex flex-col gap-1" role="group" aria-label="People">
              {Object.entries(v.senders).map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-bg-primary text-[12px]">
                  <span className="flex-1 min-w-0 truncate text-text-primary">{name || id.slice(0, 12)}</span>
                  <select aria-label={`${name || id} relation`} value={v.people[id] ?? 'unknown'}
                    onChange={async e => setV(await window.api.feishuAgent.setPerson(id, e.target.value))}
                    className="px-2 py-0.5 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary">
                    {RELATION_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </details>
        )}

        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">More · timing · prefix · preview</summary>
          <div className="mt-2 flex flex-col gap-2.5">
            <div className="flex gap-4">
              <MinutesField label="Wait before reply" ms={s.waitBeforeReplyMs} onCommit={ms => set({ waitBeforeReplyMs: ms })} />
              <MinutesField label="Remind me after" ms={s.remindAfterMs} onCommit={ms => set({ remindAfterMs: ms })} />
            </div>
            <PrefixField value={s.prefix} placeholder={v.defaultPrefix} onCommit={prefix => set({ prefix })} />
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px]">
              <span className="flex-1 text-text-primary">Real-time messages</span>
              <Pill tone={v.capabilities.realtime ? 'ok' : 'warn'}>{v.capabilities.realtime ? 'on' : 'to verify'}</Pill>
            </div>
            <div className="flex flex-col gap-1.5 px-2.5 py-2 rounded-lg bg-bg-primary text-[12px]" aria-label="Preview">
              <div className="self-start max-w-[80%] px-2.5 py-1.5 rounded-[4px_12px_12px_12px] bg-bg-secondary text-text-primary">checkout 什么时候好？</div>
              <div className="self-end max-w-[80%] px-2.5 py-1.5 rounded-[12px_4px_12px_12px] bg-accent-subtle text-text-primary"><b>{v.prefix}</b> {v.holding}</div>
            </div>
          </div>
        </details>

        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">Log</summary>
          <div className="mt-2"><LogList /></div>
        </details>
      </div>
    </div>
  )
}
