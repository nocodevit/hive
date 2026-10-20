import { useState } from 'react'
import { MAIL_PRESETS, mailPreset, presetForAddress, type MailAccountView, type MailPresetId, type MailServer } from '../../../../shared/butler-mail'
import { Switch } from './Switch'

interface Props {
  account?: MailAccountView
  /** Wizard: presets + address + password + test only. */
  minimal?: boolean
  onSaved: (a: MailAccountView) => void
  onCancel?: () => void
}

const input = 'px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent'
const ERR: Record<string, string> = {
  bad_address: 'Check the email address', missing_server: 'Server missing', no_password: 'Password needed',
  already_added: 'Already added', not_found: 'Account was removed', bad_input: 'Check the fields'
}

function ServerFields({ label, value, onChange }: { label: string; value: MailServer; onChange: (s: MailServer) => void }) {
  return (
    <div className="grid grid-cols-[1fr_72px] gap-2">
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">{label}
        <input className={input} value={value.host} onChange={e => onChange({ ...value, host: e.target.value })} placeholder="imap.example.com" />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">Port
        <input className={input} value={value.port} inputMode="numeric" onChange={e => onChange({ ...value, port: Number(e.target.value) || 0 })} />
      </label>
    </div>
  )
}

/** Add / edit one mail account: pick the provider, type address + client password, Test, Save. */
export function MailAccountForm({ account, minimal, onSaved, onCancel }: Props) {
  const [preset, setPreset] = useState<MailPresetId>(account?.preset ?? 'exmail')
  const [address, setAddress] = useState(account?.address ?? '')
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState(account?.label ?? '')
  const [sort, setSort] = useState(account?.sort ?? true)
  const [drafts, setDrafts] = useState(account?.drafts ?? true)
  const [imap, setImap] = useState<MailServer>(account?.imap ?? mailPreset('other')!.imap)
  const [smtp, setSmtp] = useState<MailServer>(account?.smtp ?? mailPreset('other')!.smtp)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const p = mailPreset(preset)!

  const data = () => ({ id: account?.id, address: address.trim(), preset, label, sort, drafts, imap, smtp, password: password || undefined })
  const onAddress = (v: string) => {
    setAddress(v)
    const guess = presetForAddress(v)
    if (guess && !account) setPreset(guess)
  }
  const runTest = async () => {
    setBusy(true); setTest(null)
    const r = await window.api.mail.test(data()).catch(e => ({ ok: false as const, error: String(e) }))
    setBusy(false)
    setTest(r.ok ? { ok: true, text: `✓ Connected · ${r.unread} unread` } : { ok: false, text: ERR[r.error] ?? r.error })
  }
  const save = async () => {
    setBusy(true)
    const r = await window.api.mail.save(data()).catch(e => ({ ok: false as const, error: String(e) }))
    setBusy(false)
    if (r.ok) { setPassword(''); onSaved(r.account) } else setTest({ ok: false, text: ERR[r.error] ?? r.error })
  }

  return (
    <div className="flex flex-col gap-2.5" aria-label="Email account">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Provider">
        {MAIL_PRESETS.map(x => (
          <button key={x.id} role="radio" aria-checked={preset === x.id} onClick={() => setPreset(x.id)}
            className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer border ${preset === x.id ? 'bg-accent-subtle text-accent border-accent' : 'bg-bg-primary text-text-muted border-transparent'}`}>{x.name}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">Email
          <input className={input} value={address} onChange={e => onAddress(e.target.value)} placeholder="you@company.com" autoComplete="off" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">{preset === 'gmail' ? 'App password' : 'Client password'}
          <input className={input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={account?.hasPassword ? 'saved' : ''} autoComplete="new-password" />
        </label>
      </div>
      {preset === 'other' && (
        <>
          <ServerFields label="IMAP" value={imap} onChange={setImap} />
          <ServerFields label="SMTP" value={smtp} onChange={setSmtp} />
        </>
      )}
      {test && <div role="status" className={`text-[12px] font-semibold ${test.ok ? 'text-status-working' : 'text-red-400 font-mono'}`}>{test.text}</div>}
      <details>
        <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">{preset === 'gmail' ? 'Get an app password' : 'Get a client password'}</summary>
        <div className="mt-1.5 flex flex-col gap-1 text-[12px] text-text-primary">
          {p.steps.map((s, i) => <div key={i}><span className="text-text-muted">{i + 1}.</span> {s}</div>)}
          {p.url && <button onClick={() => window.api.mail.openHelp(p.id)} className="self-start text-[12px] font-semibold text-accent cursor-pointer">Open {new URL(p.url).host} ↗</button>}
        </div>
      </details>
      {!minimal && (
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">More · servers · permissions</summary>
          <div className="mt-1.5 flex flex-col gap-1.5 text-[12px]">
            {preset !== 'other' && (
              <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
                <span className="text-text-muted">IMAP</span><span className="text-text-primary">{p.imap.host}:{p.imap.port}</span>
                <span className="text-text-muted">SMTP</span><span className="text-text-primary">{p.smtp.host}:{p.smtp.port}</span>
                <span className="text-text-muted">Stored</span><span className="text-text-primary">macOS Keychain</span>
              </div>
            )}
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">Label
              <input className={input} value={label} onChange={e => setLabel(e.target.value)} placeholder="Work" />
            </label>
            <div className="flex items-center justify-between"><span className="text-text-primary">Sort new mail</span><Switch on={sort} label="Sort new mail" onChange={setSort} /></div>
            <div className="flex items-center justify-between"><span className="text-text-primary">Draft replies</span><Switch on={drafts} label="Draft replies" onChange={setDrafts} /></div>
            <div className="text-text-muted">🔒 Send needs approval</div>
          </div>
        </details>
      )}
      <div className="flex justify-end gap-1.5">
        {onCancel && <button onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-bg-primary text-[12px] font-semibold text-text-primary cursor-pointer">Cancel</button>}
        <button onClick={runTest} disabled={busy || !address} className="px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-[12px] font-semibold text-text-primary cursor-pointer disabled:opacity-50">{busy ? '…' : 'Test'}</button>
        <button onClick={save} disabled={busy || !address || (!account && !password)} className="px-3 py-1.5 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">Save</button>
      </div>
    </div>
  )
}
