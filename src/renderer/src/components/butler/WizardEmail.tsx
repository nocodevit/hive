import { useEffect, useState } from 'react'
import { mailAccessLine, type MailAccountView } from '../../../../shared/butler-mail'
import { MailAccountForm } from './MailAccountForm'
import { ConsentNotice } from './ConsentNotice'

/** Wizard → Email: accounts already added, else the short add form. */
export function WizardEmail() {
  const [list, setList] = useState<MailAccountView[] | null>(null)
  const [adding, setAdding] = useState(false)
  const load = () => window.api.mail.list().then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])
  if (!list) return null
  if (!list.length || adding) return <MailAccountForm minimal onSaved={() => { setAdding(false); void load() }} onCancel={list.length ? () => setAdding(false) : undefined} />
  return (
    <>
      {list.map(a => (
        <div key={a.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-primary text-[13px] text-text-primary">
            <span className={`w-[7px] h-[7px] rounded-full ${a.status?.ok ? 'bg-status-working' : 'bg-status-done'}`} />
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="font-semibold truncate">{a.address}</span>
              <span className="text-[11px] text-text-muted" aria-label={`Access for ${a.address}`}>{mailAccessLine(a)}</span>
            </span>
            {a.status?.ok && <span className="text-[11px] font-mono text-text-muted">{a.status.unread ?? 0} unread</span>}
          </div>
          {a.consentAt === null && <ConsentNotice account={a} onDone={load} />}
        </div>
      ))}
      <button onClick={() => setAdding(true)} className="self-start text-[13px] font-semibold text-accent cursor-pointer">＋ Add account</button>
    </>
  )
}
