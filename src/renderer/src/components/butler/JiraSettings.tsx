import { useEffect, useState } from 'react'

type Role = 'request' | 'product' | 'engineering'
interface ProjectRow { key: string; role: Role; final: string; waiting: string; analysis: string; note: string; closed: string; designPath: string }
interface OwnerRow { name: string; user: string; labels: string; projects: string }
interface Form {
  projects: ProjectRow[]
  doneStatuses: string
  devLead: string
  owners: OwnerRow[]
  keepFrom: string
  parked: string
  review: string; progress: string; blocked: string; waitingDays: string; deadDays: string
  labelNotes: string
  notes: string
}

const csv = (v: string) => v.split(/[,，、]/).map(x => x.trim()).filter(Boolean)
const join = (v?: string[]) => (v ?? []).join(', ')

/** Settings JSON (main) → editable rows. */
export function toForm(s: any): Form {
  const rows: ProjectRow[] = Object.entries(s?.requests ?? {}).map(([key, r]: [string, any]) => ({
    key, role: 'request', final: r.final ?? '', waiting: r.waitingReporter ?? '', analysis: join(r.analysis), note: s?.projectNotes?.[key] ?? '',
    closed: join(r.closed), designPath: join(r.designPath)
  }))
  const blank = { final: '', waiting: '', analysis: '', closed: '', designPath: '' }
  if (s?.product?.key) rows.push({ key: s.product.key, role: 'product', ...blank, note: s?.projectNotes?.[s.product.key] ?? '' })
  if (s?.dev?.key) rows.push({ key: s.dev.key, role: 'engineering', ...blank, note: s?.projectNotes?.[s.dev.key] ?? '' })
  const a = s?.stale?.active ?? {}
  return {
    projects: rows,
    doneStatuses: join(s?.product?.done) || 'Released, Done',
    devLead: s?.dev?.lead ?? '',
    owners: (s?.owners ?? []).map((o: any) => ({ name: o.name, user: o.user, labels: join(o.labels), projects: join(o.projects) })),
    keepFrom: join(s?.keepFrom), parked: join(s?.parked),
    review: String(a['In Review'] ?? 7), progress: String(a['In Progress'] ?? 14), blocked: String(a['Blocked'] ?? 7),
    waitingDays: String(s?.stale?.waitingDays ?? 30), deadDays: String(s?.stale?.deadDays ?? 90),
    labelNotes: s?.labelNotes ?? '', notes: s?.notes ?? ''
  }
}

