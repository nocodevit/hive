import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CRUSH, FONT_MONO, redact, configureRedact } from './crush-styles'
import { TimelineRow, ThinkingSpinner } from './renderers'
import { flattenHistoricalEvents } from './flatten'
import { shortenPath } from '../../lib/path-display'
import type { ContentBlock, StreamEvent, TimelineEntry } from './types'

/** Isolated subtree so the timeline doesn't re-render on every keystroke
 *  in the input box — only when the timeline array itself or `onChoose`
 *  reference change. */
const TimelineList = React.memo(function TimelineList({ timeline, onChoose, onRecall, onRespond }: {
  timeline: TimelineEntry[]
  onChoose: (pick: string) => void
  onRecall: (text: string) => void
  onRespond: (item: string) => void
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
        return <TimelineRow key={entry.id} entry={entry} result={result} onChoose={onChoose} onRecall={onRecall} onRespond={onRespond} />
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
  // Auto-continue state — main process schedules a setTimeout when it
  // sees a `rate_limit_event.status==='rejected'` to inject a "please
  // continue" turn 60s after `resetsAt`. UI shows a countdown + cancel.
  const [autoContinueAt, setAutoContinueAt] = useState<number | null>(null)
  const [usage, setUsage] = useState<{
    costUSD?: number
    burnPerHour?: number
    projectedUSD?: number
    remainingMinutes?: number
    totalTokens?: number
    fiveHour?: number   // % of subscription limit — scraped from /usage TUI
    sevenDay?: number
    fiveHourReset?: string   // raw "Resets in 4h 12m" / "on Apr 30" string from /usage
    sevenDayReset?: string
  }>({})
  const [sessionId, setSessionId] = useState<string>('')
  // Latest result.usage.input_tokens — the full context size right
  // now (system + history + last user msg). Drives the context %% bar.
  const [latestInputTokens, setLatestInputTokens] = useState<number>(0)
  // Active subagent (Task tool) tracking. Keyed by parent tool_use_id.
  // Updated on Task tool_use (register) → task_progress events
  // (description / metrics) → tool_result (deregister). Drives the
  // sticky 'subagent active' banner above the rate-limit bar.
  interface SubagentState {
    startedAt: number
    lastEventAt: number
    eventCount: number
    description?: string
    lastToolName?: string
    totalTokens?: number
    toolUses?: number
    durationMs?: number
  }
  const [activeSubagents, setActiveSubagents] = useState<Record<string, SubagentState>>({})
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

  // Recall is now a per-bubble click action (UserMessage's ↺ icon)
  // instead of ↑/↓ keys. Kept the recall.ts pure helpers in tree for
  // potential keyboard re-enable down the road, but not wired here.
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Cap in-memory timeline so very long sessions don't accumulate
  // unbounded React state. Default cap = 500 entries.
  //
  // "Load earlier" semantics: temporarily raises the cap by the loaded
  // batch so prepended history doesn't get sliced immediately. The cap
  // snaps back to 500 after PREPEND_BUFFER_TURNS (=10) genuine new
  // live entries arrive — at which point the loaded-older entries fall
  // off in one trim. Subagent noise (parent_tool_use_id != null) and
  // streaming-update replaceEntry calls don't count toward the buffer:
  // only true new top-level conversational additions tick it down.
  const liveLimitRef = useRef(500)
  const prependBufferRef = useRef(0)
  const PREPEND_BUFFER_TURNS = 10
  const tickPrependBuffer = (entry: { isSubagent?: boolean }) => {
    if (entry.isSubagent) return
    if (prependBufferRef.current <= 0) return
    prependBufferRef.current -= 1
    if (prependBufferRef.current === 0) {
      liveLimitRef.current = 500
    }
  }
  const addEntry = (entry: Omit<TimelineEntry, 'id'> & { id?: string }) => {
    const id = entry.id || `e${entryIdRef.current++}`
    setTimeline(prev => {
      const next = [...prev, { ...entry, id } as TimelineEntry]
      tickPrependBuffer(entry)
      if (next.length > liveLimitRef.current) {
        const drop = next.length - liveLimitRef.current
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
  // Two-step close: clicking `close ✕` on the bottom bar flips this
  // flag, which swaps the input area for a confirm panel ([Cancel]
  // [Confirm]). Confirm fires the real stopChat. Cancel reverts.
  const [closeConfirming, setCloseConfirming] = useState(false)

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
          // First time seeing this id → genuine new entry. Apply cap
          // + buffer-tick like addEntry. Subsequent same-id calls hit
          // the in-place replace branch below and don't tick the
          // buffer (streaming text deltas == 1 logical message).
          const next = [...prev, entry]
          tickPrependBuffer(entry as any)
          if (next.length > liveLimitRef.current) {
            const drop = next.length - liveLimitRef.current
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
      // ── Active subagent tracking ───────────────────────────────
      // Run before any early-return branch so we never miss a
      // signal. Three categories of update:
      //   - Task tool_use spawning  → register
      //   - task_progress / any parent_tool_use_id event → bump
      //   - tool_result with matching tool_use_id → deregister
      const evAny = ev as any
      if (ev.type === 'stream_event') {
        const e = evAny.event
        if (e?.type === 'content_block_start') {
          const b = e.content_block
          if (b?.type === 'tool_use' && b.id && (b.name === 'Task' || b.name === 'Agent')) {
            setActiveSubagents(prev => ({
              ...prev,
              [b.id]: { startedAt: Date.now(), lastEventAt: Date.now(), eventCount: 0 }
            }))
          }
        }
      } else if (ev.type === 'assistant' && evAny.message?.content) {
        for (const b of evAny.message.content) {
          if (b?.type === 'tool_use' && b.id && (b.name === 'Task' || b.name === 'Agent')) {
            setActiveSubagents(prev => prev[b.id]
              ? prev
              : { ...prev, [b.id]: { startedAt: Date.now(), lastEventAt: Date.now(), eventCount: 0 } })
          }
        }
      }
      if (ev.type === 'system' && evAny.subtype === 'task_progress' && evAny.tool_use_id) {
        const tuid = evAny.tool_use_id as string
        setActiveSubagents(prev => {
          const cur = prev[tuid] || { startedAt: Date.now(), lastEventAt: Date.now(), eventCount: 0 }
          return {
            ...prev,
            [tuid]: {
              ...cur,
              lastEventAt: Date.now(),
              eventCount: cur.eventCount + 1,
              description: evAny.description,
              lastToolName: evAny.last_tool_name,
              totalTokens: evAny.usage?.total_tokens,
              toolUses: evAny.usage?.tool_uses,
              durationMs: evAny.usage?.duration_ms
            }
          }
        })
      }
      if (evAny.parent_tool_use_id) {
        const ptid = evAny.parent_tool_use_id as string
        setActiveSubagents(prev => {
          if (!prev[ptid]) return prev
          return { ...prev, [ptid]: { ...prev[ptid], lastEventAt: Date.now(), eventCount: prev[ptid].eventCount + 1 } }
        })
      }
      if (ev.type === 'user' && evAny.message?.content && Array.isArray(evAny.message.content)) {
        for (const b of evAny.message.content) {
          if (b?.type === 'tool_result' && b.tool_use_id) {
            setActiveSubagents(prev => {
              if (!prev[b.tool_use_id]) return prev
              const next = { ...prev }
              delete next[b.tool_use_id]
              return next
            })
          }
        }
      }

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
      // Subagent events: when a Task tool spawns a subagent, claude's
      // stream emits the subagent's user/assistant turns into the
      // parent stream too, with `parent_tool_use_id` pointing at the
      // Task call. We tag the entry as `isSubagent: true` later in
      // each branch so the renderer can dim them visually instead of
      // making them look like main-chat user input.
      const isSubagent = (ev as any).parent_tool_use_id != null
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
            replaceEntry(entryId, { kind: 'assistant', text: block.text, id: entryId, isSubagent } as any)
          } else if (block.type === 'tool_use') {
            replaceEntry(entryId, { kind: 'tool_call', name: block.name, input: block.input, id: entryId, toolUseId: block.id, isSubagent } as any)
          }
        })
      } else if (ev.type === 'user' && 'message' in ev) {
        const content = (ev as any).message?.content
        if (typeof content === 'string') {
          addEntry({ kind: 'user', text: content, isSubagent } as any)
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') addEntry({ kind: 'user', text: block.text, isSubagent } as any)
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
                id: entryId,
                isSubagent
              } as any)
            }
          }
        }
      } else if (ev.type === 'result') {
        const e = ev as any
        // Track latest context usage for the status-bar progress bar.
        // The FULL context loaded = input_tokens (this turn's new) +
        // cache_read_input_tokens (prefix re-used from cache) +
        // cache_creation_input_tokens (this turn's freshly cacheable).
        // Earlier we only used input_tokens — when cache was warm the
        // bar showed 0% (input was 6 while real context was 250K).
        const u = e.usage
        const inp = typeof u?.input_tokens === 'number' ? u.input_tokens : 0
        const cacheRead = typeof u?.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0
        const cacheCreate = typeof u?.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0
        const total = inp + cacheRead + cacheCreate
        if (total > 0) {
          // Auto-compact heuristic: total context dropped to less than
          // half of the prior peak (and ≥30K delta) → claude compacted.
          const prior = latestInputTokens
          if (prior > 0 && total < prior * 0.5 && prior - total > 30000) {
            const turns = e.num_turns || 0
            addEntry({
              kind: 'compact_boundary',
              previousTokens: prior,
              newTokens: total,
              turnsSummarized: turns
            } as any)
          }
          setLatestInputTokens(total)
        }
        addEntry({
          kind: 'result',
          costUSD: e.total_cost_usd,
          durationMs: e.duration_ms,
          numTurns: e.num_turns,
          inputTokens: e.usage?.input_tokens,
          outputTokens: e.usage?.output_tokens,
          cacheReadTokens: e.usage?.cache_read_input_tokens,
          // Surface non-`end_turn` stop reasons (refusal, max_tokens,
          // pause_turn, model_context_window_exceeded, etc.) so the
          // user notices when claude didn't simply finish normally.
          stopReason: typeof e.stop_reason === 'string' ? e.stop_reason : undefined
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
      if (entries.length) {
        // Temporarily raise the cap to fit the loaded batch + arm the
        // buffer countdown. After PREPEND_BUFFER_TURNS genuine live
        // entries arrive, tickPrependBuffer snaps cap back to 500 and
        // the next addEntry trims the loaded-older block in one go.
        liveLimitRef.current += entries.length
        prependBufferRef.current = PREPEND_BUFFER_TURNS
        setTimeline(prev => [...entries, ...prev])
      }
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

    const offAutoContinue = window.api.chat.onAutoContinue(id, (payload) => {
      setAutoContinueAt(payload?.at ?? null)
    })

    return () => {
      offEv()
      offErr()
      offExit()
      offUsage()
      offPrepend()
      offRcOutput()
      offRcExit()
      offAutoContinue()
      window.api.chat.stop(id)
    }
  }, [id, cwd, agent, agentName, continueSession, rebaseOnStart])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [timeline.length])

  // Voice input → input box. App.tsx broadcasts CustomEvent
  // `hive:voice-final` whenever the mic produces a finalized
  // transcript. HiveChat's `id` is `chat-<agentId>` so we extract the
  // raw agentId for matching. We append (not replace) with a smart
  // separator so multiple voice segments stack naturally.
  useEffect(() => {
    const myAgentId = id.startsWith('chat-') ? id.slice(5) : id
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ agentId: string; text: string }>
      if (!ev.detail || ev.detail.agentId !== myAgentId) return
      const text = ev.detail.text.trim()
      if (!text) return
      setInput(prev => {
        if (!prev) return text
        // Insert a space before the new chunk unless prev already ends
        // in whitespace or punctuation that flows naturally.
        const needsSpace = !/[\s,.!?;:，。！？；：]$/.test(prev)
        return prev + (needsSpace ? ' ' : '') + text
      })
    }
    window.addEventListener('hive:voice-final', handler)
    return () => window.removeEventListener('hive:voice-final', handler)
  }, [id])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    // Intercept session-scoped slash commands that don't work in --print
    // mode (each handler takes over; no stream-json frame goes out).
    if (text === '/remote-control') {
      setInput('')
      addEntry({ kind: 'system', text: 'Starting remote control…' })
      setRcOutput('')
      const res = await window.api.chat.startRemoteControl(id)
      if (res.ok) setRcState('active')
      else addEntry({ kind: 'system', text: `Remote control failed: ${res.error}` })
      return
    }
    if (text === '/compact') {
      setInput('')
      addEntry({ kind: 'system', text: '⏳ Compacting context (PTY round-trip, ~10s)…' })
      const res = await window.api.chat.compact(id)
      addEntry({ kind: 'system', text: res.ok ? '✓ Context compacted, session resumed' : `Compact failed: ${res.error}` })
      return
    }
    setSending(true)
    addEntry({ kind: 'user', text })
    setInput('')
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

  // Two-step close. First click on `close ✕` opens a confirm panel
  // (replaces the input area). Cancel reverts; Confirm actually
  // kills the subprocess. Auto-revert if rcState/exited changes
  // would make the panel meaningless (handled implicitly by the
  // render branch order).
  const closeSession = () => { setCloseConfirming(true) }
  const cancelClose = () => { setCloseConfirming(false) }
  const confirmClose = async () => {
    setCloseConfirming(false)
    addEntry({ kind: 'system', text: 'Session closed by user. Timeline kept; click Start new session below to continue with the same agent.' })
    await window.api.chat.stop(id)
    // main's stopChat fires chat:exit which flips `exited` state; the
    // input area then renders the existing "session closed" + new-
    // session button panel off `exited !== null`.
  }

  const startNewSession = async () => {
    // Fresh session with the same agent — no -c, no --resume. System/init
    // will emit a new session_id; timeline is preserved and a divider is
    // added to make the boundary visible. Model has NO memory of the
    // closed session — context cleared.
    addEntry({ kind: 'system', text: '── new session (context cleared) ──' })
    setExited(null)
    setSessionId('')
    setRateLimit(null)
    setUsage({})
    setThinking(null)
    setPendingPermission(null)
    setHasOlderOnDisk(false)
    setTrimmedCount(0)
    setLatestInputTokens(0)
    await window.api.chat.start(id, {
      cwd, agent, name: agentName,
      continueSession: false,
      rebaseOnStart: false
    })
  }

  const resumeClosedSession = async () => {
    // Smart resume: backend reads the session JSONL, if prior context
    // > 50% of model window it /compact's first, then re-spawns
    // --print --resume <sid>. Otherwise just plain resume.
    addEntry({ kind: 'system', text: '── resuming session ──' })
    setExited(null)
    setRateLimit(null)
    setUsage({})
    setThinking(null)
    setPendingPermission(null)
    setLatestInputTokens(0)
    const res = await window.api.chat.resumeSmart(id)
    if (!res.ok) {
      addEntry({ kind: 'system', text: `Resume failed: ${res.error}` })
    } else if (res.compacted) {
      addEntry({ kind: 'system', text: '✓ Auto-compacted before resume (context > 50%)' })
    }
  }

  const startSessionWithSummary = async () => {
    // Compact current context into a summary, fork to new session-id.
    // Same agent, same cwd, but a brand new session JSONL with the
    // summary as the seeding context. Best when you want to start
    // 'fresh' without losing the conversation's gist.
    addEntry({ kind: 'system', text: '── starting new session with summary ──' })
    setExited(null)
    setSessionId('')
    setRateLimit(null)
    setUsage({})
    setThinking(null)
    setPendingPermission(null)
    setHasOlderOnDisk(false)
    setTrimmedCount(0)
    setLatestInputTokens(0)
    const res = await window.api.chat.startWithSummary(id)
    if (!res.ok) {
      addEntry({ kind: 'system', text: `Start with summary failed: ${res.error}` })
    }
  }

  // Click ↺ icon on any past UserMessage → fill input with that text
  // for edit & resend. Focuses the textarea so the user can immediately
  // tweak. Replaces the ↑/↓ keyboard recall (chat-native idiom — ↑ is
  // for textarea cursor navigation, not a history shortcut).
  const handleRecall = useCallback((text: string) => {
    setInput(text)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  // Drag-and-drop file → input box. Same as Terminal but appends to
  // the chat input instead of writing to PTY. Drop a file from
  // FilesPanel / Finder anywhere on the HiveChat surface; quoted
  // paths get appended to the textarea separated by spaces, then
  // focused so the user can keep typing. Plain-text drops also work.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    let inserted = ''
    if (e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files)
        .map(f => window.api.getFilePath(f))
        .filter(Boolean) as string[]
      if (paths.length > 0) {
        inserted = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ')
      }
    }
    if (!inserted) {
      inserted = e.dataTransfer.getData('text/plain') || ''
    }
    if (!inserted) return
    setInput(prev => {
      if (!prev) return inserted
      const sep = /\s$/.test(prev) ? '' : ' '
      return prev + sep + inserted
    })
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleChoose = useCallback((pick: string) => {
    addEntry({ kind: 'user', text: pick })
    window.api.chat.send(id, pick)
  }, [id])

  // ✏ icon on a list item → quote into input box prefixed with `-- `
  // so user can type their actual reply after. Visual cue this is "I'm
  // responding to this specific item, not picking it". Doesn't send;
  // user hits Enter when ready.
  const handleRespond = useCallback((item: string) => {
    setInput(prev => {
      // Quote the item with `--` AFTER the content + newline so the
      // user's caret lands on a fresh line ready to write the reply.
      // e.g. "等 CI 跑 + 你看 PR diff 决定 merge --\n<caret>"
      const quoted = `${item} --\n`
      return prev ? prev + (prev.endsWith('\n') ? '' : '\n') + quoted : quoted
    })
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

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
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
      style={{
      width: '100%', height: '100%',
      // Locked to deep-purple regardless of system/app theme. The Crush
      // palette is engineered for a dark base; on a light background the
      // accents (Charple/Dolly/Julep) and Butter/Ash text collapse into
      // invisibility. Don't follow var(--bg-primary).
      background: '#150e24',  // matches --sidebar-bg dark mode (project list)
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
        <TimelineList timeline={timeline} onChoose={handleChoose} onRecall={handleRecall} onRespond={handleRespond} />
        {thinking && <ThinkingSpinner since={thinking.since} />}
        {exited !== null && (
          <div style={{ color: CRUSH.Sriracha, fontSize: 11, marginTop: 12, padding: 4 }}>
            claude exited (code {exited})
          </div>
        )}
        {/* stderr lines now flow into the timeline as system entries — no pinned box. */}
      </div>

      {/* Subagent active banner — sticky above rate-limit, only when
         at least one Task tool is running. Spinner + per-subagent line. */}
      {Object.keys(activeSubagents).length > 0 && (
        <SubagentBanner subs={activeSubagents} />
      )}
      {/* Rate-limit status line — sits just above input, updates live.
         When no rate_limit_event has arrived yet, shows a subdued
         "waiting for first message…" so the user knows Chat is live
         but nothing's happened yet. */}
      {rateLimit ? (
        <RateLimitBar
          info={rateLimit}
          autoContinueAt={autoContinueAt}
          onCancelAutoContinue={() => window.api.chat.cancelAutoContinue(id)}
        />
      ) : !modelName ? (
        <div style={{
          padding: '4px 12px',
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          background: CRUSH.BBQ,
          fontFamily: FONT_MONO, fontSize: 11,
          color: CRUSH.Oyster
        }}>waiting for first message…</div>
      ) : null}

      {/* Input area — four variants in priority order:
          - exited !== null          → "session closed, start new" panel
          - rcState === 'active'     → RC pairing panel
          - closeConfirming          → confirm-close panel (Cancel / OK)
          - else                     → normal textarea
          A confirmed close fires confirmClose() → stopChat → exit
          event → exited flips → first branch takes over. */}
      {closeConfirming && exited === null && rcState !== 'active' ? (
        <div style={{
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          background: CRUSH.BBQ,
          padding: 8
        }}>
          <div style={{
            border: `1px solid ${CRUSH.Sriracha}`,
            borderRadius: 8,
            padding: 10,
            background: 'rgba(235,66,104,0.06)'
          }}>
            <div style={{
              color: CRUSH.Sriracha, fontWeight: 700, fontSize: 12,
              textTransform: 'uppercase' as const, letterSpacing: '0.08em',
              marginBottom: 6
            }}>● close this session?</div>
            <div style={{ color: CRUSH.Squid, fontSize: 11, marginBottom: 10 }}>
              The claude subprocess will be killed. Timeline above is kept.
              You can start a fresh session afterwards (same agent, new
              context). No API charges while closed.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={cancelClose}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: `1px solid ${CRUSH.Charcoal}`,
                  borderRadius: 6,
                  padding: '8px 16px',
                  color: CRUSH.Squid,
                  fontFamily: FONT_MONO, fontSize: 13, fontWeight: 500,
                  cursor: 'pointer'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = CRUSH.Squid; e.currentTarget.style.color = CRUSH.Butter }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = CRUSH.Charcoal; e.currentTarget.style.color = CRUSH.Squid }}
              >Cancel</button>
              <button
                onClick={confirmClose}
                style={{
                  flex: 1,
                  background: CRUSH.Sriracha,
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 16px',
                  color: CRUSH.Butter,
                  fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer'
                }}
              >OK · close session</button>
            </div>
          </div>
        </div>
      ) : exited !== null && rcState !== 'active' ? (
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
              color: CRUSH.Squid, fontSize: 11, marginBottom: 10, lineHeight: 1.6
            }}>
              The claude subprocess is gone. History above is kept. Pick
              how the new claude should remember (or not):
              <br/>
              <strong style={{ color: CRUSH.Bok }}>↻ Resume</strong> — same session, full context (auto-compacts if &gt; 50%).
              <br/>
              <strong style={{ color: CRUSH.Charple }}>≡ With summary</strong> — compact + fork to new session-id (summary as seed).
              <br/>
              <strong style={{ color: CRUSH.Julep }}>⊕ New</strong> — clean slate, no memory.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={resumeClosedSession}
                disabled={!sessionId}
                title={sessionId ? 'Re-spawn claude with --resume <sid>; auto /compact if prior turn used > 50% context' : 'No session-id captured yet'}
                style={{
                  flex: 1,
                  background: sessionId ? CRUSH.Bok : 'rgba(104,255,214,0.2)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 8px',
                  color: CRUSH.Pepper,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: sessionId ? 'pointer' : 'not-allowed',
                  opacity: sessionId ? 1 : 0.5,
                  whiteSpace: 'nowrap' as const
                }}
              >↻ Resume</button>
              <button
                onClick={startSessionWithSummary}
                disabled={!sessionId}
                title={sessionId ? '/compact + --resume <sid> --fork-session: new session-id, summary preserved' : 'No session-id captured yet'}
                style={{
                  flex: 1,
                  background: sessionId ? CRUSH.Charple : 'rgba(107,80,255,0.2)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 8px',
                  color: CRUSH.Butter,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: sessionId ? 'pointer' : 'not-allowed',
                  opacity: sessionId ? 1 : 0.5,
                  whiteSpace: 'nowrap' as const
                }}
              >≡ With summary</button>
              <button
                onClick={startNewSession}
                title="Fresh claude --print — model has no memory of prior turns"
                style={{
                  flex: 1,
                  background: CRUSH.Julep,
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 8px',
                  color: CRUSH.Pepper,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap' as const
                }}
              >⊕ New</button>
            </div>
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
            <span style={{ color: CRUSH.Julep, fontWeight: 700, fontSize: 16 }}>❯</span>
            <textarea
              ref={textareaRef}
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
                // ↑/↓ left as native textarea cursor navigation. Recall is
                // a click-the-↺-icon action on each past UserMessage now.
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
            {/* Stop button — appears at the right of the input while
                claude is generating (sending or thinking). Sends a
                control_request {subtype:"interrupt"} on stdin which
                cancels the current turn without ending the session. */}
            {(sending || thinking) && (
              <button
                onClick={() => {
                  window.api.chat.interrupt(id).catch(() => {})
                  setThinking(null)
                }}
                title="Stop generation (interrupt current turn)"
                style={{
                  flexShrink: 0,
                  background: 'transparent',
                  border: `1px solid ${CRUSH.Sriracha}`,
                  color: CRUSH.Sriracha,
                  width: 22, height: 22,
                  borderRadius: 4,
                  fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = CRUSH.Sriracha
                  e.currentTarget.style.color = CRUSH.Butter
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = CRUSH.Sriracha
                }}
              >■</button>
            )}
          </div>
        </div>
      )}

      {/* Model / usage line — stays under input */}
      <ModelUsageBar
        modelName={modelName} contextSize={contextSize} usage={usage} rateLimit={rateLimit}
        streamingMode={streamingMode} onToggleStreaming={toggleStreamingMode}
        onCloseSession={closeSession}
        sessionActive={exited === null && rcState === 'idle'}
        contextUsedTokens={latestInputTokens}
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

