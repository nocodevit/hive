import { useEffect, useState } from 'react'
import { CHAT, CRUSH, FONT_PROSE, accentTint } from './crush-styles'

/** A remote message in the Butler chat (main/remote.ts):
 *  in  · "given"  — it went straight to Butler (shown from the chat's own user turn)
 *  in  · cardId   — it waits in Approve; Give to Butler / Dismiss work right here too
 *  out            — Butler sent it to their Hive (ok or why not). */
export type RemoteCardProps =
  | { dir: 'in'; peerName: string; login?: string; device?: string; text: string; cardId?: string }
  | { dir: 'out'; peerName: string; text: string; ok: boolean; error?: string }

const ERROR: Record<string, string> = {
  peer_offline: 'their Mac is offline', their_remote_off: 'their Hive is closed or Remote is off',
  not_allowed_by_them: 'they have not added you yet', remote_off: 'Remote is off here', failed: 'failed'
}

export function RemoteCard(props: RemoteCardProps) {
  const inbound = props.dir === 'in'
  const cardId = inbound ? props.cardId : undefined
  const [state, setState] = useState<'waiting' | 'handled' | 'busy'>('waiting')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!cardId) return
    let alive = true
    const check = (pending: Array<{ id: string }>) => { if (alive) setState(s => (s === 'busy' ? s : pending.some(p => p.id === cardId) ? 'waiting' : 'handled')) }
    window.api.approvals.list().then(check).catch(() => {})
    const off = window.api.approvals.onChange(check)
    return () => { alive = false; off() }
  }, [cardId])

  const give = async () => {
    if (!cardId) return
    setState('busy'); setError('')
    const r = await window.api.approvals.approve(cardId)
    if (r.ok) setState('handled')
    else { setState('waiting'); setError(r.error || 'failed') }
  }
  const dismiss = async () => { if (cardId && await window.api.approvals.reject(cardId)) setState('handled') }

  const status = !inbound
    ? (props.ok ? `Sent to ${props.peerName}'s Hive ✓` : `Not sent · ${ERROR[props.error ?? ''] ?? props.error ?? 'failed'}`)
    : cardId ? (state === 'handled' ? 'Handled' : 'Waiting for you · also in Approve') : 'Given to Butler'

  return (
    <div role="article" aria-label={inbound ? `Remote message from ${props.peerName}` : `Remote message to ${props.peerName}`}
      style={{
        margin: inbound ? '6px auto 6px 20px' : '6px 20px 6px auto', width: 'fit-content', padding: '10px 14px', borderRadius: 14,
        background: inbound ? accentTint(8) : CHAT.surface, color: CHAT.ink2,
        fontFamily: FONT_PROSE, fontSize: 13, lineHeight: 1.5,
        maxWidth: '86%', minWidth: 260
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span aria-hidden>🌐</span>
        <strong style={{ color: CHAT.ink, fontWeight: 600 }}>{inbound ? `${props.peerName}'s Hive` : `To ${props.peerName}'s Hive`}</strong>
        {inbound && (props.login || props.device) && (
          <span style={{ color: CHAT.muted, fontSize: 11.5 }}>{[props.login, props.device].filter(Boolean).join(' · ')}</span>
        )}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: CHAT.ink }}>{props.text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: !inbound && !props.ok ? CRUSH.Sriracha : CHAT.muted }}>{status}</span>
        <span style={{ flex: 1 }} />
        {cardId && state !== 'handled' && (
          <>
            <button type="button" onClick={give} disabled={state === 'busy'} style={{
              border: 'none', borderRadius: 10, padding: '4px 12px', background: CRUSH.Charple, color: '#FFFFFF',
              fontFamily: FONT_PROSE, fontSize: 12, fontWeight: 600, cursor: state === 'busy' ? 'default' : 'pointer', opacity: state === 'busy' ? 0.6 : 1
            }}>{state === 'busy' ? 'Giving…' : 'Give to Butler'}</button>
            <button type="button" onClick={dismiss} disabled={state === 'busy'} style={{
              borderRadius: 10, padding: '4px 12px', background: 'transparent', color: CHAT.ink2, border: `1px solid ${CRUSH.Charcoal}`,
              fontFamily: FONT_PROSE, fontSize: 12, fontWeight: 600, cursor: 'pointer'
            }}>Dismiss</button>
          </>
        )}
      </div>
      {error && <div role="alert" style={{ marginTop: 4, fontSize: 11.5, color: CRUSH.Sriracha }}>{error}</div>}
    </div>
  )
}
