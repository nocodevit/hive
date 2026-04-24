import { useEffect, useRef, useState } from 'react'
import { CRUSH, FONT_MONO } from './crush-styles'
import { TimelineRow } from './renderers'
import type { ContentBlock, StreamEvent, TimelineEntry } from './types'

interface Props {
  id: string
  cwd?: string
  agent?: string
  agentName?: string
  continueSession?: boolean
  rebaseOnStart?: boolean
  visible: boolean
}

/**
 * HiveChat — Crush-flavored structured chat UI driven by
 * `claude --print --output-format stream-json`. The main process spawns
 * one claude subprocess per chat session and streams JSON events to us.
 * We flatten those into a TimelineEntry list and render each entry with
 * a Crush-styled component.
 */
export default function HiveChat({ id, cwd, agent, agentName, continueSession, rebaseOnStart, visible }: Props) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [exited, setExited] = useState<number | null>(null)
  const [stderr, setStderr] = useState<string[]>([])
  // Status-bar state (above + below input)
  const [modelName, setModelName] = useState<string>('')     // "claude-opus-4-7"
  const [contextSize, setContextSize] = useState<string>('') // "1M"
  const [rateLimit, setRateLimit] = useState<{ status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null>(null)
  const [usage, setUsage] = useState<{
    costUSD?: number
    burnPerHour?: number
    projectedUSD?: number
    remainingMinutes?: number
    totalTokens?: number
  }>({})
  const [sessionId, setSessionId] = useState<string>('')
  // Per-(msgId × blockIdx) accumulator for live stream_event text_delta /
  // input_json_delta chunks. Lets the UI render assistant text char-by-
  // char as Claude types rather than snap the whole block at once.
  const streamAccRef = useRef<{
    currentMsgId: string
    blocks: Record<string, {
      kind: 'text' | 'tool_use' | 'thinking'
      text?: string
      toolUseId?: string
      toolName?: string
      inputJson?: string
    }>
  }>({ currentMsgId: '', blocks: {} })
  const scrollRef = useRef<HTMLDivElement>(null)
  const entryIdRef = useRef(0)

  const addEntry = (entry: Omit<TimelineEntry, 'id'> & { id?: string }) => {
    const id = entry.id || `e${entryIdRef.current++}`
    setTimeline(prev => [...prev, { ...entry, id } as TimelineEntry])
  }

  useEffect(() => {
    window.api.chat.start(id, { cwd, agent, name: agentName, continueSession, rebaseOnStart })

    /**
     * Timeline integration rules (validated against /tmp/claude-json.log):
     *
     * - `assistant` events deliver a CUMULATIVE snapshot of
     *   message.content as Claude streams. Same message.id may appear 3+
     *   times. We key entries by `msg:<id>:<blockIdx>` so later snapshots
     *   replace earlier ones in place instead of piling up duplicates.
     * - `thinking` blocks (type=thinking) are Claude's internal reasoning
     *   with encrypted signatures. We drop them.
     * - `user` events carry `tool_result` blocks coming back; keyed by
     *   `result:<tool_use_id>`.
     * - `system.init` / `system.status` / `stream_event` / `rate_limit_event`
     *   are housekeeping and suppressed. Only `system` subtypes other than
     *   init/status surface, plus the final `result` with cost.
     */
    const replaceEntry = (id: string, entry: TimelineEntry) => {
      setTimeline(prev => {
        const idx = prev.findIndex(e => e.id === id)
        if (idx < 0) return [...prev, entry]
        const copy = prev.slice()
        copy[idx] = entry
        return copy
      })
    }

    const offEv = window.api.chat.onEvent(id, (ev: StreamEvent) => {
      // Status-bar updates — these bypass the scrolling timeline.
      if (ev.type === 'system' && (ev as any).subtype === 'init') {
        const rawModel = (ev as any).model as string | undefined
        if (rawModel) {
          const m = rawModel.match(/^(.+?)(?:\[(\d+[kKmM])\])?$/)
          if (m) {
            setModelName(m[1])
            setContextSize((m[2] || '').toUpperCase())
          } else {
            setModelName(rawModel)
          }
        }
        const sid = (ev as any).session_id as string | undefined
        if (sid) setSessionId(sid)
        return
      }
      if (ev.type === 'rate_limit_event') {
        const info = (ev as any).rate_limit_info
        if (info) setRateLimit(info)
        return
      }
      if (ev.type === 'stream_event') {
        const e = (ev as any).event
        const acc = streamAccRef.current

        if (e?.type === 'message_start') {
          const m = e.message?.model as string | undefined
          if (m && !modelName) setModelName(m)
          acc.currentMsgId = e.message?.id ?? ''
          return
        }

        if (e?.type === 'content_block_start') {
          const idx = e.index
          const block = e.content_block
          if (!acc.currentMsgId) return
          acc.blocks[`${acc.currentMsgId}:${idx}`] = {
            kind: block.type,
            text: '',
            toolUseId: block.id,
            toolName: block.name,
            inputJson: ''
          }
          return
        }

        if (e?.type === 'content_block_delta') {
          const idx = e.index
          const key = `${acc.currentMsgId}:${idx}`
          const block = acc.blocks[key]
          if (!block) return

          if (e.delta.type === 'text_delta' && block.kind === 'text') {
            block.text = (block.text || '') + e.delta.text
            const entryId = `msg:${acc.currentMsgId}:${idx}`
            replaceEntry(entryId, { kind: 'assistant', text: block.text, id: entryId })
          } else if (e.delta.type === 'input_json_delta' && block.kind === 'tool_use') {
            block.inputJson = (block.inputJson || '') + e.delta.partial_json
            // Try parsing on every delta — once it's valid JSON the tool
            // call's arguments surface live in the timeline.
            try {
              const input = JSON.parse(block.inputJson)
              const entryId = `msg:${acc.currentMsgId}:${idx}`
              replaceEntry(entryId, {
                kind: 'tool_call',
                name: block.toolName || '',
                toolUseId: block.toolUseId || '',
                input,
                id: entryId
              })
            } catch { /* still partial */ }
          }
          return
        }

        return
      }
      if (ev.type === 'assistant' && 'message' in ev) {
        const msg = (ev as any).message
        const content = msg?.content as ContentBlock[] | undefined
        const msgId = msg?.id
        if (!Array.isArray(content) || !msgId) return
        content.forEach((block: any, idx: number) => {
          if (block.type === 'thinking' || block.type === 'redacted_thinking') return
          const entryId = `msg:${msgId}:${idx}`
          if (block.type === 'text') {
            replaceEntry(entryId, { kind: 'assistant', text: block.text, id: entryId })
          } else if (block.type === 'tool_use') {
            replaceEntry(entryId, { kind: 'tool_call', name: block.name, input: block.input, id: entryId, toolUseId: block.id })
          }
        })
      } else if (ev.type === 'user' && 'message' in ev) {
        const content = (ev as any).message?.content
        if (typeof content === 'string') {
          addEntry({ kind: 'user', text: content })
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') addEntry({ kind: 'user', text: block.text })
            else if (block.type === 'tool_result') {
              const text = Array.isArray(block.content)
                ? block.content.map((c: any) => c.text ?? '').join('\n')
                : String(block.content)
              const entryId = `result:${block.tool_use_id}`
              replaceEntry(entryId, {
                kind: 'tool_result',
                toolUseId: block.tool_use_id,
                content: text,
                isError: block.is_error,
                id: entryId
              })
            }
          }
        }
      } else if (ev.type === 'result') {
        const cost = (ev as any).total_cost_usd
        const dur = (ev as any).duration_ms
        const parts = ['result']
        if (cost != null) parts.push(`$${cost.toFixed(4)}`)
        if (dur != null) parts.push(`${(dur / 1000).toFixed(1)}s`)
        addEntry({ kind: 'system', text: parts.join(' · ') })
      }
      // stream_event / system.init / system.status / rate_limit_event are
      // intentionally suppressed — they're protocol housekeeping, not content.
    })
    const offErr = window.api.chat.onStderr(id, (line: string) => {
      setStderr(prev => [...prev.slice(-20), line])
    })
    const offExit = window.api.chat.onExit(id, (code: number) => { setExited(code) })
    const offUsage = window.api.chat.onUsage(id, (u) => { setUsage(u as any) })

    return () => {
      offEv()
      offErr()
      offExit()
      offUsage()
      window.api.chat.stop(id)
    }
  }, [id, cwd, agent, agentName, continueSession, rebaseOnStart])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [timeline.length])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    addEntry({ kind: 'user', text })
    setInput('')
    await window.api.chat.send(id, text)
    setSending(false)
  }

  if (!visible) return null

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'var(--bg-primary)',  // Hive's native deep-purple bg — matches the rest of the app
      color: CRUSH.Ash,
      fontFamily: FONT_MONO, fontSize: 13,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Timeline — grows naturally with content. When empty, height is
         close to zero and the input box sits right below the (small)
         welcome text near the top. As messages arrive the timeline
         expands, pushing the input downward. Once the timeline's natural
         height exceeds the viewport, it shrinks + scrolls internally and
         the input pins to the viewport bottom. */}
      <div ref={scrollRef} style={{
        flex: '0 1 auto',          // no grow, can shrink
        minHeight: 0,              // enables shrinking inside flex parent
        overflow: 'auto',
        padding: '12px 16px',
        scrollBehavior: 'smooth'
      }}>
        {timeline.length === 0 && (
          <div style={{ color: CRUSH.Squid, fontSize: 12, padding: 4 }}>
            {continueSession
              ? `Resuming most recent session in ${cwd || 'cwd'}…`
              : 'New chat. Type below to begin.'}
            {sessionId && (
              <span style={{ color: CRUSH.Oyster, marginLeft: 8 }}>
                · session {sessionId.slice(0, 8)}
              </span>
            )}
          </div>
        )}
        {(() => {
          const resultsByToolUseId = new Map<string, { content: string; isError?: boolean }>()
          for (const e of timeline) {
            if (e.kind === 'tool_result') resultsByToolUseId.set(e.toolUseId, { content: e.content, isError: e.isError })
          }
          const handleChoose = (pick: string) => {
            // Clicking a numbered choice sends the full line as the next user message.
            addEntry({ kind: 'user', text: pick })
            window.api.chat.send(id, pick)
          }
          return timeline.map(entry => (
            <TimelineRow key={entry.id} entry={entry} resultsByToolUseId={resultsByToolUseId} onChoose={handleChoose} />
          ))
        })()}
        {exited !== null && (
          <div style={{ color: CRUSH.Sriracha, fontSize: 11, marginTop: 12, padding: 4 }}>
            claude exited (code {exited})
          </div>
        )}
        {stderr.length > 0 && (
          <details style={{ fontSize: 11, color: CRUSH.Oyster, marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>stderr ({stderr.length})</summary>
            <pre style={{ whiteSpace: 'pre-wrap', color: CRUSH.Squid }}>{stderr.join('')}</pre>
          </details>
        )}
      </div>

      {/* Rate-limit status line — sits just above input, updates live */}
      <RateLimitBar info={rateLimit} />

      {/* Input box */}
      <div style={{
        borderTop: `1px solid ${CRUSH.Charcoal}`,
        background: CRUSH.BBQ,
        padding: 8
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(107,80,255,0.08)',
          border: `1px solid ${CRUSH.Charple}`,
          borderRadius: 8,
          padding: '8px 12px'
        }}>
          <span style={{ color: CRUSH.Charple, fontWeight: 700, fontSize: 16 }}>❯</span>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            disabled={sending || exited !== null}
            placeholder="Message Claude… (Enter to send, Shift+Enter for newline)"
            style={{
              flex: 1, resize: 'none',
              background: 'transparent', color: CRUSH.Butter,
              border: 'none', outline: 'none',
              fontFamily: FONT_MONO, fontSize: 13,
              minHeight: 20, maxHeight: 200,
              padding: 0
            }}
            rows={1}
          />
        </div>
      </div>

      {/* Model / usage line — stays under input */}
      <ModelUsageBar modelName={modelName} contextSize={contextSize} usage={usage} rateLimit={rateLimit} />
    </div>
  )
}

