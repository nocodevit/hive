import { useEffect, useState } from 'react'

type FeishuStatus =
  | { state: 'signed_out' }
  | { state: 'signing_in' }
  | { state: 'signed_in'; name: string; openId: string; scope: string; refreshExpiresAt: number }
  | { state: 'expired' }
  | { state: 'error'; error: string }

/** App Settings → Feishu: sign in with your own account (main/feishuAuth.ts). */
export function FeishuConnection() {
  const [s, setS] = useState<FeishuStatus | null>(null)

  useEffect(() => {
    let alive = true
    window.api.feishu.status().then(v => { if (alive) setS(v) })
    const off = window.api.feishu.onStatus(v => setS(v))
    return () => { alive = false; off() }
  }, [])

  const login = () => { void window.api.feishu.login() }
  const logout = async () => setS(await window.api.feishu.logout())

  const line =
    !s ? '' :
    s.state === 'signed_in' ? `Signed in · ${s.name || 'Feishu'}` :
    s.state === 'signing_in' ? 'Waiting for the browser…' :
    s.state === 'expired' ? 'Sign-in expired' :
    s.state === 'error' ? 'Sign-in failed' : 'Not connected'

  return (
    <div>
      <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-2">Feishu</label>
      <div className="rounded-xl bg-bg-secondary border border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span role="status" aria-label="Feishu sign-in" className={`text-sm ${s?.state === 'signed_in' ? 'text-accent' : s?.state === 'error' || s?.state === 'expired' ? 'text-red-400' : 'text-text-primary'}`}>{line}</span>
          {s?.state === 'signed_in' ? (
            <div className="flex gap-2">
              <button onClick={login} title="Sign in again to grant newly added permissions"
                className="px-3 py-1 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] cursor-pointer">Re-authorize</button>
              <button onClick={logout} className="px-3 py-1 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] cursor-pointer">Sign out</button>
            </div>
          ) : (
            <button onClick={login} disabled={!s || s.state === 'signing_in'}
              className="px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[13px] cursor-pointer disabled:opacity-50">
              {s?.state === 'expired' || s?.state === 'error' ? 'Sign in again' : s?.state === 'signing_in' ? 'Signing in…' : 'Sign in with Feishu'}
            </button>
          )}
        </div>
        {s?.state === 'error' && <p className="mt-1 text-[12px] text-text-muted font-mono">{s.error}</p>}
      </div>
    </div>
  )
}
