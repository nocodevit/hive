import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CRUSH, FONT_MONO, redact, configureRedact } from './crush-styles'
import { TimelineRow, ThinkingSpinner } from './renderers'
import { flattenHistoricalEvents } from './flatten'
import { EMPTY_RECALL, pushAfterSend, recallDown, recallUp, type RecallState } from './recall'
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
  // Pending permission request — when present, a modal blocks Chat until
  // the user picks allow / deny. See the `control_request` handler below.
  // Set when we see message_start and cleared when the first user-
  // visible content_block_delta (text_delta) or message_stop arrives.
  // Drives the bottom-of-timeline "✳ Blanching… 3s" spinner.
  const [thinking, setThinking] = useState<{ since: number } | null>(null)
  const [pendingPermission, setPendingPermission] = useState<{
    requestId: string
    toolName: string
    displayName?: string
    input: Record<string, unknown>
    suggestions?: Array<{ type: string; rules: { toolName: string; ruleContent: string }[]; behavior: string; destination: string }>
  } | null>(null)
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

  // Bash-style recall for sent user messages. State transitions live in
  // ./recall.ts as pure helpers so they're unit-tested without a DOM.
  const sentHistoryRef = useRef<string[]>([])
  const recallStateRef = useRef<RecallState>(EMPTY_RECALL)
  const HISTORY_CAP = 100

  // Cap in-memory timeline so very long sessions don't accumulate
  // unbounded React state. Entries fall off the top; JSONL on disk
  // remains the source of truth for archeology (see ~/.hive/chat-logs/
  // and ~/.claude/projects/<cwd>/<sid>.jsonl).
  const MAX_LIVE_ENTRIES = 500
  const addEntry = (entry: Omit<TimelineEntry, 'id'> & { id?: string }) => {
    const id = entry.id || `e${entryIdRef.current++}`
    setTimeline(prev => {
      const next = [...prev, { ...entry, id } as TimelineEntry]
      if (next.length > MAX_LIVE_ENTRIES) {
        const drop = next.length - MAX_LIVE_ENTRIES
        setTrimmedCount(c => c + drop)
        return next.slice(drop)
      }
      return next
    })
  }
  const [trimmedCount, setTrimmedCount] = useState(0)
  // `hasOlderOnDisk` is set from the history_replayed event when the JSONL
  // has more lines than the replay limit. Drives the "Load older" button.
  const [hasOlderOnDisk, setHasOlderOnDisk] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Remote-control mode — when 'active', the --print subprocess is gone
  // and an interactive PTY is bridging the session to the mobile app.
  // User clicks the Resume button to re-enter 'idle' mode (spawns a
  // fresh --print --resume <sid> that picks up mobile-driven turns).
  const [rcState, setRcState] = useState<'idle' | 'active'>('idle')
  const [rcOutput, setRcOutput] = useState<string>('')

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
        if (idx < 0) {
          // Append + apply the same MAX_LIVE_ENTRIES cap as addEntry.
          const next = [...prev, entry]
          if (next.length > MAX_LIVE_ENTRIES) {
            const drop = next.length - MAX_LIVE_ENTRIES
            setTrimmedCount(c => c + drop)
            return next.slice(drop)
          }
          return next
        }
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
      if (ev.type === 'system' && (ev as any).subtype === 'history_replayed') {
        // JSONL replay capped at DEFAULT_REPLAY_LIMIT; the backend flags
        // whether there are still older lines we can load on demand.
        if ((ev as any).hasOlder) setHasOlderOnDisk(true)
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
          setThinking({ since: Date.now() })
          return
        }
        if (e?.type === 'message_stop') {
          setThinking(null)
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
            setThinking(null) // visible text started → hide spinner
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
        const e = ev as any
        addEntry({
          kind: 'result',
          costUSD: e.total_cost_usd,
          durationMs: e.duration_ms,
          numTurns: e.num_turns,
          inputTokens: e.usage?.input_tokens,
          outputTokens: e.usage?.output_tokens,
          cacheReadTokens: e.usage?.cache_read_input_tokens
        })
      }
      // control_request: claude is asking for permission to use a tool
      // (fires when --permission-prompt-tool stdio is set and the tool
      // isn't in settings.allow). Capture it and show a modal; claude
      // is blocked on stdin until we reply via respondPermission.
      if (ev.type === 'control_request') {
        const req = (ev as any).request
        const requestId = (ev as any).request_id
        if (requestId && req?.subtype === 'can_use_tool') {
          setPendingPermission({
            requestId,
            toolName: req.tool_name,
            displayName: req.display_name,
            input: req.input || {},
            suggestions: req.permission_suggestions
          })
        }
        return
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

    // Load-older: backend emits a batch of historical events to prepend.
    // We flatten them into TimelineEntry[] mirroring the live handler and
    // setTimeline atomically so scroll position doesn't jitter.
    const offPrepend = window.api.chat.onPrepend(id, ({ events, hasOlder }) => {
      const entries = flattenHistoricalEvents(events, () => `e${entryIdRef.current++}`)
      if (entries.length) setTimeline(prev => [...entries, ...prev])
      setHasOlderOnDisk(hasOlder)
      setLoadingOlder(false)
    })

    // Remote-control PTY output — accumulate last ~4KB so the pairing
    // panel can show whatever claude's TUI drew (URL, QR, confirmation).
    const offRcOutput = window.api.chat.onRcOutput(id, (data: string) => {
      setRcOutput(prev => {
        const next = prev + data
        return next.length > 4000 ? next.slice(next.length - 4000) : next
      })
    })
    const offRcExit = window.api.chat.onRcExit(id, () => {
      // PTY died unexpectedly (not via user clicking Resume here). Flip
      // back to idle; the --print child is already dead, user can send
      // /remote-control again or Resume to respawn.
      setRcState('idle')
    })

    return () => {
      offEv()
      offErr()
      offExit()
      offUsage()
      offPrepend()
      offRcOutput()
      offRcExit()
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
    // Intercept session-scoped slash commands that don't work in --print
    // mode. Today: just /remote-control. The handler takes over the UI;
    // no stream-json frame goes out.
    if (text === '/remote-control') {
      setInput('')
      const { history, state } = pushAfterSend(sentHistoryRef.current, text, HISTORY_CAP)
      sentHistoryRef.current = history
      recallStateRef.current = state
      addEntry({ kind: 'system', text: 'Starting remote control…' })
      setRcOutput('')
      const res = await window.api.chat.startRemoteControl(id)
      if (res.ok) {
        setRcState('active')
      } else {
        addEntry({ kind: 'system', text: `Remote control failed: ${res.error}` })
      }
      return
    }
    setSending(true)
    addEntry({ kind: 'user', text })
    setInput('')
    const { history, state } = pushAfterSend(sentHistoryRef.current, text, HISTORY_CAP)
    sentHistoryRef.current = history
    recallStateRef.current = state
    await window.api.chat.send(id, text)
    setSending(false)
  }

  const resumeFromRc = async () => {
    addEntry({ kind: 'system', text: 'Resuming session — picking up any mobile turns…' })
    const res = await window.api.chat.resumeFromRemoteControl(id)
    if (res.ok) {
      setRcState('idle')
      setRcOutput('')
    } else {
      addEntry({ kind: 'system', text: `Resume failed: ${res.error}` })
    }
  }

  const closeSession = async () => {
    addEntry({ kind: 'system', text: 'Session closed by user. Timeline kept; click Start new session below to continue with the same agent.' })
    await window.api.chat.stop(id)
    // main's stopChat fires chat:exit which flips `exited` state; no need
    // to set it manually. The input area picks up the new-session UI off
    // `exited !== null`.
  }

  const startNewSession = async () => {
    // Fresh session with the same agent — no -c, no --resume. System/init
    // will emit a new session_id; timeline is preserved and a divider is
    // added to make the boundary visible.
    addEntry({ kind: 'system', text: '── new session ──' })
    setExited(null)
    setSessionId('')
    setRateLimit(null)
    setUsage({})
    setThinking(null)
    setPendingPermission(null)
    setHasOlderOnDisk(false)
    setTrimmedCount(0)
    await window.api.chat.start(id, {
      cwd, agent, name: agentName,
      continueSession: false,
      rebaseOnStart: false
    })
  }

  const tryRecallUp = (ta: HTMLTextAreaElement): boolean => {
    const cursorAtTop = ta.selectionStart === 0 || !input.slice(0, ta.selectionStart).includes('\n')
    const r = recallUp(sentHistoryRef.current, recallStateRef.current, input, cursorAtTop)
    if (!r) return false
    recallStateRef.current = r.state
    setInput(r.input)
    return true
  }
  const tryRecallDown = (): boolean => {
    const r = recallDown(sentHistoryRef.current, recallStateRef.current)
    if (!r) return false
    recallStateRef.current = r.state
    setInput(r.input)
    return true
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

  // Intentionally NOT returning null when !visible: keep the component
  // (and its claude --print subprocess) alive across agent/tab switches.
  // Parent controls visibility via CSS. The `visible` prop is still
  // threaded in for any future "skip expensive paint when hidden"
  // optimizations, but mount/unmount must NOT be tied to visibility.

  return (
    <div style={{
      width: '100%', height: '100%',
      // Locked to deep-purple regardless of system/app theme. The Crush
      // palette is engineered for a dark base; on a light background the
      // accents (Charple/Dolly/Julep) and Butter/Ash text collapse into
      // invisibility. Don't follow var(--bg-primary).
      background: '#0f0a1a',
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
        {(hasOlderOnDisk || trimmedCount > 0) && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 8px' }}>
            <button
              onClick={async () => {
                if (loadingOlder) return
                setLoadingOlder(true)
                await window.api.chat.loadOlder(id).catch(() => {})
                // setLoadingOlder(false) happens on onPrepend receipt;
                // this fallback prevents a stuck spinner if no events flow.
                setTimeout(() => setLoadingOlder(false), 3000)
              }}
              disabled={loadingOlder}
              style={{
                background: 'transparent',
                border: `1px solid ${CRUSH.Charcoal}`,
                borderRadius: 4,
                padding: '4px 12px',
                color: CRUSH.Squid,
                fontFamily: FONT_MONO, fontSize: 11,
                cursor: loadingOlder ? 'wait' : 'pointer'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = CRUSH.Charple
                e.currentTarget.style.color = CRUSH.Butter
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = CRUSH.Charcoal
                e.currentTarget.style.color = CRUSH.Squid
              }}
            >
              {loadingOlder ? 'Loading…' : '⌃ Load earlier messages'}
            </button>
          </div>
        )}
        <TimelineList timeline={timeline} onChoose={handleChoose} />
        {thinking && <ThinkingSpinner since={thinking.since} />}
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

      {/* Input area — three variants:
          - rcState === 'active'    → RC pairing panel
          - exited !== null          → "session closed, start new" panel
          - else                     → normal textarea
          Precedence matches real priority (RC ends when user clicks
          Resume; a closed session can't be in RC at the same time). */}
      {exited !== null && rcState !== 'active' ? (
        <div style={{
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          background: CRUSH.BBQ,
          padding: 8
        }}>
          <div style={{
            border: `1px solid ${CRUSH.Charcoal}`,
            borderRadius: 8,
            padding: 10,
            background: 'rgba(235,66,104,0.04)'
          }}>
            <div style={{
              color: CRUSH.Sriracha, fontWeight: 700, fontSize: 12,
              textTransform: 'uppercase' as const, letterSpacing: '0.08em',
              marginBottom: 6
            }}>● session closed (exit {exited})</div>
            <div style={{
              color: CRUSH.Squid, fontSize: 11, marginBottom: 10
            }}>
              The claude subprocess is gone. History above is kept. Click
              below to start a fresh session with the same agent — this
              creates a new session-id and begins a clean context.
            </div>
            <button
              onClick={startNewSession}
              style={{
                background: CRUSH.Julep,
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                color: CRUSH.Pepper,
                fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700,
                cursor: 'pointer',
                width: '100%'
              }}
            >⊕ Start new session</button>
          </div>
        </div>
      ) : rcState === 'active' ? (
        <div style={{
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          background: CRUSH.BBQ,
          padding: 8
        }}>
          <div style={{
            border: `1px solid ${CRUSH.Dolly}`,
            borderRadius: 8,
            padding: 10,
            background: 'rgba(255,96,255,0.06)'
          }}>
            <div style={{
              color: CRUSH.Dolly, fontWeight: 700, fontSize: 12,
              textTransform: 'uppercase' as const, letterSpacing: '0.08em',
              marginBottom: 6
            }}>● Remote control active</div>
            <div style={{
              color: CRUSH.Squid, fontSize: 11, marginBottom: 8
            }}>
              This session is bridged to the Claude mobile app and claude.ai/code.
              Drive it from elsewhere, then click below to resume here.
            </div>
            {rcOutput && (
              <pre style={{
                background: CRUSH.Pepper,
                color: CRUSH.Ash,
                padding: '6px 10px',
                borderRadius: 4,
                fontFamily: FONT_MONO, fontSize: 11,
                margin: '6px 0 10px',
                maxHeight: 160, overflow: 'auto' as const,
                whiteSpace: 'pre-wrap'
              }}>{rcOutput.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')}</pre>
            )}
            <button
              onClick={resumeFromRc}
              style={{
                background: CRUSH.Dolly,
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                color: CRUSH.Butter,
                fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700,
                cursor: 'pointer',
                width: '100%'
              }}
            >↺ Resume session here</button>
          </div>
        </div>
      ) : (
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
                // Skip while IME is composing (pinyin/kana confirm).
                // e.nativeEvent.isComposing is the modern signal; composingRef
                // is the belt-and-suspenders backup.
                if (composingRef.current || (e.nativeEvent as any).isComposing) return
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return }
                if (e.key === 'ArrowUp' && tryRecallUp(e.currentTarget)) { e.preventDefault(); return }
                if (e.key === 'ArrowDown' && tryRecallDown()) { e.preventDefault(); return }
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
      )}

      {/* Model / usage line — stays under input */}
      <ModelUsageBar
        modelName={modelName} contextSize={contextSize} usage={usage} rateLimit={rateLimit}
        streamingMode={streamingMode} onToggleStreaming={toggleStreamingMode}
        onCloseSession={closeSession}
        sessionActive={exited === null && rcState === 'idle'}
      />

      {/* Permission modal */}
      {pendingPermission && (
        <PermissionModal
          req={pendingPermission}
          onDecide={async (decision, saveSuggestion) => {
            if (saveSuggestion) {
              await window.api.settings.addClaudeAllowRule(saveSuggestion.rules).catch(() => {})
            }
            // For allow we must echo the original tool input back as
            // updatedInput; for deny we include a human message. Schema
            // is strict (Zod-validated on claude's side).
            window.api.chat.respondPermission(
              id,
              pendingPermission.requestId,
              decision,
              decision === 'allow' ? pendingPermission.input : undefined,
              decision === 'deny' ? 'Denied by user' : undefined
            )
            setPendingPermission(null)
          }}
        />
      )}
    </div>
  )
}

interface PermissionSuggestion { type: string; rules: { toolName: string; ruleContent: string }[]; behavior: string; destination: string }
function PermissionModal({ req, onDecide }: {
  req: { requestId: string; toolName: string; displayName?: string; input: Record<string, unknown>; suggestions?: PermissionSuggestion[] }
  onDecide: (d: 'allow' | 'deny', saveSuggestion?: PermissionSuggestion) => void
}) {
  const summary = (() => {
    const i = req.input
    if (typeof i.command === 'string') return i.command
    if (typeof i.file_path === 'string') return i.file_path
    if (typeof i.path === 'string') return i.path
    if (typeof i.skill === 'string') return `${i.skill}${i.args ? ` ${i.args}` : ''}`
    if (typeof i.url === 'string') return i.url
    if (typeof i.pattern === 'string') return i.pattern
    try { return JSON.stringify(i) } catch { return '' }
  })()
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(15,10,26,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, fontFamily: FONT_MONO
    }}>
      <div style={{
        background: CRUSH.BBQ,
        border: `1px solid ${CRUSH.Charple}`,
        borderRadius: 10,
        padding: '18px 22px 16px',
        width: 460, maxWidth: '80%',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
      }}>
        <div style={{ color: CRUSH.Dolly, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Permission required
        </div>
        <div style={{ color: CRUSH.Ash, fontSize: 13, marginBottom: 6 }}>
          Claude wants to use <strong style={{ color: CRUSH.Charple }}>{req.displayName || req.toolName}</strong>
        </div>
        <div style={{
          color: CRUSH.Ash,
          background: CRUSH.Pepper,
          border: `1px solid ${CRUSH.Charcoal}`,
          borderRadius: 4,
          padding: '8px 12px',
          fontSize: 12,
          marginBottom: 16,
          fontFamily: FONT_MONO,
          wordBreak: 'break-all',
          maxHeight: 200, overflowY: 'auto',
          whiteSpace: 'pre-wrap'
        }}>{summary || '—'}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={() => onDecide('deny')} style={{
            background: 'transparent', color: CRUSH.Sriracha,
            border: `1px solid ${CRUSH.Sriracha}`, borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO, cursor: 'pointer'
          }}>Deny</button>
          <button onClick={() => onDecide('allow')} style={{
            background: 'transparent', color: CRUSH.Julep,
            border: `1px solid ${CRUSH.Julep}`, borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO, cursor: 'pointer'
          }}>Allow once</button>
          {req.suggestions && req.suggestions[0] && (
            <button onClick={() => onDecide('allow', req.suggestions![0])} style={{
              background: CRUSH.Julep, color: CRUSH.Pepper,
              border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO,
              fontWeight: 700, cursor: 'pointer'
            }} title={`Adds "${req.suggestions[0].rules.map(r => `${r.toolName}(${r.ruleContent})`).join(', ')}" to ~/.claude/settings.json`}>
              Allow & remember
            </button>
          )}
        </div>
      </div>
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

function ModelUsageBar({ modelName, contextSize, usage, rateLimit, streamingMode, onToggleStreaming, onCloseSession, sessionActive }: {
  modelName: string
  contextSize: string
  usage: {
    costUSD?: number; burnPerHour?: number; projectedUSD?: number; remainingMinutes?: number
    totalTokens?: number; fiveHour?: number; sevenDay?: number
  }
  rateLimit: any
  streamingMode: boolean
  onToggleStreaming: () => void
  onCloseSession: () => void
  sessionActive: boolean
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
      {sessionActive && (
        <button
          onClick={onCloseSession}
          title="End this claude session. Timeline is kept; click Start new session to spawn a fresh one with the same agent."
          style={{
            background: 'transparent',
            border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Squid,
            padding: '2px 8px',
            borderRadius: 4,
            fontFamily: FONT_MONO, fontSize: 10,
            cursor: 'pointer'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = CRUSH.Sriracha
            e.currentTarget.style.color = CRUSH.Sriracha
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = CRUSH.Charcoal
            e.currentTarget.style.color = CRUSH.Squid
          }}
        >⏹ close session</button>
      )}
    </div>
  )
}