/** Editable rows → settings JSON (main normalizes and refuses without a product project). */
export function fromForm(f: Form): any {
  const requests: Record<string, any> = {}
  const notes: Record<string, string> = {}
  let product = ''
  let dev = ''
  for (const r of f.projects) {
    const key = r.key.trim().toUpperCase()
    if (!key) continue
    if (r.note.trim()) notes[key] = r.note.trim()
    if (r.role === 'product') product = key
    else if (r.role === 'engineering') dev = key
    else requests[key] = { final: r.final.trim(), closed: r.closed.trim() ? csv(r.closed) : ['Rejected'], analysis: csv(r.analysis), designPath: csv(r.designPath), waitingReporter: r.waiting.trim() }
  }
  const n = (v: string, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return {
    requests,
    product: { key: product, done: csv(f.doneStatuses) },
    ...(dev && f.devLead.trim() ? { dev: { key: dev, lead: f.devLead.trim() } } : {}),
    owners: f.owners.map(o => ({ name: o.name.trim(), user: o.user.trim(), labels: csv(o.labels), projects: csv(o.projects).map(p => p.toUpperCase()) })),
    keepFrom: csv(f.keepFrom), parked: csv(f.parked),
    stale: { active: { 'In Review': n(f.review, 7), 'In Progress': n(f.progress, 14), Blocked: n(f.blocked, 7) }, waitingDays: n(f.waitingDays, 30), deadDays: n(f.deadDays, 90) },
    projectNotes: notes, labelNotes: f.labelNotes, notes: f.notes
  }
}

const input = 'min-w-0 px-2 py-1 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary focus:outline-none focus:border-accent'
const btn = 'px-2.5 py-1 rounded-lg text-[12px] font-semibold cursor-pointer disabled:opacity-50'

type ConnView = Awaited<ReturnType<typeof window.api.jira.get>>['connection']
const MODES: Array<[ConnView['mode'], string]> = [['auto', 'Auto'], ['mcp', 'Stargate'], ['rest', 'Direct']]

/** How Butler reaches Jira: Stargate / MCP, direct REST (URL + token), or Auto (Stargate first). */
function JiraConnection({ view, onChange }: { view: ConnView; onChange: (v: ConnView) => void }) {
  const [c, setC] = useState({ mode: view.mode, url: view.url, email: view.email })
  const [token, setToken] = useState('')
  const [res, setRes] = useState('')
  const [busy, setBusy] = useState(false)
  const status = view.using === 'mcp' ? 'via Stargate' : view.using === 'rest' ? 'via REST' : 'not connected'
  const save = async () => {
    setBusy(true)
    const v = await window.api.jira.saveConnection(c, token || undefined)
    setBusy(false); setToken(''); setRes(v.using ? `Saved · ${v.using === 'mcp' ? 'via Stargate' : 'via REST'}` : 'Saved · not connected'); onChange(v)
  }
  const test = async () => {
    setBusy(true); setRes('')
    const r = await window.api.jira.testConnection(c, token || undefined)
    setBusy(false); setRes(r.ok ? `✓ ${r.name}` : r.error ?? 'failed')
  }
  return (
    <div className="rounded-lg bg-bg-primary px-2.5 py-2 flex flex-col gap-2" role="group" aria-label="Jira connection">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-text-muted">Connection</span>
        <span className={`flex-1 text-[12px] ${view.using ? 'text-status-working' : 'text-status-waiting'}`}>{status}</span>
        <span className="inline-flex p-0.5 rounded-lg bg-bg-secondary">
          {MODES.map(([m, l]) => (
            <button key={m} onClick={() => setC({ ...c, mode: m })} aria-pressed={c.mode === m}
              className={`px-2 py-0.5 rounded-md text-[11px] cursor-pointer ${c.mode === m ? 'bg-bg-primary text-text-primary font-semibold shadow-sm' : 'text-text-muted'}`}>{l}</button>
          ))}
        </span>
      </div>
      {c.mode !== 'mcp' && (
        <div className="flex flex-col gap-1.5 text-[12px] text-text-muted">
          {c.mode === 'auto' && <span className="text-[11px]">Stargate first{view.mcp ? '' : ' (no Jira tools there)'}; else direct:</span>}
          <label className="flex items-center gap-2"><span className="w-16">Jira URL</span><input aria-label="Jira URL" value={c.url} placeholder="https://jira.example.com" onChange={e => setC({ ...c, url: e.target.value })} className={`${input} flex-1 font-mono`} /></label>
          <label className="flex items-center gap-2"><span className="w-16">Token</span><input aria-label="Jira token" type="password" value={token} placeholder={view.hasToken ? '•••••• saved' : 'personal access token'} onChange={e => setToken(e.target.value)} className={`${input} flex-1 font-mono`} /></label>
          <label className="flex items-center gap-2"><span className="w-16">Email</span><input aria-label="Jira email" value={c.email} placeholder="Cloud only" onChange={e => setC({ ...c, email: e.target.value })} className={`${input} flex-1`} /></label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] text-text-muted truncate" aria-live="polite" aria-label="Jira connection result">{res}</span>
        <button onClick={test} disabled={busy} aria-label="Test connection" className={`${btn} bg-bg-secondary text-text-primary`}>Test</button>
        <button onClick={save} disabled={busy} aria-label="Save connection" className={`${btn} bg-accent text-text-on-purple`}>Save</button>
      </div>
    </div>
  )
}

/** Settings › Jira: the owner's company specifics (not a skill). "Set up from Jira" drafts them. */
export function JiraSettings() {
  const [form, setForm] = useState<Form | null>(null)
  const [connected, setConnected] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState<'' | 'discover' | 'save'>('')
  const [msg, setMsg] = useState('')
  const [conn, setConn] = useState<ConnView | null>(null)
  useEffect(() => {
    window.api.jira.get().then(r => { setConnected(r.connected); setConn(r.connection); setSaved(!!r.settings); setForm(toForm(r.settings)) }).catch(() => {})
  }, [])
  if (!form) return null
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f!, ...patch }))
  const setRow = (i: number, patch: Partial<ProjectRow>) => set({ projects: form.projects.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const setOwner = (i: number, patch: Partial<OwnerRow>) => set({ owners: form.owners.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const discover = async () => {
    setBusy('discover'); setMsg('')
    const r = await window.api.jira.discover()
    setBusy('')
    if (r.ok && r.draft) { setForm(toForm(r.draft)); setDraft(true); setMsg('Draft from your Jira — check each line, then Save') }
    else setMsg(r.error ?? 'failed')
  }
  const save = async () => {
    setBusy('save'); setMsg('')
    const r = await window.api.jira.save(fromForm(form))
    setBusy('')
    if (r.ok) { setSaved(true); setDraft(false); setForm(toForm(r.settings)); setMsg('Saved') } else setMsg(r.error ?? 'failed')
  }
  return (
    <div className="flex flex-col gap-2.5">
      {conn && <JiraConnection view={conn} onChange={v => { setConn(v); setConnected(!!v.using) }} />}
      <div className="flex items-center gap-2">
        <span className={`flex-1 text-[12px] ${saved ? 'text-text-primary' : 'text-text-muted'}`}>
          {!connected ? 'Jira not connected' : saved ? `Set up · ${form.projects.length} projects` : 'Not set up'}
        </span>
        <button onClick={discover} disabled={!connected || busy !== ''} className={`${btn} bg-bg-primary text-accent`}>{busy === 'discover' ? 'Looking at your Jira…' : 'Set up from Jira'}</button>
        <button onClick={save} disabled={busy !== ''} className={`${btn} bg-accent text-text-on-purple`}>{busy === 'save' ? '…' : 'Save'}</button>
      </div>
      {msg && <div className={`text-[12px] ${draft ? 'text-status-waiting' : 'text-text-muted'}`} role="status">{msg}</div>}

      <div className="flex flex-col gap-1" role="group" aria-label="Jira projects">
        <span className="text-[11px] font-semibold text-text-muted">Projects</span>
        {form.projects.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input aria-label={`Project ${i + 1} key`} value={r.key} placeholder="KEY" onChange={e => setRow(i, { key: e.target.value })} className={`${input} w-20 font-mono`} />
            <select aria-label={`Project ${i + 1} role`} value={r.role} onChange={e => setRow(i, { role: e.target.value as Role })} className={`${input} w-28`}>
              <option value="request">Request</option><option value="product">Product</option><option value="engineering">Engineering</option>
            </select>
            {r.role === 'request' && <input aria-label={`Project ${i + 1} final status`} value={r.final} placeholder="Final status" onChange={e => setRow(i, { final: e.target.value })} className={`${input} w-28`} />}
            <input aria-label={`Project ${i + 1} note`} value={r.note} placeholder="What it holds" onChange={e => setRow(i, { note: e.target.value })} className={`${input} flex-1`} />
            <button aria-label={`Remove project ${i + 1}`} onClick={() => set({ projects: form.projects.filter((_, j) => j !== i) })} className="text-text-muted cursor-pointer px-1">×</button>
          </div>
        ))}
        <button onClick={() => set({ projects: [...form.projects, { key: '', role: 'request', final: '', waiting: '', analysis: '', note: '', closed: '', designPath: '' }] })} className="self-start text-[12px] text-accent cursor-pointer">＋ Project</button>
      </div>

      {form.projects.some(r => r.role === 'engineering') && (
        <label className="flex items-center gap-2 text-[12px] text-text-muted">
          <span className="w-20 shrink-0 font-semibold">Dev lead</span>
          <input aria-label="Dev lead" value={form.devLead} placeholder="jira username" onChange={e => set({ devLead: e.target.value })} className={`${input} flex-1`} />
        </label>
      )}

      <div className="flex flex-col gap-1" role="group" aria-label="Jira owners">
        <span className="text-[11px] font-semibold text-text-muted">Who owns what</span>
        {form.owners.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input aria-label={`Owner ${i + 1} name`} value={o.name} placeholder="Name" onChange={e => setOwner(i, { name: e.target.value })} className={`${input} w-24`} />
            <input aria-label={`Owner ${i + 1} user`} value={o.user} placeholder="jira username" onChange={e => setOwner(i, { user: e.target.value })} className={`${input} w-40`} />
            <input aria-label={`Owner ${i + 1} labels`} value={o.labels} placeholder="labels" onChange={e => setOwner(i, { labels: e.target.value })} className={`${input} flex-1`} />
            <input aria-label={`Owner ${i + 1} projects`} value={o.projects} placeholder="projects" onChange={e => setOwner(i, { projects: e.target.value })} className={`${input} w-24 font-mono`} />
            <button aria-label={`Remove owner ${i + 1}`} onClick={() => set({ owners: form.owners.filter((_, j) => j !== i) })} className="text-text-muted cursor-pointer px-1">×</button>
          </div>
        ))}
        <button onClick={() => set({ owners: [...form.owners, { name: '', user: '', labels: '', projects: '' }] })} className="self-start text-[12px] text-accent cursor-pointer">＋ Owner</button>
      </div>

      <details>
        <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">More · statuses · thresholds · labels</summary>
        <div className="mt-2 flex flex-col gap-2 text-[12px] text-text-muted">
          {form.projects.map((r, i) => r.role === 'request' && (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-16 font-mono">{r.key || '—'}</span>
              <input aria-label={`${r.key} analysis statuses`} value={r.analysis} placeholder="Analysis statuses" onChange={e => setRow(i, { analysis: e.target.value })} className={`${input} flex-1`} />
              <input aria-label={`${r.key} waiting for reporter`} value={r.waiting} placeholder="Waiting for reporter" onChange={e => setRow(i, { waiting: e.target.value })} className={`${input} w-40`} />
            </div>
          ))}
          <label className="flex items-center gap-2"><span className="w-28">Product shipped</span><input aria-label="Product shipped statuses" value={form.doneStatuses} onChange={e => set({ doneStatuses: e.target.value })} className={`${input} flex-1`} /></label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-28">Stuck after (days)</span>
            {([['review', 'In Review'], ['progress', 'In Progress'], ['blocked', 'Blocked']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">{l}<input aria-label={`${l} days`} value={form[k]} onChange={e => set({ [k]: e.target.value } as Partial<Form>)} className={`${input} w-12 font-mono`} /></label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-28">Not started · backlog</span>
            <input aria-label="Not started days" value={form.waitingDays} onChange={e => set({ waitingDays: e.target.value })} className={`${input} w-12 font-mono`} />
            <input aria-label="Backlog days" value={form.deadDays} onChange={e => set({ deadDays: e.target.value })} className={`${input} w-12 font-mono`} />
          </div>
          <label className="flex items-center gap-2"><span className="w-28">Parked statuses</span><input aria-label="Parked statuses" value={form.parked} onChange={e => set({ parked: e.target.value })} className={`${input} flex-1`} /></label>
          <label className="flex items-center gap-2"><span className="w-28">Keep tickets from</span><input aria-label="Keep tickets from" value={form.keepFrom} placeholder="usernames" onChange={e => set({ keepFrom: e.target.value })} className={`${input} flex-1`} /></label>
          <label className="flex flex-col gap-1">Labels mean<textarea aria-label="Labels mean" value={form.labelNotes} rows={3} onChange={e => set({ labelNotes: e.target.value })} className={input} /></label>
          <label className="flex flex-col gap-1">Notes<textarea aria-label="Jira notes" value={form.notes} rows={2} onChange={e => set({ notes: e.target.value })} className={input} /></label>
        </div>
      </details>
    </div>
  )
}
