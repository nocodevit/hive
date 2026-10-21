import { useState } from 'react'
import type { MailAccountView } from '../../../../shared/butler-mail'

/** Account added before the consent question: one line + Confirm. */
export function ConsentNotice({ account: a, onDone }: { account: MailAccountView; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    await window.api.mail.save({ id: a.id, address: a.address, preset: a.preset, consent: true }).catch(() => {})
    setBusy(false)
    onDone()
  }
  return (
    <div role="note" aria-label={`Consent needed: ${a.address}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-primary text-[12px]">
      <span className="w-[7px] h-[7px] rounded-full bg-status-waiting flex-shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 truncate text-text-primary" title="Sent only when you press Send in Approve">Confirm Butler may read and draft</span>
      <button onClick={confirm} disabled={busy} className="px-2.5 py-0.5 rounded-md bg-accent text-text-on-purple font-semibold cursor-pointer disabled:opacity-50">Confirm</button>
    </div>
  )
}
