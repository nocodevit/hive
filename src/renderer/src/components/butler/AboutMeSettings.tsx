import { useEffect, useState } from 'react'
import { PROFILE_FRONT, PROFILE_MORE, acceptPlaceholderOnTab, sameProfile, toProfile, type Profile, type ProfileKey } from '../../lib/butler-skills'

const STYLE_OPTS = [['direct', 'Direct'], ['warm', 'Warm'], ['formal', 'Formal']] as const

export const sectionLabel = 'block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2'
export const summaryCls = 'cursor-pointer text-[12px] font-semibold text-text-muted select-none'

export function Field({ label, value, onChange, placeholder, disabled, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; multiline?: boolean }) {
  if (multiline) return (
    <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      {label}
      <textarea value={value} placeholder={placeholder} disabled={disabled} rows={3} onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)}
        className="px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent resize-y disabled:opacity-50" />
    </label>
  )
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      {label}
      <input value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)}
        className="px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent disabled:opacity-50" />
    </label>
  )
}

/** App Settings → About me: the four fields that matter + style up front; the rest folded. */
export function AboutMeSettings() {
  const [saved, setSaved] = useState<Profile | null>(null)
  const [p, setP] = useState<Profile | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.butler.profile().then(r => { const v = toProfile(r); setSaved(v); setP(v) }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!p) return
    let alive = true
    window.api.butlerSkills.profilePreview(p).then(t => { if (alive) setPreview(t) }).catch(() => {})
    return () => { alive = false }
  }, [p])

  if (!p || !saved) return null
  const set = (k: ProfileKey, v: string) => setP({ ...p, [k]: v })
  const dirty = !sameProfile(p, saved)
  const save = async () => {
    setBusy(true)
    try { const v = toProfile(await window.api.butler.saveProfile(p)); setSaved(v); setP(v) } finally { setBusy(false) }
  }

  return (
    <div role="group" aria-label="About me">
      <div className="flex items-center justify-between mb-2">
        <label className={sectionLabel.replace(' mb-2', '')}>About me</label>
        <button onClick={save} disabled={!dirty || busy}
          className="px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default">
          {busy ? '…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          {PROFILE_FRONT.slice(0, 2).map(([k, label, ph]) => <Field key={k} label={label} value={p[k]} placeholder={ph} onChange={v => set(k, v)} />)}
        </div>
        <div className="inline-flex self-start gap-0.5 p-[3px] rounded-[10px] bg-bg-primary" role="radiogroup" aria-label="Style">
          {STYLE_OPTS.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={p.style === id} onClick={() => set('style', id)}
              className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${p.style === id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted'}`}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {PROFILE_FRONT.slice(2).map(([k, label, ph]) => <Field key={k} label={label} value={p[k]} placeholder={ph} onChange={v => set(k, v)} />)}
        </div>
        <details>
          <summary className={summaryCls}>More · names · phrases · prefix · extra</summary>
          <div className="grid grid-cols-2 gap-2.5 mt-2">
            {PROFILE_MORE.map(([k, label, ph]) => <Field key={k} label={label} value={p[k]} placeholder={ph} multiline={k === 'extra'} onChange={v => set(k, v)} />)}
          </div>
        </details>
        <details>
          <summary className={summaryCls}>What your agent reads</summary>
          <pre aria-label="What your agent reads" className="mt-2 rounded-lg bg-bg-primary px-3 py-2 text-[12px] leading-relaxed text-text-primary whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{preview}</pre>
        </details>
      </div>
    </div>
  )
}
