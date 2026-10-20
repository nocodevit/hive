import { useEffect, useState } from 'react'

/**
 * Shown only when a Feishu session could not be renewed (Hive and its
 * routines did not run for ~7 days, or the 365-day grant ran out). One
 * click signs in again; it disappears once signed in.
 */
export function FeishuExpiredBanner() {
  const [expired, setExpired] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const apply = (s: { state: string }) => {
      setExpired(s.state === 'expired')
      if (s.state === 'signed_in') setHidden(false)
      setBusy(s.state === 'signing_in')
    }
    window.api.feishu.status().then(apply).catch(() => {})
    return window.api.feishu.onStatus(apply)
  }, [])

  if (!expired || hidden) return null
  return (
    <div role="alert" aria-label="Feishu sign-in expired"
      className="no-drag fixed z-[60] top-3 left-1/2 -translate-x-1/2 flex items-center gap-2.5 pl-3.5 pr-2 py-1.5 rounded-full bg-bg-secondary shadow-e3 border border-status-waiting/60 text-[13px]">
      <span className="w-[7px] h-[7px] rounded-full bg-status-waiting" />
      <span className="font-semibold text-text-primary">Feishu sign-in expired</span>
      <button onClick={() => { setBusy(true); void window.api.feishu.login() }} disabled={busy}
        className="px-3 py-1 rounded-full bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">
        {busy ? 'Signing in…' : 'Sign in again'}
      </button>
      <button onClick={() => setHidden(true)} aria-label="Hide" className="w-6 h-6 rounded-full text-text-muted hover:bg-bg-hover cursor-pointer">✕</button>
    </div>
  )
}