function humanEta(resetsAt: number | undefined): string {
  if (!resetsAt) return ''
  const ms = resetsAt * 1000 - Date.now()
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(mins / 60)
  const m = mins % 60
  if (hours > 0) return `${hours}h ${m}m`
  return `${m}m`
}

function RateLimitBar({ info }: { info: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null }) {
  if (!info) return null
  const type = info.rateLimitType === 'five_hour' ? '5h' : info.rateLimitType === 'seven_day' ? '7d' : info.rateLimitType || '?'
  const color = info.status === 'allowed' ? CRUSH.Julep : info.status === 'blocked' ? CRUSH.Sriracha : CRUSH.Zest
  return (
    <div style={{
      padding: '4px 12px',
      borderTop: `1px solid ${CRUSH.Charcoal}`,
      background: CRUSH.BBQ,
      fontFamily: FONT_MONO, fontSize: 11,
      display: 'flex', gap: 10, alignItems: 'center',
      color: CRUSH.Squid
    }}>
      <span style={{ color, fontWeight: 700 }}>● {type}</span>
      <span style={{ color: CRUSH.Ash }}>{info.status}</span>
      {info.resetsAt && <span>resets in {humanEta(info.resetsAt)}</span>}
      {info.isUsingOverage && <span style={{ color: CRUSH.Zest }}>⚠ overage</span>}
    </div>
  )
}

