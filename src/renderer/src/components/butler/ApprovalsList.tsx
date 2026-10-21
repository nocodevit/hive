import { useEffect, useState } from 'react'

export type ApprovalCard = { id: string; kind: string; title: string; subtitle: string; draft: string; action: string; payload?: Record<string, unknown> }

const ICON: Record<string, string> = { email: '✉️', feishu: '💬', jira: '🎫' }
const iconOf = (kind: string) => ICON[kind.split('.')[0]] ?? '📝'
const DECIDE = 'email.decide'
const str = (p: Record<string, unknown> | undefined, k: string) => (typeof p?.[k] === 'string' ? (p[k] as string) : '')

/** What Butler's chat gets when the owner presses Discuss on a needs-you card. */
export function discussText(it: ApprovalCard): string {
  const p = it.payload
  return [
    'Help me decide how to answer this email. Do not send anything.',
    it.title,
    str(p, 'about') ? `What it wants: ${str(p, 'about')}` : '',
    `You need from me: ${str(p, 'question')}`,
    '',
    str(p, 'original') ? `--- email from ${str(p, 'from')} ---\n${str(p, 'original')}` : '',
    '',
    'When we agree, I will put the answer in the Approve card and you will write the reply there.'
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Butler → Approve: who/what + one button. A reply card's box is exactly what gets
 *  sent; a needs-you card has no Send — it asks, and offers Discuss or a short answer. */
export function ApprovalsList({ items, onDiscuss }: { items: ApprovalCard[]; onDiscuss?: (text: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Record<string, string>>({})
  useEffect(() => { if (editing && !items.some(i => i.id === editing)) setEditing(null) }, [items, editing])

  const approve = async (it: ApprovalCard) => {
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

  if (!items.length) return <div className="text-[12px] text-text-muted px-1">Nothing to approve</div>
  const btn = 'px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50'
  const icon = 'w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer'
  return (
    <>
      {items.map(it => {
        const decide = it.kind === DECIDE
        const about = str(it.payload, 'about')
        return (
          <div key={it.id} className="rounded-xl bg-bg-primary px-3 py-2.5 flex flex-col gap-1.5" aria-label={`${decide ? 'Needs you' : it.action}: ${it.title}`}>
            <div className="flex items-center gap-2">
              <span aria-hidden>{iconOf(it.kind)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-text-primary truncate">{it.title}</div>
                <div className="text-[11px] text-text-muted truncate">{it.subtitle}</div>
              </div>
              {decide ? (
                <button onClick={() => onDiscuss?.(discussText(it))} aria-label={`Discuss ${it.title}`} className={btn}>Discuss</button>
              ) : (
                <>
                  <button disabled={busy === it.id} onClick={() => approve(it)} aria-label={`${it.action} ${it.title}`} className={btn}>{busy === it.id ? '…' : it.action}</button>
                  <button onClick={() => { setEditing(editing === it.id ? null : it.id); setText(it.draft) }} aria-label={`Edit ${it.title}`} title="Edit reply" className={icon}>✎</button>
                </>
              )}
              <button onClick={() => window.api.approvals.reject(it.id)} aria-label={`Reject ${it.title}`} title="Dismiss" className={icon}>✕</button>
            </div>
            {about && <div className="text-[12px] text-text-secondary truncate" title={about} aria-label="What it wants">{about}</div>}
            {decide ? (
              <>
                <div className="text-[12px] text-status-waiting" aria-label="Butler asks">Needs you · {str(it.payload, 'question')}</div>
                <div className="flex items-center gap-2">
                  <input value={answers[it.id] ?? ''} onChange={e => setAnswers(x => ({ ...x, [it.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') answer(it) }} aria-label="Your answer to Butler" placeholder="Your answer to Butler · not sent"
                    className="flex-1 min-w-0 rounded-lg bg-bg-secondary border border-border px-2.5 py-1.5 text-[12px] text-text-primary focus:outline-none focus:border-accent" />
                  <button disabled={busy === it.id || !(answers[it.id] ?? '').trim()} onClick={() => answer(it)} className={btn}>{busy === it.id ? 'Writing…' : 'Write reply'}</button>
                </div>
              </>
            ) : editing === it.id ? (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-text-muted">{it.kind.startsWith('jira') ? 'Comment · added to the ticket' : 'Reply · sent exactly as written'}</span>
                <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Reply" rows={5}
                  className="w-full rounded-lg bg-bg-secondary border border-border px-2.5 py-2 text-[12px] text-text-primary focus:outline-none focus:border-accent resize-y" />
              </label>
            ) : (
              <details>
                <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">{it.kind.startsWith('jira') ? 'Comment' : 'Reply'}</summary>
                <div className="mt-1.5 rounded-lg bg-bg-secondary px-2.5 py-2 text-[12px] text-text-primary whitespace-pre-wrap">{it.draft}</div>
              </details>
            )}
            {error[it.id] && <div className="text-[11px] text-red-400 font-mono">{error[it.id]}</div>}
          </div>
        )
      })}
    </>
  )
}
