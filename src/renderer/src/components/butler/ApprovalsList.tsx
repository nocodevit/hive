import { useEffect, useState } from 'react'
import { DiscussButton, type OnDiscuss } from './DiscussButton'

export type ApprovalCard = { id: string; kind: string; title: string; subtitle: string; draft: string; action: string; payload?: Record<string, unknown>; createdAt?: number; edited?: { at: number } }

const ICON: Record<string, string> = { email: '✉️', feishu: '💬', jira: '🎫' }
const iconOf = (kind: string) => ICON[kind.split('.')[0]] ?? '📝'
const DECIDE = 'email.decide'
const str = (p: Record<string, unknown> | undefined, k: string) => (typeof p?.[k] === 'string' ? (p[k] as string) : '')

/** What they wrote (Feishu cards): in full, folded after a few lines. */
function TheirMessage({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  const long = text.length > 220 || text.split('\n').length > 4
  return (
    <div aria-label="Their message" className="self-start max-w-[92%] rounded-[4px_12px_12px_12px] bg-bg-primary px-2.5 py-1.5 text-[12.5px] text-text-secondary">
      <div className={`whitespace-pre-wrap break-words ${long && !open ? 'line-clamp-4' : ''}`}>{text}</div>
      {long && <button onClick={() => setOpen(o => !o)} className="mt-0.5 text-[11px] font-semibold text-accent cursor-pointer">{open ? 'Less' : 'More'}</button>}
    </div>
  )
}

/** "P4-6926 ↗" — opens the ticket in the browser (main adds payload.url to Jira cards). */
function JiraLink({ payload }: { payload?: Record<string, unknown> }) {
  const url = str(payload, 'url')
  if (!/^https?:\/\//.test(url)) return null
  return <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} aria-label={`Open ${str(payload, 'key')} in Jira`}
    className="text-[11px] font-semibold text-accent hover:underline whitespace-nowrap">{str(payload, 'key')} ↗</a>
}

/** What Butler's chat gets when the owner presses Discuss on a needs-you card. */
export function discussText(it: ApprovalCard): string {
  const p = it.payload
  return [
    'Help me decide how to answer this email. Do not send anything.',
    `${it.title} · card ${it.id}`,
    str(p, 'about') ? `What it wants: ${str(p, 'about')}` : '',
    `You need from me: ${str(p, 'question')}`,
    '',
    str(p, 'original') ? `--- email from ${str(p, 'from')} ---\n${str(p, 'original')}` : '',
    '',
    'When we agree, I will put the answer in the Approve card and you will write the reply there.'
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Any waiting card → the Butler chat, to think it through instead of replying. */
export function cardDiscussText(it: ApprovalCard): string {
  const p = it.payload
  return [
    'Help me think this through. Do not send or change anything until I confirm. Once we agree on the wording, put it on the card (./hive card edit) and I send it from Approve.',
    `${it.title} · ${it.subtitle} · card ${it.id}`,
    str(p, 'key') ? `Jira: ${str(p, 'key')}${str(p, 'url') ? ` (${str(p, 'url')})` : ''}` : '',
    str(p, 'chatName') ? `Feishu chat: ${str(p, 'chatName')}` : '',
    str(p, 'topic') ? `Why it waits for me: ${str(p, 'topic')}` : '',
    str(p, 'question') ? `--- their message ---\n${str(p, 'question')}` : '',
    str(p, 'original') ? `--- email from ${str(p, 'from')} ---\n${str(p, 'original')}` : '',
    str(p, 'sent') ? `--- already sent to them ---\n${str(p, 'sent')}` : '',
    it.draft ? `--- Butler's draft (not sent) ---\n${it.draft}` : ''
  ].filter(Boolean).join('\n')
}

/** Who it is from: the name before " · " in the title (a Jira card: its key). */
const nameOf = (it: ApprovalCard) => (it.kind.startsWith('jira') ? str(it.payload, 'key') || it.title.split(' · ')[0] : it.title.split(' · ')[0])
const restOf = (it: ApprovalCard) => it.title.split(' · ').slice(1).join(' · ')
const initials = (n: string) => { const w = n.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/); return ((w[0]?.[0] ?? '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() }
const HUES = [199, 24, 152, 262, 340, 45, 190, 280]
const hueOf = (n: string) => HUES[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]
const SOURCE: Record<string, string> = { feishu: '💬 Feishu', email: '✉️ Email', jira: '🎫 Jira' }
const srcKey = (kind: string) => kind.split('.')[0]
const ago = (ms?: number) => { if (!ms || Date.now() - ms > 365 * 86_400_000) return ''; const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }
/** A card the owner must decide (a question, or the facts went out and a call is left) vs one ready to send. */
const needsYou = (it: ApprovalCard) => it.kind === DECIDE || !!str(it.payload, 'sent') || !it.draft.trim()

/** Butler → Approve: grouped "needs your call" / "ready to send", filterable by source. Each card reads like a
 *  chat — their message, what Butler already sent, Butler's reply (click to edit) — with the actions in one row. */
export function ApprovalsList({ items, onDiscuss }: { items: ApprovalCard[]; onDiscuss?: OnDiscuss }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Record<string, string>>({})
  const [noted, setNoted] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<string>('all')
  // "+ Todo", and Discuss (a card taken to the chat is a follow-up): the card becomes a todo with its refs.
  const toTodo = (id: string, note?: string) => { void window.api.todos.fromApproval(id, note).then(t => { if (t) setNoted(n => ({ ...n, [id]: true })) }).catch(() => {}) }
  const discuss = (it: ApprovalCard, text: string, to?: Parameters<OnDiscuss>[1]) => { onDiscuss?.(text, to); toTodo(it.id, to ? `Discussed with ${to.agent} (${to.project})` : 'Discussed in Chat') }
  useEffect(() => { if (editing && !items.some(i => i.id === editing)) setEditing(null) }, [items, editing])

  const approve = async (it: ApprovalCard) => {
    // No draft (the owner's call): Reply opens an empty box instead of sending nothing.
    if (!it.draft.trim() && editing !== it.id) { setEditing(it.id); setText(''); return }
    if (editing === it.id && !text.trim()) return
    setBusy(it.id)
    const r = await window.api.approvals.approve(it.id, editing === it.id ? text : undefined)
    setBusy(null)
    if (!r.ok) setError(e => ({ ...e, [it.id]: r.error || 'failed' }))
    else setEditing(null)
  }
  const answer = async (it: ApprovalCard) => {
    const a = (answers[it.id] ?? '').trim()
    if (!a) return
    setBusy(it.id)
    setError(e => ({ ...e, [it.id]: '' }))
    const r = await window.api.mail.answer(it.id, a)
    setBusy(null)
    if (!r.ok) setError(e => ({ ...e, [it.id]: r.error === 'still_needs_you' ? 'Still needs you — see the question' : r.error }))
    else setAnswers(x => { const n = { ...x }; delete n[it.id]; return n })
  }
  const edit = (it: ApprovalCard) => { setEditing(it.id); setText(it.draft) }

  if (!items.length) return <div className="text-[12px] text-text-muted px-1">{document.documentElement.dataset.palette === 'halloween' ? '👻 全清了，鬼都没有' : 'Nothing to approve'}</div>
  const counts = items.reduce<Record<string, number>>((m, it) => { const k = srcKey(it.kind); m[k] = (m[k] ?? 0) + 1; return m }, {})
  const shown = filter === 'all' ? items : items.filter(it => srcKey(it.kind) === filter)
  const groups = [{ label: 'Needs your call', list: shown.filter(needsYou) }, { label: 'Ready to send', list: shown.filter(it => !needsYou(it)) }]
  const primary = 'h-7 px-3 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50'
  const ghost = 'h-7 px-2 rounded-lg text-[12px] text-text-secondary hover:bg-bg-hover inline-flex items-center gap-1 cursor-pointer disabled:opacity-60'

  const card = (it: ApprovalCard) => {
    const decide = it.kind === DECIDE
    const about = str(it.payload, 'about')
    const name = nameOf(it)
    const them = str(it.payload, 'question') && !decide ? str(it.payload, 'question') : decide ? str(it.payload, 'original') : ''
    const sent = str(it.payload, 'sent')
    const jira = it.kind.startsWith('jira')
    return (
      <div key={it.id} aria-label={`${decide ? 'Needs you' : it.action}: ${it.title}`}
        className={`flex-shrink-0 rounded-[14px] bg-bg-secondary border border-border border-l-[3px] ${needsYou(it) ? 'border-l-amber-500' : 'border-l-accent'} shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
        <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1.5">
          <span aria-hidden className="w-7 h-7 rounded-full flex-shrink-0 inline-flex items-center justify-center text-[11px] font-bold text-white" style={{ background: `hsl(${hueOf(name)} 70% 50%)` }}>{jira ? '🎫' : initials(name)}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-text-primary truncate">{name}</div>
            <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-text-muted"><span className="truncate">{restOf(it) || it.subtitle}</span>{jira && <JiraLink payload={it.payload} />}</div>
          </div>
          <span className="px-1.5 py-0.5 rounded-md bg-bg-primary text-[10.5px] font-semibold text-text-secondary whitespace-nowrap">{SOURCE[srcKey(it.kind)] ?? '📝'}</span>
          {it.createdAt ? <span className="font-mono text-[11px] text-text-muted/70">{ago(it.createdAt)}</span> : null}
        </div>
        <div className="px-3 pb-2.5 flex flex-col gap-2">
          {about && <div className="text-[12px] text-text-secondary truncate" title={about} aria-label="What it wants">{about}</div>}
          {them && <TheirMessage text={them} />}
          {sent && (
            <div aria-label="Already sent" className="self-end max-w-[92%] rounded-[12px_4px_12px_12px] bg-emerald-500/10 px-2.5 py-1.5 text-[12.5px] text-text-primary">
              <span className="block text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">Sent to them ✓</span>
              <span className="whitespace-pre-wrap">{sent}</span>
            </div>
          )}
          {(sent || decide) && (
            <div aria-label={decide ? 'Butler asks' : 'Your call'} className="flex gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
              <span aria-hidden>⚖️</span><span>{decide ? `Needs you · ${str(it.payload, 'question')}` : `Your call · ${str(it.payload, 'topic')}`}</span>
            </div>
          )}
          {!decide && (editing === it.id ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-text-muted">{jira ? 'Comment · added to the ticket' : 'Reply · sent exactly as written'} · ⌘↵ to send</span>
              <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Reply" rows={5} autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void approve(it) }}
                className="w-full rounded-lg bg-bg-primary border border-border px-2.5 py-2 text-[12.5px] text-text-primary focus:outline-none focus:border-accent resize-y" />
            </label>
          ) : it.draft.trim() ? (
            <button onClick={() => edit(it)} aria-label={`Draft for ${it.title}`} title="Click to edit"
              className="self-end max-w-[92%] text-left rounded-[12px_4px_12px_12px] bg-accent-subtle px-2.5 py-1.5 text-[12.5px] text-text-primary cursor-text hover:ring-1 hover:ring-accent/40">
              <span className="block text-[10.5px] font-semibold text-accent">{jira ? 'Comment' : "Butler's reply"} · {it.edited ? <span aria-label="Updated by Butler">updated {whenLabel(it.edited.at)} · </span> : null}click to edit</span>
              <span className="whitespace-pre-wrap">{it.draft}</span>
            </button>
          ) : null)}
          {error[it.id] && <div className="text-[11px] text-red-400 font-mono">{error[it.id]}</div>}
        </div>
        <div className="flex items-center gap-1 px-2.5 py-2 border-t border-border bg-bg-primary/40">
          {decide ? (
            <>
              <input value={answers[it.id] ?? ''} onChange={e => setAnswers(x => ({ ...x, [it.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') answer(it) }} aria-label="Your answer to Butler" placeholder="Answer Butler — it writes the reply"
                className="flex-1 min-w-0 h-7 rounded-lg bg-bg-secondary border border-border px-2.5 text-[12px] text-text-primary focus:outline-none focus:border-accent" />
              <button disabled={busy === it.id || !(answers[it.id] ?? '').trim()} onClick={() => answer(it)} className={primary}>{busy === it.id ? 'Writing…' : 'Write reply'}</button>
              {onDiscuss && <DiscussButton label={`Discuss ${it.title}`} text={() => discussText(it)} onDiscuss={(t, to) => discuss(it, t, to)} />}
            </>
          ) : (
            <>
              <button disabled={busy === it.id} onClick={() => approve(it)} aria-label={`${it.action} ${it.title}`} className={primary}>
                {busy === it.id ? '…' : it.action}{editing === it.id && <kbd className="text-[10px] opacity-70 bg-white/20 rounded px-1 font-sans">⌘↵</kbd>}
              </button>
              {editing !== it.id && it.draft.trim() && <button onClick={() => edit(it)} aria-label={`Edit ${it.title}`} className={ghost}>✎ Edit</button>}
              {onDiscuss && <DiscussButton label={`Discuss ${it.title}`} text={() => cardDiscussText(it)} onDiscuss={(t, to) => discuss(it, t, to)} />}
            </>
          )}
          {!decide && <button onClick={() => toTodo(it.id)} disabled={noted[it.id]} aria-label={`Add ${it.title} to Todo`} className={`${ghost} ${noted[it.id] ? 'text-accent' : ''}`}>{noted[it.id] ? '✓ In Todo' : '＋ Todo'}</button>}
          <span className="flex-1" />
          <button onClick={() => window.api.approvals.reject(it.id)} aria-label={`Reject ${it.title}`} className={`${ghost} text-text-muted`}>{decide ? '✕' : 'Dismiss'}</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Filter cards">
        {[['all', 'All', items.length], ...Object.entries(counts).map(([k, n]) => [k, (SOURCE[k] ?? k).replace(/^\S+ /, ''), n])].map(([k, l, n]) => (
          <button key={String(k)} role="radio" aria-checked={filter === k} onClick={() => setFilter(String(k))}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold cursor-pointer ${filter === k ? 'bg-text-primary text-bg-secondary' : 'bg-bg-primary text-text-secondary'}`}>
            {l}<span className="ml-1 opacity-60">{n}</span>
          </button>
        ))}
      </div>
      {groups.filter(g => g.list.length).map(g => (
        <div key={g.label} className="flex flex-col gap-2" role="group" aria-label={g.label}>
          <div className="flex items-center gap-2 px-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted after:content-[''] after:flex-1 after:h-px after:bg-border">{g.label} · {g.list.length}</div>
          {g.list.map(card)}
        </div>
      ))}
    </>
  )
}

export type HistoryCard = { id: string; kind: string; title: string; subtitle: string; draft: string; payload?: Record<string, unknown>; status: string; createdAt: number; resolvedAt?: number; error?: string; closed?: { by: 'owner' | 'butler'; why?: string } }

const OUTCOME: Record<string, { text: string; cls: string }> = {
  approved: { text: 'Done', cls: 'text-status-working' },
  rejected: { text: 'Dismissed', cls: 'text-text-muted' },
  failed: { text: 'Failed', cls: 'text-status-waiting' }
}

/** "14:30" today, else "Tue 14:30". */
export function whenLabel(ms: number, now = new Date()): string {
  const d = new Date(ms)
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${t}`
}

/** What Butler's chat gets when the owner takes a past card to chat for a follow-up. */
export function historyDiscussText(it: HistoryCard): string {
  const p = it.payload
  const o = OUTCOME[it.status]?.text ?? it.status
  const sent = it.status === 'approved' ? (it.kind.startsWith('jira') ? 'What was applied' : 'What was sent') : 'What Butler proposed'
  return [
    'Follow up on this Butler item with me. Do not send or change anything until I confirm.',
    `${it.title} · ${it.subtitle} · card ${it.id}`,
    `Outcome: ${o} · ${new Date(it.resolvedAt ?? it.createdAt).toLocaleString('en-GB')}${it.error ? ` · error: ${it.error}` : ''}`,
    str(p, 'key') ? `Jira: ${str(p, 'key')}` : '',
    str(p, 'chatName') ? `Feishu chat: ${str(p, 'chatName')}` : '',
    str(p, 'about') ? `What it wanted: ${str(p, 'about')}` : '',
    str(p, 'question') ? `--- their message ---\n${str(p, 'question')}` : '',
    str(p, 'original') ? `--- email from ${str(p, 'from')} ---\n${str(p, 'original')}` : '',
    it.draft ? `--- ${sent.toLowerCase()} ---\n${it.draft}` : ''
  ].filter(Boolean).join('\n')
}

/** Butler → Approve, below the queue: what was approved, dismissed or failed this week. */
export function ApprovalHistory({ onDiscuss }: { onDiscuss?: OnDiscuss }) {
  const [items, setItems] = useState<HistoryCard[]>([])
  useEffect(() => {
    const load = () => { window.api.approvals.history().then(setItems).catch(() => {}) }
    load()
    return window.api.approvals.onChange(load)
  }, [])
  if (!items.length) return null
  return (
    <details className="rounded-xl bg-bg-primary px-3 py-2" aria-label="Approve history">
      <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">History · {items.length} this week</summary>
      <div className="mt-1 flex flex-col">
        {items.map(it => {
          const o = it.closed?.by === 'butler' ? { text: 'Closed by Butler', cls: 'text-text-muted' } : OUTCOME[it.status] ?? { text: it.status, cls: 'text-text-muted' }
          return (
            <details key={it.id} className="py-1 border-t border-border first:border-t-0">
              <summary className="flex items-center gap-2 cursor-pointer text-[12px] list-none">
                <span aria-hidden>{iconOf(it.kind)}</span>
                <span className="flex-1 min-w-0 truncate text-text-primary">{it.title}</span>
                <span className={o.cls}>{o.text}</span>
                <span className="text-text-muted">{whenLabel(it.resolvedAt ?? it.createdAt)}</span>
              </summary>
              <div className="mt-1 flex items-center gap-2 min-w-0"><span className="text-[11px] text-text-muted truncate">{it.subtitle}</span><JiraLink payload={it.payload} /></div>
              <div className="mt-1 rounded-lg bg-bg-secondary px-2.5 py-2 text-[12px] text-text-primary whitespace-pre-wrap">{it.draft}</div>
              {it.closed?.why && <div className="mt-1 text-[11.5px] text-text-secondary" aria-label="Why closed">Why: {it.closed.why}</div>}
              {it.error && <div className="mt-1 text-[11px] text-red-400 font-mono">{it.error}</div>}
              {onDiscuss && (
                <DiscussButton label={`Discuss ${it.title}`} text={() => historyDiscussText(it)} onDiscuss={onDiscuss} className="mt-1.5" />
              )}
            </details>
          )
        })}
      </div>
    </details>
  )
}
