import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CRUSH, FONT_MONO, redact, configureRedact } from './crush-styles'
import { TimelineRow } from './renderers'
import { shortenPath } from '../../lib/path-display'
import type { ContentBlock, StreamEvent, TimelineEntry } from './types'

/** Isolated subtree so the timeline doesn't re-render on every keystroke
 *  in the input box — only when the timeline array itself or `onChoose`
 *  reference change. */
const TimelineList = React.memo(function TimelineList({ timeline, onChoose }: {
  timeline: TimelineEntry[]
  onChoose: (pick: string) => void
}) {
  const resultsByToolUseId = useMemo(() => {
    const m = new Map<string, { content: string; isError?: boolean }>()
    for (const e of timeline) {
      if (e.kind === 'tool_result') m.set(e.toolUseId, { content: e.content, isError: e.isError })
    }
    return m
  }, [timeline])
  return (
    <>
      {timeline.map(entry => {
        const result = entry.kind === 'tool_call' ? resultsByToolUseId.get(entry.toolUseId) : undefined
        return <TimelineRow key={entry.id} entry={entry} result={result} onChoose={onChoose} />
      })}
    </>
  )
})

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
    fiveHour?: number   // % of subscription limit — scraped from /usage TUI
    sevenDay?: number
  }>({})
  const [sessionId, setSessionId] = useState<string>('')
  const [streamingMode, setStreamingMode] = useState<boolean>(true)
  const [username, setUsername] = useState<string>('')
  // Fetch OS username + persisted streamingMode once; configure the
  // screen-only redactor accordingly. Default is ON so new installs
  // don't leak the username in screenshots.
  useEffect(() => {
    (async () => {
      const u = await window.api.system.username().catch(() => '')
      const raw = await window.api.settings.get('streamingMode').catch(() => undefined)
      const on = raw === undefined ? true : !!raw
      setUsername(u)
      setStreamingMode(on)
      configureRedact({ enabled: on, tokens: u ? [u] : [] })
    })()
  }, [])

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
  // True while IME is composing (e.g. pinyin selection). Enter during
  // composition confirms the candidate, not sends the message.
  const composingRef = useRef(false)

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

        // Live assistant events are CUMULATIVE SNAPSHOTS whose content
        // array drops thinking blocks, so the JS `forEach idx` no longer
        // matches the `content_block_delta.index` that stream_event used
        // to key the same entries. Trusting assistant events here creates
        // duplicates (same text appears twice on screen). stream_event
        // already produces the live entries incrementally, so we skip the
        // cumulative snapshot entirely — UNLESS the event is coming from
        // replaySessionHistory (jsonl replay has no stream_event
        // counterpart, so that path still needs to process assistant).
        const isHistorical = (ev as any)._historical === true
        if (!isHistorical) return

        content.forEach((block: any, idx: number) => {
          if (block.type === 'thinking' || block.type === 'redacted_thinking') return
          // For historical replay we key by tool id when available, else msg+idx.
          const entryId = block.type === 'tool_use' && block.id
            ? `tool:${block.id}`
            : `msg:${msgId}:${idx}`
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
      // Append as a one-time system timeline entry — scrolls away with
      // conversation rather than lurking above the input forever.
      const text = line.replace(/\s+$/, '')
      if (text) addEntry({ kind: 'system', text })
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

  const handleChoose = useCallback((pick: string) => {
    addEntry({ kind: 'user', text: pick })
    window.api.chat.send(id, pick)
  }, [id])

  const toggleStreamingMode = () => {
    const next = !streamingMode
    setStreamingMode(next)
    configureRedact({ enabled: next, tokens: username ? [username] : [] })
    window.api.settings.set('streamingMode', next)
    // Force re-render of every timeline row: rebuild each entry's
    // reference so React.memo's prev.entry !== next.entry triggers.
    setTimeline(prev => prev.map(e => ({ ...e } as TimelineEntry)))
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
        overflowY: 'auto',
        overflowX: 'hidden',       // wide content scrolls inside its own block, not the whole timeline
        padding: '12px 16px',
        scrollBehavior: 'smooth',
        minWidth: 0
      }}>
        {timeline.length === 0 && (
          <div style={{ color: CRUSH.Squid, fontSize: 12, padding: 4 }}>
            {continueSession
              ? `Resuming most recent session in ${redact(shortenPath(cwd))}…`
              : 'New chat. Type below to begin.'}
            {sessionId && (
              <span style={{ color: CRUSH.Oyster, marginLeft: 8 }}>
                · session {sessionId.slice(0, 8)}
              </span>
            )}
          </div>
        )}
        <TimelineList timeline={timeline} onChoose={handleChoose} />
        {exited !== null && (
          <div style={{ color: CRUSH.Sriracha, fontSize: 11, marginTop: 12, padding: 4 }}>
            claude exited (code {exited})
          </div>
        )}
        {/* stderr lines now flow into the timeline as system entries — no pinned box. */}
      </div>

      {/* Rate-limit status line — sits just above input, updates live.
         When no rate_limit_event has arrived yet, shows a subdued
         "waiting for first message…" so the user knows Chat is live
         but nothing's happened yet. */}
      {rateLimit ? (
        <RateLimitBar info={rateLimit} />
      ) : !modelName ? (
        <div style={{
          padding: '4px 12px',
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          background: CRUSH.BBQ,
          fontFamily: FONT_MONO, fontSize: 11,
          color: CRUSH.Oyster
        }}>waiting for first message…</div>
      ) : null}

      {/* Input box */}
      <div style={{
        borderTop: `1px solid ${CRUSH.Charcoal}`,
        background: CRUSH.BBQ,
        padding: 8
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,96,255,0.08)',
          border: `1px solid ${CRUSH.Dolly}`,
          borderRadius: 8,
          padding: '8px 12px'
        }}>
          <span style={{ color: CRUSH.Dolly, fontWeight: 700, fontSize: 16 }}>❯</span>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onKeyDown={e => {
              // Skip Enter while IME is composing (pinyin/kana confirm).
              // e.nativeEvent.isComposing is the modern signal; composingRef
              // is the belt-and-suspenders backup.
              if (composingRef.current || (e.nativeEvent as any).isComposing) return
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
      <ModelUsageBar
        modelName={modelName} contextSize={contextSize} usage={usage} rateLimit={rateLimit}
        streamingMode={streamingMode} onToggleStreaming={toggleStreamingMode}
      />
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

function PctBar({ pct }: { pct?: number }) {
  return (
    <span style={{
      position: 'relative', display: 'inline-block',
      width: 36, height: 7,
      background: CRUSH.Charcoal, borderRadius: 2, overflow: 'hidden'
    }}>
      {typeof pct === 'number' && (
        <span style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: CRUSH.Dolly,
          transition: 'width 0.3s ease'
        }} />
      )}
    </span>
  )
}