/** USD or — */
function fmtUsd(v?: number): string {
  if (typeof v !== 'number') return '—'
  if (v >= 100) return `$${v.toFixed(0)}`
  if (v >= 10) return `$${v.toFixed(1)}`
  return `$${v.toFixed(2)}`
}

/** Progress bar driven by projected vs actual cost within the current 5h
 * block. Shows how much of the projected total has been spent so far. */
function BurnBar({ cost, projected }: { cost?: number; projected?: number }) {
  const pct = (cost != null && projected && projected > 0)
    ? Math.max(0, Math.min(100, (cost / projected) * 100))
    : undefined
  return (
    <span style={{
      position: 'relative', display: 'inline-block',
      width: 80, height: 8,
      background: CRUSH.Charcoal, borderRadius: 2, overflow: 'hidden'
    }}>
      {pct != null && (
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`, background: CRUSH.Dolly,
          transition: 'width 0.3s ease'
        }} />
      )}
    </span>
  )
}

function ModelUsageBar({ modelName, contextSize, usage, rateLimit }: {
  modelName: string
  contextSize: string
  usage: { costUSD?: number; burnPerHour?: number; projectedUSD?: number; remainingMinutes?: number; totalTokens?: number }
  rateLimit: any
}) {
  if (!modelName) return null
  const mins = usage.remainingMinutes
  const eta = mins != null ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`) : ''
  return (
    <div style={{
      padding: '6px 12px',
      borderTop: `1px solid ${CRUSH.Charcoal}`,
      background: CRUSH.BBQ,
      fontFamily: FONT_MONO, fontSize: 11,
      display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
      color: CRUSH.Squid
    }}>
      <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>{modelName}</span>
      {contextSize && <span style={{ color: CRUSH.Squid }}>({contextSize})</span>}
      <span style={{ color: CRUSH.Oyster }}>|</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: CRUSH.Squid }}>5h</span>
        <BurnBar cost={usage.costUSD} projected={usage.projectedUSD} />
        <span style={{ color: CRUSH.Butter, minWidth: 34 }}>{fmtUsd(usage.costUSD)}</span>
      </span>
      {usage.burnPerHour != null && (
        <>
          <span style={{ color: CRUSH.Oyster }}>·</span>
          <span>burn {fmtUsd(usage.burnPerHour)}/hr</span>
        </>
      )}
      {usage.projectedUSD != null && (
        <>
          <span style={{ color: CRUSH.Oyster }}>·</span>
          <span>proj {fmtUsd(usage.projectedUSD)}{eta ? ` · ${eta} left` : ''}</span>
        </>
      )}
    </div>
  )
}
