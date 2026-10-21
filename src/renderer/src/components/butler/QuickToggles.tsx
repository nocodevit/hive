import { useEffect, useState } from 'react'
import { feishuToggle, mobileToggle, type FeishuToggleView, type MobileState } from '../../lib/quick-toggles'

function Toggle({ icon, label, title, checked, disabled, onClick }: { icon: string; label: string; title: string; checked: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <span title={title} className="inline-flex">
      <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}
        className={`relative w-[30px] h-[30px] rounded-full inline-flex items-center justify-center text-[14px] shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          checked ? 'bg-accent-subtle ring-1 ring-accent' : 'bg-bg-secondary hover:bg-bg-hover'}`}>
        <span className={checked ? '' : 'grayscale opacity-50'} aria-hidden>{icon}</span>
        {checked && <span className="absolute -right-px -bottom-px w-2 h-2 rounded-full bg-status-working border-2 border-bg-secondary" aria-hidden />}
      </button>
    </span>
  )
}

/** 📱 Mobile Butler + 💬 Feishu answer-for-me, right next to the Butler button. Take effect at once. */
export function QuickToggles({ setupMarks, onSetupMobile }: { setupMarks: Record<string, unknown>; onSetupMobile: () => void }) {
  const [mobile, setMobile] = useState<MobileState | null>(null)
  const [feishu, setFeishu] = useState<FeishuToggleView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.butler.state().then(s => { if (alive) setMobile(s) }).catch(() => {})
    const off = window.api.butler.onState(s => setMobile(s))
    const loadF = () => window.api.feishuAgent.get().then(v => { if (alive) setFeishu(v) }).catch(() => {})
    loadF()
    const offA = window.api.feishuAgent.onChange(loadF)
    const offF = window.api.feishu.onStatus(loadF)
    return () => { alive = false; off(); offA(); offF() }
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

  return (
    <div className="no-drag inline-flex items-center gap-1 flex-shrink-0">
      <Toggle icon="📱" label="Mobile Butler" title={m.title} checked={m.checked} disabled={m.disabled || busy} onClick={flipMobile} />
      <Toggle icon="💬" label="Feishu answer-for-me" title={f.title} checked={f.checked} disabled={f.disabled} onClick={flipFeishu} />
    </div>
  )
}
