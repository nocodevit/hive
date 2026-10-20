import { useEffect, useState } from 'react'

type Item = { id: string; kind: string; title: string; subtitle: string; draft: string; action: string }

const ICON: Record<string, string> = { email: '✉️', feishu: '💬', jira: '🎫' }
const iconOf = (kind: string) => ICON[kind.split('.')[0]] ?? '📝'

/** Butler → Approve: who/what + one button; the draft is folded until asked for. */
export function ApprovalsList({ items }: { items: Item[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Record<string, string>>({})
  useEffect(() => { if (editing && !items.some(i => i.id === editing)) setEditing(null) }, [items, editing])

  const approve = async (it: Item) => {
    setBusy(it.id)
    const r = await window.api.approvals.approve(it.id, editing === it.id ? text : undefined)
    setBusy(null)
    if (!r.ok) setError(e => ({ ...e, [it.id]: r.error || 'failed' }))
    else setEditing(null)
  }

  if (!items.length) return <div className="text-[12px] text-text-muted px-1">Nothing to approve</div>
  return (
    <>
      {items.map(it => (
        <div key={it.id} className="rounded-xl bg-bg-primary px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span aria-hidden>{iconOf(it.kind)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-text-primary truncate">{it.title}</div>
              <div className="text-[11px] text-text-muted truncate">{it.subtitle}</div>
            </div>
            <button disabled={busy === it.id} onClick={() => approve(it)} aria-label={`${it.action} ${it.title}`}
              className="px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">{busy === it.id ? '…' : it.action}</button>
            <button onClick={() => { setEditing(editing === it.id ? null : it.id); setText(it.draft) }} aria-label={`Edit ${it.title}`} title="Edit"
              className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">✎</button>
            <button onClick={() => window.api.approvals.reject(it.id)} aria-label={`Reject ${it.title}`} title="Reject"
              className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">✕</button>
          </div>
          {editing === it.id ? (
            <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Draft" rows={4}
              className="w-full rounded-lg bg-bg-secondary border border-border px-2.5 py-2 text-[12px] text-text-primary focus:outline-none focus:border-accent resize-y" />
          ) : (
            <details>
              <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">Draft</summary>
              <div className="mt-1.5 rounded-lg bg-bg-secondary px-2.5 py-2 text-[12px] text-text-primary whitespace-pre-wrap">{it.draft}</div>
            </details>
          )}
          {error[it.id] && <div className="text-[11px] text-red-400 font-mono">{error[it.id]}</div>}
        </div>
      ))}
    </>
  )
}
