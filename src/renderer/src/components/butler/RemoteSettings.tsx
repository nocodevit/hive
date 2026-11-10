import { useEffect, useState } from 'react'

type View = Awaited<ReturnType<typeof window.api.remote.view>>
type Device = View['devices'][number]

const RESULT: Record<string, string> = {
  butler: 'to Butler', card: 'card in Approve', sent: 'sent',
  peer_offline: 'their Mac offline', their_remote_off: 'their Remote off', not_allowed_by_them: 'they have not added you', failed: 'failed'
}
const hm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Butler settings → Remote Butler: talk to another person's Hive Butler over Tailscale (main/remote.ts).
 *  Tailscale is only checked when the switch is turned on; if it is missing or not connected the switch stays off. */
export function RemoteSettings() {
  const [view, setView] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ error: string; message: string } | null>(null)
  const [port, setPort] = useState('')

  useEffect(() => {
    let alive = true
    window.api.remote.view().then(v => { if (alive) { setView(v); setPort(String(v.port)) } }).catch(() => {})
    const off = window.api.remote.onChange(v => setView(v))
    return () => { alive = false; off() }
  }, [])

  const enabled = view?.enabled ?? false
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      const r = await window.api.remote.setEnabled(!enabled)
      setView(r.view)
      if (!r.ok) setProblem({ error: r.error ?? '', message: r.message })
    } finally { setBusy(false) }
  }
  const savePort = async () => {
    const n = Number(port)
    if (!view || n === view.port) return
    const r = await window.api.remote.setPort(n)
    setView(r.view)
    if (!r.ok) setPort(String(r.view.port))
  }
  const setPeer = async (id: string, peer: Parameters<typeof window.api.remote.setPeer>[1]) => setView(await window.api.remote.setPeer(id, peer))

  const ts = view?.tailscale
  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Remote Butler</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-primary">Talk to other Hives’ Butlers</span>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Talk to other Hives’ Butlers"
            disabled={!view || busy}
            onClick={toggle}
            className={`w-9 h-5 shrink-0 rounded-full cursor-pointer transition-colors relative disabled:opacity-50 ${enabled ? 'bg-accent' : 'bg-bg-hover'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
        {busy && !enabled && <div className="mt-1.5 text-[13px] text-text-muted" role="status">Checking Tailscale…</div>}
        {problem && (
          <div role="alert" className="mt-1.5 text-[13px]">
            <span className="text-red-400">{problem.message}</span>
            <span className="ml-2 inline-flex gap-2">
              {problem.error === 'tailscale_missing'
                ? <button onClick={() => void window.api.remote.openTailscale('download')} className="text-accent hover:underline cursor-pointer">Install Tailscale</button>
                : <button onClick={() => void window.api.remote.openTailscale('app')} className="text-accent hover:underline cursor-pointer">Open Tailscale</button>}
            </span>
          </div>
        )}

        {enabled && view && (
          <div className="mt-2 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[13px]" role="status">
              <span aria-hidden className={`w-2 h-2 rounded-full ${view.listening ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-text-primary">{view.listening ? 'On' : 'Not reachable'}</span>
              <span className="text-text-muted truncate">
                · Tailscale {ts?.state === 'Running' ? `${ts.selfName ?? ''}${ts.selfLogin ? ` (${ts.selfLogin})` : ''}` : (ts?.state ?? '').toLowerCase()}
                {view.listenError ? ` · ${view.listenError}` : view.address ? ` · ${view.address}` : ''}
              </span>
              <span className="flex-1" />
              <button onClick={async () => setView(await window.api.remote.refresh())} aria-label="Check again" className="text-text-muted hover:text-text-primary cursor-pointer">↻</button>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-text-muted">
              Port
              <input value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} onBlur={savePort}
                onKeyDown={e => { if (e.key === 'Enter') void savePort() }} aria-label="Remote port" inputMode="numeric"
                className="w-20 h-6 rounded-md bg-bg-primary border border-border px-2 font-mono text-[12px] text-text-primary focus:outline-none focus:border-accent" />
            </label>

            <div role="group" aria-label="Devices">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">Who can talk to my Butler</div>
              {view.devices.length === 0 && <div className="text-[12.5px] text-text-muted">No other devices on your Tailscale network yet.</div>}
              <div className="flex flex-col gap-1">
                {view.devices.map(d => <DeviceRow key={d.id} d={d} setPeer={setPeer} />)}
              </div>
              <div className="mt-1 text-[11.5px] text-text-muted">Both sides must add each other.</div>
            </div>

            {view.log.length > 0 && (
              <details className="text-[12px] text-text-muted">
                <summary className="cursor-pointer select-none">Recent ({view.log.length})</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {view.log.slice(0, 20).map(e => (
                    <li key={e.id} className="truncate">
                      <span className="font-mono">{hm(e.at)}</span> {e.dir === 'in' ? '←' : '→'} {e.peerName} · {RESULT[e.result] ?? e.result} · <span className="text-text-secondary">{e.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DeviceRow({ d, setPeer }: { d: Device; setPeer: (id: string, p: Parameters<typeof window.api.remote.setPeer>[1]) => Promise<void> }) {
  const [name, setName] = useState(d.allowed?.name ?? '')
  useEffect(() => { setName(d.allowed?.name ?? '') }, [d.allowed?.name])
  const allowed = !!d.allowed
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-bg-hover/50 text-[12.5px]">
      <input type="checkbox" checked={allowed} aria-label={`Allow ${d.name}`}
        onChange={e => void setPeer(d.id, e.target.checked ? {} : null)} className="accent-[var(--accent)] cursor-pointer" />
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-text-muted/40'}`} />
      <span className="text-text-primary truncate">{d.name}</span>
      <span className="text-text-muted truncate">{d.login}</span>
      <span className="flex-1" />
      {allowed && (
        <>
          <input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== d.allowed?.name) void setPeer(d.id, { name: name.trim() }) }}
            aria-label={`Name for ${d.name}`} title="The name Butler uses: ./hive remote send NAME"
            className="w-24 h-6 rounded-md bg-bg-primary border border-border px-2 text-[12px] text-text-primary focus:outline-none focus:border-accent" />
          <select value={d.allowed!.mode} onChange={e => void setPeer(d.id, { mode: e.target.value as 'ask' | 'auto' })} aria-label={`What happens with ${d.name}'s messages`}
            className="h-6 rounded-md bg-bg-primary border border-border px-1 text-[12px] text-text-primary cursor-pointer">
            <option value="ask">Ask me first</option>
            <option value="auto">Straight to Butler</option>
          </select>
        </>
      )}
    </div>
  )
}