/**
 * Sticky banner above the rate-limit row whenever a Task tool's
 * subagent is currently running. Driven by the `activeSubagents`
 * state — populated on Task tool_use, refreshed on every
 * `task_progress` system event (claude tells us subagent is alive
 * + what it's doing right now), removed on matching tool_result.
 *
 * Per-row format:
 *   🔧 [Read]  Reading regen-batch2-handbook.md  · 2 tools · 21K · 3.5s
 * Multiple subagents → multiple rows.
 *
 * Uses a 1Hz tick so 'last activity Xs ago' stays fresh even when
 * no new events flow.
 */
function SubagentBanner({ subs }: { subs: Record<string, {
  startedAt: number; lastEventAt: number; eventCount: number
  description?: string; lastToolName?: string
  totalTokens?: number; toolUses?: number; durationMs?: number
}> }) {
  const [, force] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  const fmtDur = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }
  const fmtK = (n?: number) => {
    if (typeof n !== 'number') return '—'
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return String(n)
  }
  const entries = Object.entries(subs)
  return (
    <div style={{
      padding: '4px 10px',
      borderTop: `1px solid ${CRUSH.Charcoal}`,
      borderBottom: `1px solid ${CRUSH.Charcoal}`,
      background: 'rgba(107,80,255,0.08)',  // Charple tint (Crush purple)
      fontFamily: FONT_MONO, fontSize: 11,
      color: CRUSH.Ash,
      display: 'flex', flexDirection: 'column', gap: 2
    }}>
      <style>{`@keyframes hg-flip { 0%,40% { transform: rotate(0deg); } 60%,100% { transform: rotate(180deg); } }`}</style>
      {entries.map(([tuid, s], i) => {
        const elapsed = Date.now() - s.startedAt
        const idleMs = Date.now() - s.lastEventAt
        // 60s threshold: claude task_progress fires every few seconds
        // when the subagent is alive; only flag idle when nothing has
        // come in for a full minute (likely true hang, not just a
        // slow tool).
        const isHealthy = idleMs < 60000
        return (
          <div key={tuid} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
            <span style={{
              display: 'inline-block',
              fontSize: 13,
              animation: isHealthy ? 'hg-flip 2s ease-in-out infinite' : 'none',
              color: isHealthy ? CRUSH.Charple : CRUSH.Zest
            }}>⏳</span>
            <span style={{ color: CRUSH.Charple, fontWeight: 700, letterSpacing: '0.02em' }}>
              Subagent #{i + 1}
            </span>
            <span style={{ color: CRUSH.Butter, flex: 1, minWidth: 0, overflow: 'hidden' as const, textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {s.description ? redact(s.description) : 'thinking'}
              {isHealthy
                ? <span className="hive-dots-loader" style={{ color: CRUSH.Charple, marginLeft: 1 }} />
                : <span style={{ color: CRUSH.Zest, marginLeft: 1 }}>...</span>}
            </span>
            <span style={{ color: CRUSH.Squid, marginLeft: 'auto' }}>
              {s.toolUses != null && `${s.toolUses} tools · `}
              {fmtK(s.totalTokens)} tok · {fmtDur(elapsed)}
              {!isHealthy && (
                <span style={{ color: CRUSH.Zest, marginLeft: 6 }}>· idle {Math.floor(idleMs / 1000)}s</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RateLimitBar({ info, autoContinueAt, onCancelAutoContinue }: {
  info: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null
  autoContinueAt?: number | null
  onCancelAutoContinue?: () => void
}) {
  if (!info) return null
  const type = info.rateLimitType === 'five_hour' ? '5h' : info.rateLimitType === 'seven_day' ? '7d' : info.rateLimitType || '?'
  const color = info.status === 'allowed' ? CRUSH.Julep
    : info.status === 'rejected' || info.status === 'blocked' ? CRUSH.Sriracha
    : CRUSH.Zest
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
      {autoContinueAt && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: CRUSH.Charple }}>
            ⏱ auto-continue in {humanEta(Math.floor(autoContinueAt / 1000))}
          </span>
          {onCancelAutoContinue && (
            <button
              onClick={onCancelAutoContinue}
              style={{
                background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
                color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 10,
                padding: '1px 6px', borderRadius: 2, cursor: 'pointer'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = CRUSH.Charple; e.currentTarget.style.color = CRUSH.Charple }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = CRUSH.Charcoal; e.currentTarget.style.color = CRUSH.Squid }}
            >
              cancel
            </button>
          )}
        </span>
      )}
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

/** Grain-style text bar — `█` for filled, `░` for empty, monospace.
 * Empty uses Oyster `#605F6B` (not Charcoal `#3A3943` which was too
 * close to BBQ bg `#2D2C35` to be visible — preview was wrong, fixed
 * in v1.7.70 per user feedback). */
function PctBar({ pct, fullColor = CRUSH.Julep, total = 10 }: { pct?: number; fullColor?: string; total?: number }) {
  const filled = typeof pct === 'number'
    ? Math.round(Math.max(0, Math.min(100, pct)) / 100 * total)
    : 0
  const empty = total - filled
  return (
    <span style={{ letterSpacing: 0 }}>
      <span style={{ color: fullColor }}>{'█'.repeat(filled)}</span>
      <span style={{ color: CRUSH.Oyster }}>{'░'.repeat(empty)}</span>
    </span>
  )
}

function ModelUsageBar({ modelName, contextSize, usage, rateLimit, streamingMode, onToggleStreaming, onCloseSession, sessionActive, contextUsedTokens }: {
  modelName: string
  contextSize: string
  usage: {
    costUSD?: number; burnPerHour?: number; projectedUSD?: number; remainingMinutes?: number
    totalTokens?: number; fiveHour?: number; sevenDay?: number
    fiveHourReset?: string; sevenDayReset?: string
  }
  rateLimit: any
  streamingMode: boolean
  onToggleStreaming: () => void
  onCloseSession: () => void
  sessionActive: boolean
  contextUsedTokens: number
}) {
  // Parse "1M" / "200K" → number for context %% math.
  const parseSize = (s: string): number => {
    const m = s.match(/^(\d+)([kKmM])$/)
    if (!m) return 0
    const n = parseInt(m[1], 10)
    return m[2].toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000
  }
  const ctxTotal = parseSize(contextSize)
  const ctxPct = ctxTotal > 0 && contextUsedTokens > 0
    ? Math.round((contextUsedTokens / ctxTotal) * 100)
    : null
  const ctxColor = ctxPct == null
    ? CRUSH.Squid
    : ctxPct >= 85 ? CRUSH.Sriracha
    : ctxPct >= 70 ? CRUSH.Zest
    : CRUSH.Bok
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
          {/* Context window %% sits next to (1M) — both belong to "this
              session's context window", logically separate from the
              account-level subscription bars on the other side of the
              `|`. Color shifts Bok → Zest → Sriracha at 70 / 85. */}
          {ctxPct != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}
                  title={`Context: ${contextUsedTokens.toLocaleString()} / ${ctxTotal.toLocaleString()} tokens`}>
              <span style={{ color: CRUSH.Squid }}>ctx</span>
              <PctBar pct={ctxPct} fullColor={ctxColor} />
              <span style={{ color: ctxColor, minWidth: 28, fontWeight: ctxPct >= 70 ? 700 : 400 }}>
                {ctxPct}%
              </span>
            </span>
          )}
          <span style={{ color: CRUSH.Oyster }}>|</span>
        </>
      )}
      {/* Subscription tier %% + reset countdown (both scraped from
          /usage TUI). reset string is verbatim from claude — could be
          "4h 12m" / "6d 14h" / "Apr 30 14:00" depending on locale. */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: CRUSH.Squid }}>5h</span>
        <PctBar pct={usage.fiveHour} />
        <span style={{ color: CRUSH.Butter, minWidth: 28 }}>
          {usage.fiveHour != null ? `${usage.fiveHour}%` : '—'}
        </span>
        {usage.fiveHourReset && (
          <span style={{ color: CRUSH.Oyster, fontSize: 10 }}>· in {usage.fiveHourReset}</span>
        )}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: CRUSH.Squid }}>7d</span>
        <PctBar pct={usage.sevenDay} />
        <span style={{ color: CRUSH.Butter, minWidth: 28 }}>
          {usage.sevenDay != null ? `${usage.sevenDay}%` : '—'}
        </span>
        {usage.sevenDayReset && (
          <span style={{ color: CRUSH.Oyster, fontSize: 10 }}>· in {usage.sevenDayReset}</span>
        )}
      </span>
      {/* eta "Xh Ym left" removed — RateLimitBar above the input
          already shows the same reset countdown. */}
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
          title="End this claude session. A confirm panel will appear."
          style={{
            background: 'transparent',
            border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Squid,
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: FONT_MONO, fontSize: 10,
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = CRUSH.Sriracha
            e.currentTarget.style.color = CRUSH.Sriracha
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = CRUSH.Charcoal
            e.currentTarget.style.color = CRUSH.Squid
          }}
        >close ✕</button>
      )}
    </div>
  )
}
