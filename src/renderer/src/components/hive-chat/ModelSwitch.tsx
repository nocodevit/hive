import { useEffect, useState } from 'react'
import { CHAT, CRUSH, FONT_PROSE, accentTint } from './crush-styles'

/** The models ⋮ → Switch model offers; null = the agent's own default. */
export const MODELS: Array<{ id: string; name: string; hint: string }> = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', hint: 'Strongest · complex changes' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', hint: 'Fast · everyday work' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', hint: 'Quickest · simple tasks' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', hint: 'Fable' }
]
export const modelLabel = (id: string | null | undefined) => MODELS.find(m => id && id.startsWith(m.id))?.name ?? (id || 'Agent default')

/**
 * ⋮ → Switch model: pick one, confirm. A running chat switches in place (the
 * conversation and its context carry on); otherwise the pick applies when the
 * chat next starts. Enter confirms, Esc cancels.
 */
export function ModelSwitchModal({ current, saved, live, onCancel, onConfirm }: {
  current: string; saved: string | null; live: boolean
  onCancel: () => void; onConfirm: (model: string | null) => void
}) {
  const [pick, setPick] = useState<string | null>(saved ?? MODELS.find(m => current.startsWith(m.id))?.id ?? null)
  const same = (pick ?? null) === (saved ?? null) && (!pick || current.startsWith(pick))
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter' && !same) onConfirm(pick) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [pick, same])
  const opt = (id: string | null, name: string, hint: string) => {
    const on = pick === id
    return (
      <button key={id ?? 'default'} role="radio" aria-checked={on} onClick={() => setPick(id)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
          background: on ? accentTint(14) : 'transparent', color: CHAT.ink, fontFamily: FONT_PROSE, fontSize: 13.5 }}>
        <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, boxShadow: `inset 0 0 0 ${on ? 4 : 1.5}px ${on ? CHAT.accent : CHAT.muted}` }} />
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ color: CHAT.muted, fontSize: 12 }}>{hint}</span>
        {(id ? current.startsWith(id) : !saved) && <span style={{ marginLeft: 'auto', fontSize: 11, color: CHAT.muted }}>now</span>}
      </button>
    )
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Switch model" onClick={onCancel} className="hive-pop-in"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(10,6,20,.45)' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: CHAT.bg, borderRadius: 16, padding: 18, boxShadow: '0 20px 50px rgba(0,0,0,.35)' }}>
        <div style={{ fontFamily: FONT_PROSE, fontSize: 15, fontWeight: 700, color: CHAT.ink }}>Switch model</div>
        <div style={{ fontFamily: FONT_PROSE, fontSize: 12.5, color: CHAT.muted, margin: '4px 0 12px' }}>
          {live ? 'Switches now, in this conversation — everything said so far stays.' : 'The chat isn’t running: the model is used when it starts.'}
        </div>
        <div role="radiogroup" aria-label="Model" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {MODELS.map(m => opt(m.id, m.name, m.hint))}
          {opt(null, 'Agent default', 'what the agent’s settings say')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: CHAT.surface2, color: CHAT.ink, fontFamily: FONT_PROSE, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button disabled={same} onClick={() => onConfirm(pick)}
            style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: same ? CHAT.surface2 : CRUSH.Charple, color: same ? CHAT.muted : '#fff', fontFamily: FONT_PROSE, fontSize: 13, fontWeight: 600, cursor: same ? 'default' : 'pointer' }}>
            {pick ? `Switch to ${modelLabel(pick)}` : 'Use agent default'}
          </button>
        </div>
      </div>
    </div>
  )
}
