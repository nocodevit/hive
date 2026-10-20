import { useEffect, useState } from 'react'
import type { MailAccountView } from '../../../../shared/butler-mail'
import { MailAccountForm } from './MailAccountForm'

function dot(a: MailAccountView): string {
  if (a.paused) return 'bg-status-done'
  if (!a.status) return 'bg-status-done'
  return a.status.ok ? 'bg-status-working' : 'bg-status-waiting'
}

/** App Settings → Email: one row per account, ＋ Add account. */
export function EmailAccounts() {
  const [list, setList] = useState<MailAccountView[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  const load = () => window.api.mail.list().then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])

  const pause = async (a: MailAccountView) => {
    setMenu(null)
    await window.api.mail.save({ id: a.id, address: a.address, preset: a.preset, paused: !a.paused })
    void load()
  }
  const remove = async (id: string) => {
    setConfirm(null); setMenu(null)
    await window.api.mail.remove(id)
    void load()
  }

  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Email</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-2.5 flex flex-col gap-2">
        {list?.map(a => editing === a.id ? (
          <MailAccountForm key={a.id} account={a} onSaved={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} />
        ) : (
          <div key={a.id} className="relative flex items-center gap-2.5 text-[13px]">
            <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${dot(a)}`} title={a.status?.error || ''} />
            <span className="flex-1 min-w-0 truncate text-text-primary">{a.address}{a.label && <span className="text-text-muted"> · {a.label}</span>}</span>
            <span className="text-[11px] font-mono text-text-muted">
              {a.paused ? 'paused' : a.status?.ok ? `${a.status.unread ?? 0} unread` : a.status?.error ? 'error' : ''}
            </span>
            <button onClick={() => setMenu(menu === a.id ? null : a.id)} aria-label={`More for ${a.address}`} className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">···</button>
            {menu === a.id && (
              <div className="absolute right-0 top-8 z-10 rounded-lg bg-bg-primary border border-border shadow-e3 flex flex-col py-1 text-[12px] min-w-[120px]">
                <button onClick={() => { setMenu(null); setEditing(a.id) }} className="px-3 py-1.5 text-left hover:bg-bg-hover cursor-pointer text-text-primary">Edit</button>
                <button onClick={() => pause(a)} className="px-3 py-1.5 text-left hover:bg-bg-hover cursor-pointer text-text-primary">{a.paused ? 'Resume' : 'Pause'}</button>
                {confirm === a.id ? (
                  <button onClick={() => remove(a.id)} className="px-3 py-1.5 text-left hover:bg-bg-hover cursor-pointer text-red-400 font-semibold">Remove?</button>
                ) : (
                  <button onClick={() => setConfirm(a.id)} className="px-3 py-1.5 text-left hover:bg-bg-hover cursor-pointer text-red-400">Remove</button>
                )}
              </div>
            )}
          </div>
        ))}
        {list && !list.length && editing !== 'new' && <div className="text-[13px] text-text-muted">No accounts</div>}
        {editing === 'new' ? (
          <MailAccountForm onSaved={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} />
        ) : (
          <button onClick={() => setEditing('new')} className="self-start text-[13px] font-semibold text-accent cursor-pointer">＋ Add account</button>
        )}
      </div>
    </div>
  )
}
