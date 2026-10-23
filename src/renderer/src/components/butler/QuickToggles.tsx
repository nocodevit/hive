import { useEffect, useState } from 'react'
import { feishuToggle, mobileToggle, wakeToggle, type FeishuToggleView, type MobileState, type WakeView } from '../../lib/quick-toggles'

function Toggle({ icon, label, title, checked, disabled, alert, onClick }: { icon: string; label: string; title: string; checked: boolean; disabled?: boolean; alert?: 'error' | 'warn' | null; onClick: () => void }) {
  return (
    <span title={title} className="inline-flex">
      <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}
        className={`relative h-[30px] pl-2 pr-1.5 rounded-full inline-flex items-center gap-1.5 bg-bg-secondary shadow-sm hover:bg-bg-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${alert === 'error' ? 'ring-1 ring-red-400' : alert === 'warn' ? 'ring-1 ring-status-waiting' : ''}`}>
        {alert && <span role="img" aria-label={alert === 'error' ? `${label} not working` : `${label} needs you`} className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-bg-secondary ${alert === 'error' ? 'bg-red-400' : 'bg-status-waiting'}`} />}
        <span className={`text-[13px] ${checked ? '' : 'grayscale opacity-50'}`} aria-hidden>{icon}</span>
        <span className={`relative w-7 h-4 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'}`} aria-hidden>
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-[left] ${checked ? 'left-[14px]' : 'left-0.5'}`} />
        </span>
      </button>
    </span>
  )
}

/** 📱 Mobile Butler, 💬 Feishu answer-for-me and 🎙 “Hola Butler” listening, as switches next to the Butler button. Take effect at once. */
export function QuickToggles({ setupMarks, onSetupMobile }: { setupMarks: Record<string, unknown>; onSetupMobile: () => void }) {
  const [mobile, setMobile] = useState<MobileState | null>(null)
  const [feishu, setFeishu] = useState<FeishuToggleView | null>(null)
  const [wake, setWake] = useState<WakeView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.butler.state().then(s => { if (alive) setMobile(s) }).catch(() => {})
    const off = window.api.butler.onState(s => setMobile(s))
    const loadF = () => window.api.feishuAgent.get().then(v => { if (alive) setFeishu(v) }).catch(() => {})
    loadF()
    const offA = window.api.feishuAgent.onChange(loadF)
    const offF = window.api.feishu.onStatus(loadF)
    window.api.wake.state().then(w => { if (alive) setWake(w) }).catch(() => {})
    const offW = window.api.wake.onEvent(ev => { if (ev.type === 'state') setWake(ev.state) })
    return () => { alive = false; off(); offA(); offF(); offW() }
  }, [])

  const m = mobileToggle(mobile, setupMarks)
  const f = feishuToggle(feishu)
  const flipMobile = async () => {
    if (m.action === 'wizard') return onSetupMobile()
    if (busy) return
    setBusy(true)
    try { setMobile(await window.api.butler.setEnabled(m.action === 'on')) } finally { setBusy(false) }
  }
  const flipFeishu = async () => setFeishu(await window.api.feishuAgent.set({ enabled: !f.checked }))
  const w = wakeToggle(wake)
  const flipWake = async () => setWake(await window.api.wake.setEnabled(!w.checked))

  return (
    <div className="no-drag inline-flex items-center gap-1 flex-shrink-0">
      <Toggle icon="📱" label="Mobile Butler" title={m.title} checked={m.checked} disabled={m.disabled || busy} alert={m.alert} onClick={flipMobile} />
      <Toggle icon="💬" label="Feishu answer-for-me" title={f.title} checked={f.checked} disabled={f.disabled} alert={f.alert} onClick={flipFeishu} />
      <Toggle icon="🎙" label="Listen for Hola Butler" title={w.title} checked={w.checked} disabled={w.disabled} alert={w.alert} onClick={flipWake} />
    </div>
  )
}