function ModelUsageBar({ modelName, contextSize, usage, rateLimit, streamingMode, onToggleStreaming }: {
  modelName: string
  contextSize: string
  usage: {
    costUSD?: number; burnPerHour?: number; projectedUSD?: number; remainingMinutes?: number
    totalTokens?: number; fiveHour?: number; sevenDay?: number
  }
  rateLimit: any
  streamingMode: boolean
  onToggleStreaming: () => void
}) {
  const mins = usage.remainingMinutes
  const eta = mins != null ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`) : ''
  return (
    <div style={{
      padding: '6px 12px',
      borderTop: `1px solid ${CRUSH.Charcoal}`,
      background: CRUSH.BBQ,
      fontFamily: FONT_MONO, fontSize: 11,
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      color: CRUSH.Squid
    }}>
      {modelName && (
        <>
          <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>{modelName}</span>
          {contextSize && <span style={{ color: CRUSH.Squid }}>({contextSize})</span>}
          <span style={{ color: CRUSH.Oyster }}>|</span>
        </>
      )}
      {/* Subscription tier %% (scraped from /usage TUI) */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: CRUSH.Squid }}>5h</span>
        <PctBar pct={usage.fiveHour} />
        <span style={{ color: CRUSH.Butter, minWidth: 28 }}>
          {usage.fiveHour != null ? `${usage.fiveHour}%` : '—'}
        </span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: CRUSH.Squid }}>7d</span>
        <PctBar pct={usage.sevenDay} />
        <span style={{ color: CRUSH.Butter, minWidth: 28 }}>
          {usage.sevenDay != null ? `${usage.sevenDay}%` : '—'}
        </span>
      </span>
      {eta && (
        <>
          <span style={{ color: CRUSH.Oyster }}>·</span>
          <span>{eta} left</span>
        </>
      )}
      <span style={{ marginLeft: 'auto' }} />
      <button
        onClick={onToggleStreaming}
        title={streamingMode
          ? 'Streaming mode ON — username + secrets masked in display'
          : 'Streaming mode OFF — real values shown'}
        style={{
          background: streamingMode ? 'rgba(255,96,255,0.14)' : 'transparent',
          border: `1px solid ${streamingMode ? CRUSH.Dolly : CRUSH.Charcoal}`,
          color: streamingMode ? CRUSH.Dolly : CRUSH.Squid,
          padding: '2px 8px',
          borderRadius: 4,
          fontFamily: FONT_MONO, fontSize: 10,
          cursor: 'pointer'
        }}
      >
        {streamingMode ? '● streaming mode' : '○ streaming mode'}
      </button>
    </div>
  )
}
