import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CRUSH, FONT_MONO, redact, configureRedact } from './crush-styles'
import { computeGrainBar, parseContextSize, selectCtxNagTier, selectCompactBtnTier } from './progress-bar'
import { TimelineRow, ThinkingSpinner, HiveChatPausedContext, AskUserQuestionContext, SignInContext, classifyResultError, dismissActionForAuthState } from './renderers'
import { flattenHistoricalEvents } from './flatten'
import { isCompactSummaryEvent, extractCompactSummaryHint } from './compact-summary'
import { createFrameCoalescer } from './streamCoalescer'
import { mergeUsage, preserveAccountUsage } from './usage-state'
import { shortenPath } from '../../lib/path-display'
import type { ContentBlock, StreamEvent, TimelineEntry } from './types'
import HandoffModal from '../HandoffModal'
import HandoffBanner from '../HandoffBanner'

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
  onCloseTerminal?: () => void
}

/**
 * HiveChat — Crush-flavored structured chat UI driven by
 * `claude --print --output-format stream-json`. The main process spawns
 * one claude subprocess per chat session and streams JSON events to us.
 * We flatten those into a TimelineEntry list and render each entry with
 * a Crush-styled component.
 */
export default function HiveChat({ id, cwd, agent, agentName, continueSession, rebaseOnStart, visible, onCloseTerminal }: Props) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [exited, setExited] = useState<number | null>(null)
  const [handoffModalOpen, setHandoffModalOpen] = useState(false)
  // agent id derived from `agent` prop (which is 'hive-<id>') — used by
  // Handoff supervisor to key running handoffs, and by the banner + crazy
  // avatar overlay to look up state by agent.
  const handoffAgentId = agent?.startsWith('hive-') ? agent.slice(5) : (agent || '')
  // True while a handoff is actively running against THIS chat. Powers
  // the permission-modal auto-allow bypass (v2.2.0): during handoff, any
  // PermissionRequest is answered `allow` immediately without opening
  // the modal, matching the "walk away, agent decides" contract.
  const [isHandoffActive, setIsHandoffActive] = useState(false)
  useEffect(() => {
    const api = (window as any).api?.handoff
    if (!api) return
    let cancelled = false
    const refresh = async () => {
      try {
        const ids: string[] = await api.activeChatIds()
        if (!cancelled) setIsHandoffActive(ids.includes(id))
      } catch { /* silent */ }
    }
    refresh()
    const off1 = api.onProgress?.((s: { chatId?: string }) => { if (s.chatId === id) refresh() })
    const off2 = api.onDone?.((s: { chatId?: string }) => { if (s.chatId === id) refresh() })
    return () => { cancelled = true; off1?.(); off2?.() }
  }, [id])
  // Status-bar state (above + below input)
  const [modelName, setModelName] = useState<string>('')     // "claude-opus-4-7"
  const [contextSize, setContextSize] = useState<string>('') // "1M"
  // Per-window rate-limit state. Each rate_limit_event carries one
  // rateLimitType ('five_hour' | 'seven_day'). We keep the latest seen
  // event for each window separately so the toolbar can render both
  // tiers side-by-side instead of overwriting one with the other.
  type RlEvent = { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean }
  const [rateLimit5h, setRateLimit5h] = useState<RlEvent | null>(null)
  const [rateLimit7d, setRateLimit7d] = useState<RlEvent | null>(null)
  // Back-compat alias for any consumer that just wants "any rate-limit
  // event" (e.g. legacy ModelUsageBar prop). Prefers 7d when both exist
  // since it's the longer window and usually the binding constraint.
  const rateLimit = rateLimit7d || rateLimit5h
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
  // Per-threshold dismissal: once the user closes a tier's nag, don't
  // re-fire it on the next result event. Reset when ctx drops below
  // the lower threshold (i.e. /compact succeeded). 80=warn, 90=urgent.
  const [ctxNagDismissed, setCtxNagDismissed] = useState<{ warn: boolean; urgent: boolean }>({ warn: false, urgent: false })
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

  // Stale-state auto-cleanup (v1.7.98). Without these, ghost state from
  // crashed/disconnected --print sessions leaves tickers re-rendering at
  // 1Hz forever — the trace-confirmed cause of last week's 174% Renderer
  // CPU spike.
  //
  //  - activeSubagents: 20 min since last event → drop. Real subagents'
  //    actual runtime is well under 20 min; only ghosts (Task whose
  //    tool_result never arrives because claude died mid-flight) stick
  //    around longer. Prune runs every 60s.
  //  - thinking: 60s since set → clear. message_stop normally clears it
  //    in 5–30s; if 60s passes with neither stop nor text_delta arriving,
  //    the stream is orphaned and the spinner shouldn't keep ticking.
  useEffect(() => {
    const iv = setInterval(() => {
      setActiveSubagents(prev => {
        const cutoff = Date.now() - 20 * 60 * 1000
        let dropped = 0
        const next: Record<string, SubagentState> = {}
        for (const [k, v] of Object.entries(prev)) {
          if (v.lastEventAt > cutoff) next[k] = v
          else dropped++
        }
        return dropped > 0 ? next : prev
      })
    }, 60_000)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => {
    if (!thinking) return
    const t = setTimeout(() => setThinking(null), 60_000)
    return () => clearTimeout(t)
  }, [thinking])
  // Queue (not single slot) — claude SDK fires multiple control_requests
  // in parallel when an assistant turn uses several tools at once (e.g.
  // Glob + Read + Grep simultaneously). The old single-slot setState was
  // overwritten by each new request so only the LAST one reached the user;
  // the rest left claude blocked on stdin forever waiting for control_response.
  // We append on arrival, render head, and shift after user replies.
  const [pendingPermissions, setPendingPermissions] = useState<Array<{
    requestId: string
    toolName: string
    displayName?: string
    input: Record<string, unknown>
    suggestions?: Array<{ type: string; rules: { toolName: string; ruleContent: string }[]; behavior: string; destination: string }>
  }>>([])
  // Existing render/reply code reads `pendingPermission.foo` — keep that
  // working by exposing the queue head as a derived var. `null` when empty.
  const pendingPermission = pendingPermissions[0] || null

  // v2.2.0 Handoff auto-allow: when a handoff is running for this chat,
  // every arriving PermissionRequest is immediately allow'd without
  // opening the modal. This is the "auto: all permission requests
  // approved while running" contract advertised in HandoffModal.
  // AskUserQuestion is intentionally NOT covered here — it goes through
  // pendingQuestion (separate state) and the supervisor's
  // stopOnAskUserQuestion breaker decides what to do with it.
  useEffect(() => {
    if (!isHandoffActive || pendingPermissions.length === 0) return
    for (const p of pendingPermissions) {
      window.api.chat.respondPermission(id, p.requestId, 'allow', p.input, undefined)
    }
    setPendingPermissions([])
  }, [isHandoffActive, pendingPermissions, id])

  // AskUserQuestion is technically a tool call (claude SDK emits it as a
  // can_use_tool control_request) but its semantics are "ask the user a
  // structured question with selectable options", NOT "allow tool to
  // run?". Tracked separately so renderers/index.tsx AskUserQuestionInline
  // can read the requestId via Context and reply via chat.respondPermission.
  const [pendingQuestion, setPendingQuestion] = useState<{
    requestId: string
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description?: string; preview?: string }>
      multiSelect: boolean
    }>
  } | null>(null)

  // Watchdog state: main fires `chat:compactStuck:<id>` once when a
  // /compact run has been alive >5min AND claude has been silent >60s.
  // Renderer shows an inline Cancel button. Clicking it hard-stops the
  // chat (which kills the stuck --print child) and clears the pending
  // queues — preventing the Pink-1050s wedge where the user had no
  // escape hatch.
  const [compactStuck, setCompactStuck] = useState<{ elapsedMs: number; lastOutputAgeMs: number } | null>(null)

  // True while a /compact run is mid-flight (start signal observed, no
  // end signal yet). Drives:
  //   - Send button disabled state (sending the message right now would
  //     target the dead pre-compact child)
  //   - Pending permission/question buttons greyed out (they'd reply to
  //     the killed child too)
  //   - Textarea placeholder swap + Enter-key intercept (user can still
  //     compose and we queue the draft for auto-send post-compact)
  // Started: visible at `setCompactStartedAt` (timestamp) so the
  // placeholder can show an elapsed-seconds counter without re-fetching.
  // Cleared on: ✅/❌ stderr, chat:exit, Cancel.
  const [compactStartedAt, setCompactStartedAt] = useState<number | null>(null)
  // Draft saved while compact is running. Auto-sent when compact ends
  // (and !pendingDraft cleared by Cancel — no auto-send on user bail).
  const [pendingDraft, setPendingDraft] = useState<string | null>(null)
  // Tick state so the "compacting — Ns elapsed" placeholder updates 1Hz
  // without re-render on every keystroke. Resets when compactStartedAt
  // is null.
  const [, setCompactElapsedTick] = useState(0)
  useEffect(() => {
    if (compactStartedAt === null) return
    const iv = setInterval(() => setCompactElapsedTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [compactStartedAt])
  // Derived (also true while the stuck banner is up, since compactStuck
  // implies compact is still alive — main only fires it before settle).
  const compactInProgress = compactStartedAt !== null || compactStuck !== null
  // Re-entry guard for the Compact button(s). compactInProgress only flips
  // once the backend's "Compacting…" stderr line echoes back — there's a
  // window between the click and that echo where a user could click Compact
  // again and fire a SECOND concurrent /compact (two PTY round-trips racing
  // on the same session). The ref blocks re-entry synchronously (before any
  // setState commits); the state drives the disabled visual. (v1.7.138)
  const compactBusyRef = useRef(false)
  const [compactBusy, setCompactBusy] = useState(false)

  // Sign-in modal — flipped to 'needed' when claude --print returns
  // result.error='authentication_failed' (a.k.a. "Not logged in"). The
  // modal spawns `claude auth login` via IPC, streams its stdout (with
  // device-code URL) into authOutput. On exit 0 → 'success'.
  const [authState, setAuthState] = useState<'idle' | 'needed' | 'in-progress' | 'success' | 'failed'>('idle')
  const [authOutput, setAuthOutput] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)

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

  // Context modal state — opens when user clicks the ⓘ icon next to the
  // ctx progress bar. data is the parsed /context snapshot; loading/error
  // drive the spinner / failure variants. Snapshot persists between
  // open/close so reopen-within-cache shows the prior data instantly.
  type CtxSnap = NonNullable<Awaited<ReturnType<typeof window.api.chat.scrapeContext>>['data']>
  const [contextModal, setContextModal] = useState<{
    open: boolean
    loading: boolean
    error: string | null
    data: CtxSnap | null
  }>({ open: false, loading: false, error: null, data: null })

  const triggerContextScrape = async (force: boolean) => {
    setContextModal(prev => ({ ...prev, loading: true, error: null }))
    try {
      const res = await window.api.chat.scrapeContext(id, force)
      if (res.ok && res.data) {
        setContextModal(prev => ({ ...prev, loading: false, data: res.data!, error: null }))
      } else {
        setContextModal(prev => ({ ...prev, loading: false, error: res.error || 'unknown' }))
      }
    } catch (e) {
      setContextModal(prev => ({ ...prev, loading: false, error: String(e) }))
    }
  }

  const openContextModal = () => {
    setContextModal(prev => ({ ...prev, open: true }))
    // First open: kick a scrape unless we already have data.
    if (!contextModal.data && !contextModal.loading) {
      void triggerContextScrape(false)
    }
  }

  // Start chooser — agent click opens HiveChat in "pick a startup mode"
  // state instead of auto-spawning. User picks one of:
  //   ↻ Resume / ⎙ Compact+Resume / ✦ Start new / ⑂ Fork.
  // Default focus picks itself: ctx > 80% → Compact+Resume; no prior
  // session → Start new; otherwise → Resume.
  const [chooserMode, setChooserMode] = useState(true)
  const [prevInfo, setPrevInfo] = useState<{
    sid: string; model: string; contextSize: string; peakInputTokens: number; lastActiveMs: number; cwd: string
  } | null>(null)
  const [prevInfoLoaded, setPrevInfoLoaded] = useState(false)
  // Picked-mode opts buffer. launchSession stores the desired chat.start
  // arguments here and flips chooserMode → false in the same render. The
  // main useEffect watches chooserMode; on the false transition it wires
  // up event listeners FIRST and only then fires chat.start, so the
  // backend's initial "Compacting…" stderr never lands before listeners
  // are ready.
  const pendingStartRef = useRef<{
    cwd?: string; agent?: string; name?: string;
    continueSession?: boolean; rebaseOnStart?: boolean;
    resumeSid?: string; forkSession?: boolean; forceCompact?: boolean
  } | null>(null)
  // Records the StartChooser mode that actually launched this session.
  // The placeholder text in the empty timeline reads from this — without
  // it the placeholder would default to the AGENT-level continueSession
  // pref (almost always true), so picking "Start new" mis-displayed
  // "Resuming most recent session…" even though the session was fresh.
  const [launchedMode, setLaunchedMode] = useState<'resume' | 'compact-resume' | 'new' | 'fork' | null>(null)

  useEffect(() => {
    if (!chooserMode) return
    let cancelled = false
    ;(async () => {
      try {
        // Pass the chat id so the backend can recover a session that lives in
        // a different bucket than this agent's worktree cwd (worktree↔session
        // mismatch — see main/session-locator.ts).
        const info = await window.api.chat.getPrevSessionInfo(cwd || '', id)
        if (!cancelled) { setPrevInfo(info); setPrevInfoLoaded(true) }
      } catch {
        if (!cancelled) setPrevInfoLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [chooserMode, cwd])

  const launchSession = (
    mode: 'resume' | 'compact-resume' | 'new' | 'fork',
    chosenSid?: string
  ) => {
    // chosenSid > prevInfo.sid > continueSession=-c. The session picker
    // hands us an explicit sid; without one we still want a sensible
    // default (latest sid via -c, which behaves like our pre-picker code).
    const sid = chosenSid || prevInfo?.sid
    // Resume/compact/fork must spawn claude in the SAME cwd the session was
    // created under, or claude looks in the wrong ~/.claude/projects bucket
    // and reports "No conversation found". prevInfo.cwd carries the recovered
    // cwd when the session lives outside this agent's worktree bucket; it
    // equals `cwd` in the normal case. A fresh "new" session stays in the
    // worktree.
    const resumeCwd = prevInfo?.cwd || cwd
    let opts: typeof pendingStartRef.current
    if (mode === 'resume') {
      // Explicit sid → --resume <sid>. No sid → -c (latest).
      opts = sid
        ? { cwd: resumeCwd, agent, name: agentName, resumeSid: sid, rebaseOnStart }
        : { cwd: resumeCwd, agent, name: agentName, continueSession: true, rebaseOnStart }
    } else if (mode === 'compact-resume' && sid) {
      opts = { cwd: resumeCwd, agent, name: agentName, resumeSid: sid, forceCompact: true }
    } else if (mode === 'fork' && sid) {
      opts = { cwd: resumeCwd, agent, name: agentName, resumeSid: sid, forkSession: true }
    } else {
      opts = { cwd, agent, name: agentName, continueSession: false, rebaseOnStart: false }
    }
    pendingStartRef.current = opts
    setLaunchedMode(mode)
    // Clear exited BEFORE flipping chooserMode false — otherwise the
    // auto-open-chooser-on-exit useEffect would immediately flip
    // chooserMode back to true (because exited is still non-null) and
    // trap the user in the chooser. Same applies to pending* state.
    setExited(null)
    setPendingPermissions([])
    setPendingQuestion(null)
    setAuthState('idle')
    setChooserMode(false)
  }

  useEffect(() => {
    if (chooserMode) return  // wait for user pick

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

    // Coalesce high-frequency streaming text deltas into at most one timeline
    // update per animation frame. claude emits a content_block_delta every few
    // tokens; calling replaceEntry (→ full ReactMarkdown reparse of the WHOLE
    // accumulated message) on each one is O(N²) per message and runs per active
    // agent — that pegged the renderer when several agents streamed at once.
    // The pending map holds the latest entry per id; the flush drains it. We
    // flushNow() at block boundaries (content_block_start) and message_stop so
    // ordering and final text stay exact even if no frame has fired.
    const streamPending = new Map<string, TimelineEntry>()
    const streamCoalescer = createFrameCoalescer({
      raf: (cb) => requestAnimationFrame(cb),
      caf: (h) => cancelAnimationFrame(h)
    })
    const flushStreamPending = () => {
      for (const [eid, entry] of streamPending) replaceEntry(eid, entry)
      streamPending.clear()
    }

    const offEv = window.api.chat.onEvent(id, (ev: StreamEvent) => {
      // ── Active subagent tracking ───────────────────────────────
      // Run before any early-return branch so we never miss a
      // signal. Three categories of update:
      //   - Task tool_use spawning  → register
      //   - task_progress / any parent_tool_use_id event → bump
      //   - tool_result with matching tool_use_id → deregister
      //
      // CRITICAL: skip historical replay events. claude writes user
      // (tool_result) and assistant (tool_use) lines into the JSONL in
      // async-writer order, NOT timestamp order — we've observed
      // tool_result appearing 11 lines BEFORE its parent tool_use even
      // though timestamps say tool_use was 20ms earlier. Replay reads
      // line-by-line, so processing those out-of-order entries leaves
      // BG subagents stuck registered (delete-before-register is a
      // no-op, then register sticks forever). Live stream-json events
      // arrive in timestamp order, so we only mutate activeSubagents
      // from live events and let the map start empty after replay.
      const evAny = ev as any
      if (!evAny._historical) {
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
      }

      // Status-bar updates — these bypass the scrolling timeline.
      if (ev.type === 'system' && (ev as any).subtype === 'init') {
        const rawModel = (ev as any).model as string | undefined
        if (rawModel) {
          const m = rawModel.match(/^(.+?)(?:\[(\d+[kKmM])\])?$/)
          if (m) {
            setModelName(m[1])
            // claude 2.1.x dropped the [1M] suffix from system.init model strings.
            // When absent, infer from model name: haiku = 200K, all others = 1M.
            const explicitSize = (m[2] || '').toUpperCase()
            const inferredSize = /haiku/i.test(m[1]) ? '200K' : '1M'
            setContextSize(explicitSize || inferredSize)
          } else {
            setModelName(rawModel)
            setContextSize(/haiku/i.test(rawModel) ? '200K' : '1M')
          }
        }
        const sid = (ev as any).session_id as string | undefined
        if (sid) setSessionId(sid)
        // If we previously saw a `chat:exit` (e.g. compactSession killed
        // the live --print as part of its kill→PTY→respawn dance), the
        // chat surface flipped into "session closed, start new" mode.
        // Now that a fresh `system/init` arrived, the new --print is
        // alive — clear `exited` so the closed-panel doesn't sit on
        // top of a working session. Bug repro: click ⎙ Compact → 4s
        // later the panel went to "closed" with no Compact button left,
        // even though the backend had successfully respawned.
        setExited(null)
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
        if (info) {
          if (info.rateLimitType === 'five_hour') setRateLimit5h(info)
          else if (info.rateLimitType === 'seven_day') setRateLimit7d(info)
          else setRateLimit7d(info)
        }
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
          streamCoalescer.flushNow() // ensure the final accumulated text lands
          setThinking(null)
          return
        }

        if (e?.type === 'content_block_start') {
          // Settle the previous block's pending text before this block creates
          // its entry, so deferred text never lands after a later block's row.
          streamCoalescer.flushNow()
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
            // Defer the heavy replaceEntry/markdown reparse to the next frame;
            // many deltas within one frame collapse to a single render.
            streamPending.set(entryId, { kind: 'assistant', text: block.text, id: entryId })
            streamCoalescer.schedule(flushStreamPending)
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

        // Pull usage from EVERY assistant event — live AND historical.
        // The duplicate-suppression early-return below skips live
        // snapshot RENDERING (stream_event already produced the entries),
        // but usage MUST still flow: long-running agents that never
        // close a turn never emit `result`, so without this the ctx %
        // bar shows nothing for the entire session. Subagent assistants
        // are skipped: their usage describes the subagent's window.
        if (msg?.usage && !isSubagent) {
          const total = extractCtxTotalFromUsage(msg.usage)
          if (total > 0) setLatestInputTokens(total)
        }

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
        // Compact / Compact+Fork summary user event — collapse to a
        // small hint chip carrying just the transcript jsonl path
        // (see compact-summary.ts + CompactSummaryHint). Rendering
        // the full 5-15 KB of "This session is being continued…"
        // prose as a normal user bubble was drowning the timeline
        // after every compact. The user-visible signal is the
        // CompactBoundary chip (result-handler heuristic above)
        // plus this hint's collapsed <details> that reveals the path.
        if (isCompactSummaryEvent(ev)) {
          const hint = extractCompactSummaryHint(ev)
          addEntry({ kind: 'compact_summary_hint', transcriptPath: hint.transcriptPath, summaryChars: hint.summaryChars } as any)
          return  // onEvent is per-event callback, not a loop — `return` not `continue`
        }
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
        //
        // PITFALL #1: subagent result events carry their own
        // independent usage. Updating ctx % from them flashes the
        // bar with the subagent's context size, which can exceed
        // the parent's window (alex(data) showed 181% from a
        // subagent overflow).
        //
        // PITFALL #2: the top-level `usage.cache_read_input_tokens`
        // is the CUMULATIVE sum across every iteration of an
        // agentic turn — each tool call re-reads the prefix from
        // cache, and claude reports the running total. For long
        // turns this balloons to multiples of the context window
        // (we saw 25M on a 1M model = 2498%).
        //
        // The real context size is the LAST iteration's input.
        // Each iteration object holds its own `input_tokens` /
        // `cache_read_input_tokens` / `cache_creation_input_tokens`,
        // and `iterations[-1]` represents the final model-visible
        // state. Fallback to top-level if iterations is missing.
        const isSubagentResult = e.parent_tool_use_id != null
        const total = isSubagentResult ? 0 : extractCtxTotalFromUsage(e.usage)
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
          // Reset both nag tiers when context drops ≥ 30% (a /compact
          // ran successfully). This way the next time we cross 80%
          // the user gets the warn banner again.
          if (prior > 0 && total < prior * 0.7) {
            setCtxNagDismissed({ warn: false, urgent: false })
          }
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
          stopReason: typeof e.stop_reason === 'string' ? e.stop_reason : undefined,
          // Carry the real error so the card renders the actual message
          // (+ inline Sign-in for auth_expired) instead of the misleading
          // "stopped: stop_sequence" that a rejected OAuth credential emits.
          isError: e.is_error === true,
          apiErrorStatus: typeof e.api_error_status === 'number' ? e.api_error_status : undefined,
          errorText: typeof e.result === 'string' ? e.result : undefined,
          isSubagent: isSubagentResult
        } as any)
      }
      // control_request: claude is asking for permission to use a tool
      // (fires when --permission-prompt-tool stdio is set and the tool
      // isn't in settings.allow). Capture it and show a modal; claude
      // is blocked on stdin until we reply via respondPermission.
      if (ev.type === 'control_request') {
        const req = (ev as any).request
        const requestId = (ev as any).request_id
        if (requestId && req?.subtype === 'can_use_tool') {
          // AskUserQuestion → routed to AskUserQuestionInline (inline in
          // timeline) via context, NOT the allow/deny modal — semantics
          // are "answer the user's structured question", not "allow tool
          // to run". claude SDK routes it through can_use_tool just like
          // any tool, but the input has `questions` array.
          if (req.tool_name === 'AskUserQuestion' && Array.isArray(req.input?.questions)) {
            setPendingQuestion({
              requestId,
              questions: req.input.questions
            })
            return
          }
          // Permission queue: append, never overwrite. Parallel tool use
          // (Glob × 6 in one turn) fires multiple control_requests within
          // the same JS tick; single-slot setState used to drop all but
          // the last, leaving claude stuck waiting for control_response
          // on the dropped ones forever.
          setPendingPermissions(prev => [...prev, {
            requestId,
            toolName: req.tool_name,
            displayName: req.display_name,
            input: req.input || {},
            suggestions: req.permission_suggestions
          }])
        }
        return
      }
      // result event: classify any error. Only auth_expired (rejected/
      // expired OAuth credential — 401, "Not logged in", "Failed to
      // authenticate") pops the global sign-in panel, because re-login
      // actually fixes it. region_blocked / generic errors do NOT pop it
      // (re-auth won't help) — they're surfaced inline by ResultSummaryCard
      // with the real message. This replaces the old detection that only
      // matched error==='authentication_failed' / "Not logged in" and so
      // silently missed the 401 shape, leaving users stuck on a cryptic
      // "stopped: stop_sequence".
      if (ev.type === 'result') {
        const e = ev as any
        const classified = classifyResultError({
          is_error: e.is_error,
          api_error_status: e.api_error_status,
          error: e.error,
          result: e.result
        })
        if (classified?.kind === 'auth_expired') {
          setAuthState('needed')
          setAuthOutput('')
          setAuthError(null)
        }
      }
      // stream_event / system.init / system.status / rate_limit_event are
      // intentionally suppressed — they're protocol housekeeping, not content.
    })
    const offErr = window.api.chat.onStderr(id, (line: string) => {
      // Append as a one-time system timeline entry — scrolls away with
      // conversation rather than lurking above the input forever.
      const text = line.replace(/\s+$/, '')
      if (text) addEntry({ kind: 'system', text })
      // Detect compact lifecycle so the input/permission UI can switch
      // into "paused" mode without us threading a new IPC channel. The
      // exact phrases are stable (see main/chat.ts compactSession +
      // forceCompact branch + runCompactViaPrint progress callback) so
      // this is a cheap, no-new-IPC contract.
      if (
        text.includes('Compacting context — pausing chat') ||
        text.includes('Compacting prior session before resume')
      ) {
        setCompactStartedAt(Date.now())
        // The pre-compact --print child is being killed; any
        // outstanding control_request is now an orphan. Clearing
        // here means the Allow/Deny modal disappears as soon as
        // the user sees the "Compacting…" banner instead of
        // looking clickable but secretly no-op'ing.
        setPendingPermissions([])
        setPendingQuestion(null)
      } else if (
        text.includes('/compact done') ||
        (text.includes('/compact ') && text.includes('context UNCHANGED'))
      ) {
        // Either success or failure path emits a settle line; both
        // mean the child is being respawned so the input is usable
        // again.
        setCompactStartedAt(null)
        setCompactStuck(null)
        // v2.5.3: on compact SUCCESS, reset ctx% immediately so the
        // top bar reflects the just-compacted state without waiting
        // for the user to type a new message. Prior behavior: bar
        // stayed pegged at pre-compact % until the next assistant
        // event landed (which needs user input first — 68% → typed
        // "hi" → suddenly 8% = confusing UX user complained about).
        // Failure path (context UNCHANGED) also resets — the old
        // number is stale either way; better to show 0% than lie.
        // Real value refreshes on the next assistant.usage event.
        if (text.includes('/compact done')) {
          setLatestInputTokens(0)
        }
      }
    })
    const offExit = window.api.chat.onExit(id, (code: number) => {
      // claude --print exited → any pending control_request is orphaned
      // (claude is gone, no one will receive control_response we'd send).
      // Clear queues so the UI doesn't show stale permission/question
      // prompts that look clickable but silently no-op. The Pink stuck
      // incident (16 control_requests, 15 replies, last AskUserQuestion
      // hanging) — claude had died, AskUserQuestionInline was still
      // shown with ctx live, user clicked but reply went nowhere.
      setExited(code)
      setPendingPermissions([])
      setPendingQuestion(null)
      // Child is dead — any stuck-compact banner is meaningless now.
      setCompactStuck(null)
      // Also clear the compact-in-progress gate so the next session
      // (started from the chooser) doesn't open with a disabled Send.
      // pendingDraft is intentionally NOT cleared here: if the user
      // typed something before claude died, we still want to surface
      // it on the next session — but the auto-send useEffect below
      // only fires when compactInProgress transitions true→false
      // AND a fresh session is alive, so this is a no-op until the
      // child respawns.
      setCompactStartedAt(null)
    })
    // MERGE rather than replace: chat.ts:622 broadcasts `{ ...(cc||{}), ...(pct||{}) }`
    // and can fire with cc-only when /usage TUI scrape (queryUsagePctViaPty) returns
    // null. A wholesale replace wiped fiveHour/sevenDay every time → bar showed `—`
    // for ~30s after every refresh, longer if the next scrape also failed. See
    // usage-state.ts for the contract + tests.
    const offUsage = window.api.chat.onUsage(id, (u) => {
      setUsage(prev => mergeUsage(prev, u as any))
    })
    // Stuck-compact watchdog fires once when /compact has been alive
    // > 5min AND silent > 60s. We surface a Cancel button below the
    // input. See main/chat.ts → runCompactViaPrint.
    const offCompactStuck = window.api.chat.onCompactStuck(id, (payload) => {
      setCompactStuck(payload)
    })

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

    // Listeners are now armed — safe to spawn the backend session. The
    // user's choice from the StartChooser arrived via pendingStartRef.
    if (pendingStartRef.current) {
      window.api.chat.start(id, pendingStartRef.current)
      pendingStartRef.current = null
    }

    return () => {
      streamCoalescer.cancel()
      offEv()
      offErr()
      offExit()
      offUsage()
      offPrepend()
      offRcOutput()
      offRcExit()
      offAutoContinue()
      offCompactStuck()
      window.api.chat.stop(id)
    }
    // agentName is DELIBERATELY excluded from deps: it's a display-only
    // label (used as claude's `-n` flag on first spawn, captured fresh at
    // each handler call via closure), and re-running this effect on name
    // change would (a) run cleanup → `chat.stop(id)`, killing the live
    // --print subprocess mid-turn, (b) fire `chat:exit`, which trips the
    // auto-open-chooser useEffect and flips `chooserMode` back to true.
    // Net effect: user types a character in the "edit agent name" field
    // → chat disappears, StartChooser reappears. Repro: click ✎ Edit,
    // change name, click Terminal tab. Fixed 2026-07-27.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, agent, continueSession, rebaseOnStart, chooserMode])

  // Auto-scroll only when the user is already at the bottom. If
  // they've scrolled up to read older content, new live events don't
  // yank them down — the floating ↓ button is how they get back.
  const [isAtBottom, setIsAtBottom] = useState(true)
  // `hasOverflow` separately tracks "is there even anything to scroll
  // through". Used to gate the floating ↓ button visibility — without
  // this, the button only ever appears once the user actively scrolls,
  // which on long sessions where the auto-scroll keeps pinning bottom
  // means the button effectively never shows. With this flag the
  // button shows whenever the conversation has grown beyond the
  // viewport, regardless of current scroll position. Click is no-op
  // if already at bottom — harmless.
  const [hasOverflow, setHasOverflow] = useState(false)
  const SCROLL_BOTTOM_TOLERANCE_PX = 60
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isAtBottom) el.scrollTop = el.scrollHeight
    setHasOverflow(el.scrollHeight - el.clientHeight > SCROLL_BOTTOM_TOLERANCE_PX)
  }, [timeline.length, isAtBottom])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
      setIsAtBottom(distFromBottom <= SCROLL_BOTTOM_TOLERANCE_PX)
      setHasOverflow(el.scrollHeight - el.clientHeight > SCROLL_BOTTOM_TOLERANCE_PX)
    }
    el.addEventListener('scroll', update, { passive: true })
    // Resize observer in case viewport changes (window resize, side
    // panel toggles) and content overflow flips.
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setIsAtBottom(true)
  }

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

  // Listen for App.tsx's refresh button — `hive:reopen-chooser` event
  // flips this panel back to StartChooser so the user can pick Resume /
  // Compact+Resume / Start new / Fork. Without this listener, the old
  // behavior was an unconditional `chat.compact()` that surfaced
  // "Compact failed: no_session" after close-session.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined
      // agentId matches our `id` modulo the `chat-` prefix used elsewhere
      // (App.tsx uses `chat-${agentId}` for IPC namespacing but the
      // detail.agentId is the bare id; HiveChat's `id` is `chat-<agentId>`).
      if (!detail?.agentId) return
      if (id !== `chat-${detail.agentId}` && id !== detail.agentId) return
      setExited(null)
      setPendingPermissions([])
      setPendingQuestion(null)
      setAuthState('idle')
      setChooserMode(true)
    }
    window.addEventListener('hive:reopen-chooser', handler)
    return () => window.removeEventListener('hive:reopen-chooser', handler)
  }, [id])

  // Auto-open chooser whenever the session exits — user shouldn't have
  // to hunt for the abbreviated 3-button close panel; they get the full
  // 4-way picker (Resume / Compact+Resume / Start new / Fork) with the
  // session list right away. Also covers the "session gone + user keeps
  // typing" case: input box is hidden when chooser is up, so any next
  // user action goes through the picker. Triggers on any non-null exit
  // (user close, OOM kill, claude crash) — recovery flow is identical.
  useEffect(() => {
    if (exited !== null && !chooserMode) {
      setChooserMode(true)
    }
  }, [exited, chooserMode])

  // Snap the textarea back to 1-line height after sending. Pairs with
  // the auto-grow handler in onChange — value going to '' doesn't fire
  // onChange so we must reset the inline height ourselves.
  const resetInputHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = '20px'
  }
  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    // Compact is mid-flight — claude --print is dead and the next child
    // hasn't spawned yet. Sending now would silently drop the message
    // (or worse, fire it at a stale stdin and the user sees nothing
    // happen). Stash the draft so the auto-send useEffect picks it
    // up when ✅/❌ /compact arrives.
    if (compactInProgress) {
      setPendingDraft(text)
      setInput(''); resetInputHeight()
      return
    }
    // Intercept session-scoped slash commands that don't work in --print
    // mode (each handler takes over; no stream-json frame goes out).
    if (text === '/remote-control') {
      setInput(''); resetInputHeight()
      addEntry({ kind: 'system', text: 'Starting remote control…' })
      setRcOutput('')
      const res = await window.api.chat.startRemoteControl(id)
      if (res.ok) setRcState('active')
      else addEntry({ kind: 'system', text: `Remote control failed: ${res.error}` })
      return
    }
    if (text === '/compact') {
      setInput(''); resetInputHeight()
      await runCompact()  // shares the re-entry guard with the Compact buttons
      return
    }
    setSending(true)
    addEntry({ kind: 'user', text })
    setInput(''); resetInputHeight()
    // Surface a failed send instead of silently swallowing it. After a
    // Resume, replaySessionHistory shows the conversation from the local
    // JSONL even when the live `claude --print --resume` child died (auth
    // / "No conversation found" / instant exit). sendUserMessage then
    // returns {ok:false, error:'no_session'|'not_in_print_mode'} and the
    // user previously saw NOTHING after typing — this is the "Resume
    // loaded the conversation but sending got no response" bug. Show the
    // error and re-open the StartChooser so they can relaunch. (v1.7.137)
    const res = await window.api.chat.send(id, text)
    if (!res?.ok) {
      addEntry({
        kind: 'system',
        text: `⚠️ Message not sent (${res?.error ?? 'unknown error'}). The session is no longer running — pick Resume or Start new below to relaunch.`
      })
      setChooserMode(true)
    }
    setSending(false)
  }

  // When /compact settles AND a draft was queued, flush it to the
  // freshly-respawned --print child. We wait one tick so React has
  // already cleared compactStartedAt before we re-enter send(); without
  // the timeout, send() would still see compactInProgress=true and
  // re-stash the same draft into pendingDraft.
  useEffect(() => {
    if (!compactInProgress && pendingDraft !== null && exited === null) {
      const draft = pendingDraft
      setPendingDraft(null)
      addEntry({ kind: 'system', text: '✓ Sent queued draft' })
      setSending(true)
      addEntry({ kind: 'user', text: draft })
      window.api.chat.send(id, draft).finally(() => setSending(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactInProgress])

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

  const startAuthLogin = async () => {
    setAuthState('in-progress')
    setAuthOutput('')
    setAuthError(null)
    // Subscribe to streaming output (auth URL etc.) BEFORE invoking, so
    // we never miss the first stdout chunk.
    const off = window.api.auth.onOutput((p) => {
      setAuthOutput(prev => prev + p.text)
    })
    try {
      const r = await window.api.auth.login()
      if (r.ok) setAuthState('success')
      else { setAuthState('failed'); setAuthError(r.error || `exit ${r.code}`) }
    } catch (err: any) {
      // TS strict mode catch param defaults to `unknown`; widen to `any`
      // for the common Error case so .message is readable.
      setAuthState('failed')
      setAuthError(err?.message || String(err))
    } finally {
      off()
    }
  }

  // Always-available escape hatch out of the sign-in modal. The critical case
  // is 'in-progress': `claude auth login` can hang forever (browser closed, or
  // a region block that re-login can't fix), so we SIGTERM the child via
  // auth:cancel before dropping back to idle. Other states just close.
  const dismissAuthModal = () => {
    const action = dismissActionForAuthState(authState)
    if (!action) return
    // Best-effort kill: we always close the modal regardless of the result, so
    // a failed/no-op cancel can't re-trap the user. (Gate 12: fire-and-forget
    // is intentional here — there is no recovery action on cancel failure.)
    if (action.killProcess) window.api.auth.cancel().catch(() => {})
    setAuthState('idle')
    setAuthOutput('')
    setAuthError(null)
  }

  // Esc closes the sign-in modal from ANY non-idle state — a hard guarantee
  // the user is never trapped, even if a future state forgets its button.
  useEffect(() => {
    if (authState === 'idle') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissAuthModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState])

  const startNewSession = async () => {
    // Fresh session with the same agent — no -c, no --resume. System/init
    // will emit a new session_id; timeline is preserved and a divider is
    // added to make the boundary visible. Model has NO memory of the
    // closed session — context cleared.
    addEntry({ kind: 'system', text: '── new session (context cleared) ──' })
    setExited(null)
    setSessionId('')
    setRateLimit5h(null); setRateLimit7d(null)
    // Preserve account-level subscription %% across the reset — they're
    // account-scoped (not session-scoped), so dropping them only causes the
    // bar to briefly show `—` while the new session's startup refresh runs.
    setUsage(preserveAccountUsage)
    setThinking(null)
    setPendingPermissions([])
    setPendingQuestion(null)
    setHasOlderOnDisk(false)
    setTrimmedCount(0)
    setLatestInputTokens(0)
    await window.api.chat.start(id, {
      cwd, agent, name: agentName,
      continueSession: false,
      rebaseOnStart: false
    })
  }

  // Single guarded entry point for BOTH Compact buttons (ActionToolbar +
  // CtxNagBanner) and the /compact slash command. Re-entrant calls are
  // dropped so the button can't fire multiple concurrent /compact runs.
  const runCompact = async () => {
    if (compactBusyRef.current || compactInProgress) return
    compactBusyRef.current = true
    setCompactBusy(true)
    addEntry({ kind: 'system', text: '⏳ Compacting context — running /compact (up to 10 min)…' })
    try {
      const res = await window.api.chat.compact(id)
      addEntry({ kind: 'system', text: res.ok ? '✓ Context compacted, session resumed' : `Compact failed: ${res.error}` })
    } catch (e) {
      addEntry({ kind: 'system', text: `Compact failed: ${String(e)}` })
    } finally {
      compactBusyRef.current = false
      setCompactBusy(false)
    }
  }

  const resumeClosedSession = async () => {
    // Smart resume: backend reads the session JSONL, if prior context
    // > 50% of model window it /compact's first, then re-spawns
    // --print --resume <sid>. Otherwise just plain resume.
    addEntry({ kind: 'system', text: '── resuming session ──' })
    setExited(null)
    setRateLimit5h(null); setRateLimit7d(null)
    // See note above: keep account-level %% so the post-resume refresh can
    // overlay fresh numbers without a transient `—` flicker.
    setUsage(preserveAccountUsage)
    setThinking(null)
    setPendingPermissions([])
    setPendingQuestion(null)
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
    setRateLimit5h(null); setRateLimit7d(null)
    // See note above: keep account-level %% across the fork-with-summary reset.
    setUsage(preserveAccountUsage)
    setThinking(null)
    setPendingPermissions([])
    setPendingQuestion(null)
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
    <HiveChatPausedContext.Provider value={!visible}>
    <SignInContext.Provider value={startAuthLogin}>
    <AskUserQuestionContext.Provider value={pendingQuestion ? {
      requestId: pendingQuestion.requestId,
      submit: (answers) => {
        // Reply via the same control_request channel claude is blocked on.
        // updatedInput shape: keep the original `questions` array AND add
        // an `answers` map (question text → selected label[s]). claude SDK
        // keys answers[T] where T = question.question (verified from binary
        // strings). Using `q.header` silently produced "(no option selected)"
        // in claude's tool_result.
        window.api.chat.respondPermission(
          id,
          pendingQuestion.requestId,
          'allow',
          { questions: pendingQuestion.questions, answers },
          undefined
        )
      }
    } : null}>
    <HiveChatErrorBoundary>
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
      {chooserMode ? (
        <StartChooser
          cwd={cwd}
          loaded={prevInfoLoaded}
          info={prevInfo}
          onPick={launchSession}
          active={visible}
        />
      ) : (<>
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
            {(() => {
              // Empty-timeline placeholder reflects the StartChooser mode
              // the user actually picked, not the agent-level
              // continueSession pref. Without this, "Start new" displayed
              // "Resuming most recent session…" because the prop default
              // was true at agent level.
              const m = launchedMode
              if (m === 'new') return 'New chat. Type below to begin.'
              if (m === 'compact-resume') return `Compacting + resuming session in ${redact(shortenPath(cwd))}…`
              if (m === 'fork') return `Forking session in ${redact(shortenPath(cwd))}…`
              if (m === 'resume') return `Resuming session in ${redact(shortenPath(cwd))}…`
              // Pre-StartChooser fallback (e.g. RC resume, internal recycle)
              return continueSession
                ? `Resuming most recent session in ${redact(shortenPath(cwd))}…`
                : 'New chat. Type below to begin.'
            })()}
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

      {/* Context-pressure nag banner — fires at 80% (warn) and 90%
         (urgent). Sits ABOVE subagent / rate-limit so it's first
         thing the user sees. Each tier is independently dismissable;
         dismissals reset when ctx drops ≥30% (= a /compact ran). */}
      <CtxNagBanner
        contextSize={contextSize}
        usedTokens={latestInputTokens}
        dismissed={ctxNagDismissed}
        onDismissWarn={() => setCtxNagDismissed(prev => ({ ...prev, warn: true }))}
        onDismissUrgent={() => setCtxNagDismissed(prev => ({ ...prev, urgent: true }))}
        onCompact={runCompact}
      />
      {/* Handoff banner — sticky above subagent + rate-limit strips; only
         renders while this agent has an active handoff run. */}
      {handoffAgentId && <HandoffBanner agentId={handoffAgentId} onRequestNewGoal={() => setHandoffModalOpen(true)} />}
      {/* Subagent active banner — sticky above rate-limit, only when
         at least one Task tool is running. Spinner + per-subagent line. */}
      {Object.keys(activeSubagents).length > 0 && (
        <SubagentBanner subs={activeSubagents} />
      )}
      {/* Stuck-compact watchdog banner. Visible only when main has
         emitted chat:compactStuck (>5min elapsed + >60s of silence).
         Cancel hard-stops the child + clears pending queues so the
         user isn't wedged with no escape (Pink-1050s incident). */}
      {compactStuck && exited === null && (
        <div
          data-testid="compact-stuck-banner"
          style={{
            borderBottom: `1px solid ${CRUSH.Charcoal}`,
            background: 'rgba(235,66,104,0.06)',
            padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: 12
          }}
        >
          <div style={{ flex: 1, color: CRUSH.Sriracha, fontSize: 12, fontFamily: FONT_MONO }}>
            <strong style={{ fontWeight: 700 }}>/compact appears stuck</strong>
            <span style={{ color: CRUSH.Squid, marginLeft: 8 }}>
              {Math.round(compactStuck.elapsedMs / 1000)}s elapsed · {Math.round(compactStuck.lastOutputAgeMs / 1000)}s since last output
            </span>
          </div>
          <button
            data-testid="compact-stuck-cancel"
            onClick={async () => {
              // Hard-stop the chat — backend stopChat kills the --print
              // child and fires chat:exit, which clears pendingPermissions
              // and pendingQuestion via offExit. Also clear them
              // synchronously here in case exit is delayed.
              setCompactStuck(null)
              setCompactStartedAt(null)
              setPendingPermissions([])
              setPendingQuestion(null)
              // User explicitly bailed → drop any draft they queued
              // while waiting. We do NOT auto-send a draft after a
              // cancel-then-restart; that would be surprising.
              setPendingDraft(null)
              await window.api.chat.stop(id).catch(() => {})
            }}
            style={{
              background: CRUSH.Sriracha, border: 'none', color: CRUSH.Pepper,
              padding: '6px 14px', borderRadius: 6,
              fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
              cursor: 'pointer'
            }}
          >Cancel</button>
        </div>
      )}
      {/* Rate-limit + Compact + kebab live in a single ActionToolbar row
         below — see line ~1264. RateLimitBar is no longer rendered as a
         standalone strip; the merge cuts ~22px of wasted vertical space. */}

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
                title="Re-spawn claude with --resume <sid>; auto /compact if prior turn used > 50% context"
                style={{
                  flex: 1,
                  background: CRUSH.Bok,
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 8px',
                  color: CRUSH.Pepper,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap' as const
                }}
              >↻ Resume</button>
              <button
                onClick={startSessionWithSummary}
                title="/compact + --resume <sid> --fork-session: new session-id, summary preserved"
                style={{
                  flex: 1,
                  background: CRUSH.Charple,
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 8px',
                  color: CRUSH.Butter,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
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
            {onCloseTerminal && (
              <div style={{ marginTop: 6 }}>
                <button
                  onClick={onCloseTerminal}
                  title="Close this agent panel and return to the fleet view"
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: `1px solid ${CRUSH.Charcoal}`,
                    borderRadius: 6,
                    padding: '6px 8px',
                    color: CRUSH.Squid,
                    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >← Back to Fleet</button>
              </div>
            )}
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
          padding: 8,
          position: 'relative' as const
        }}>
          {/* Show whenever the chat has overflowed the viewport at any
             point. Hidden only when the entire conversation fits in
             one screen — there's literally nothing to scroll to. */}
          {hasOverflow && (
            <button
              onClick={scrollToBottom}
              title={isAtBottom ? 'Already at latest' : 'Scroll to latest'}
              style={{
                position: 'absolute' as const,
                right: 16,
                top: -42,
                width: 32, height: 32,
                borderRadius: '50%',
                background: isAtBottom ? CRUSH.Charcoal : CRUSH.Charple,
                border: 'none',
                color: isAtBottom ? CRUSH.Squid : CRUSH.Butter,
                cursor: isAtBottom ? 'default' : 'pointer',
                fontSize: 16, fontWeight: 700,
                opacity: isAtBottom ? 0.55 : 1,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 5,
                transition: 'all 150ms'
              }}
              onMouseEnter={e => { if (!isAtBottom) e.currentTarget.style.background = CRUSH.Violet }}
              onMouseLeave={e => { e.currentTarget.style.background = isAtBottom ? CRUSH.Charcoal : CRUSH.Charple }}
            >↓</button>
          )}
          <ActionToolbar
            usedTokens={latestInputTokens}
            contextSize={contextSize}
            rateLimit5h={rateLimit5h}
            rateLimit7d={rateLimit7d}
            autoContinueAt={autoContinueAt}
            onCancelAutoContinue={() => window.api.chat.cancelAutoContinue(id)}
            modelKnown={!!modelName}
            onViewContext={openContextModal}
            compacting={compactBusy || compactInProgress}
            onCompact={runCompact}
            onFork={async () => {
              // Surface IPC failure so the user sees what happened. The
              // bare `() => api.chat.startWithSummary(id)` was a silent
              // fire-and-forget: backend `{ok:false, error}` returns were
              // dropped, leaving the user staring at an unchanged panel
              // with no clue why nothing happened (e.g. spawn ENOENT after
              // claude symlink broke). pr-review skill Gate 12 enforces.
              const res = await window.api.chat.startWithSummary(id).catch(e => ({ ok: false as const, error: String(e) }))
              if (!('ok' in res) || !res.ok) {
                const err = (res as any).error || 'unknown'
                addEntry({ kind: 'system', text: `Fork failed: ${err}` })
              }
            }}
            onResume={async () => {
              const res = await window.api.chat.resumeSmart(id).catch(e => ({ ok: false as const, error: String(e) }))
              if (!('ok' in res) || !res.ok) {
                const err = (res as any).error || 'unknown'
                addEntry({ kind: 'system', text: `Resume failed: ${err}` })
              }
            }}
            onNewSession={startNewSession}
            onRemoteControl={async () => {
              const res = await window.api.chat.startRemoteControl(id)
              if (res.ok) setRcState('active')
              else addEntry({ kind: 'system', text: `Remote control failed: ${res.error}` })
            }}
            onClose={() => setCloseConfirming(true)}
            onHandoff={() => setHandoffModalOpen(true)}
            sessionActive={exited === null && !!sessionId}
          />
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
              onChange={e => {
                setInput(e.target.value)
                // Auto-grow up to 2 lines (~40px); beyond that, fix height
                // and let overflow-y handle scrolling. Reset to 'auto'
                // first so shrinking back to 1 line works on delete.
                const ta = e.currentTarget
                ta.style.height = 'auto'
                ta.style.height = Math.min(ta.scrollHeight, 40) + 'px'
              }}
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
              // Stay enabled during compact: user can keep composing.
              // send() itself routes the text into pendingDraft instead
              // of firing at the dead --print child.
              disabled={sending || exited !== null}
              data-testid="hive-chat-input"
              placeholder={
                compactInProgress
                  ? `Compacting — message will send after summary is ready${
                      compactStartedAt
                        ? ` (${Math.round((Date.now() - compactStartedAt) / 1000)}s)`
                        : ''
                    }`
                  : isHandoffActive
                    ? '⚠ Handoff active — your message will feed the /goal loop, NOT stop it. To stop, press Stop in the banner above.'
                    : 'Message Claude… (Enter to send, Shift+Enter for newline)'
              }
              style={{
                flex: 1, resize: 'none',
                background: 'transparent', color: CRUSH.Butter,
                border: 'none', outline: 'none',
                fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.4,
                height: 20,        // 1 line default
                maxHeight: 40,     // 2 lines cap; overflow scrolls past
                overflowY: 'auto',
                padding: 0
              }}
              rows={1}
            />
            {/* Stop button — appears at the right of the input while
                claude is generating (sending or thinking). Sends a
                control_request {subtype:"interrupt"} on stdin which
                cancels the current turn without ending the session.
                Hidden during compact since the --print child is dead;
                we show a disabled Send glyph instead so the user has
                a visual signal that Enter will be queued, not sent. */}
            {!compactInProgress && (sending || thinking) && (
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
            {/* Disabled Send-while-compacting glyph. aria-disabled so
                screen readers announce the gated state; visually a
                muted spinner so the user can see why Enter just
                stashed their text instead of firing. */}
            {compactInProgress && (
              <span
                data-testid="hive-chat-send-disabled"
                role="button"
                aria-disabled={true}
                aria-label="Send disabled — compacting"
                title="Compact running — your draft will auto-send when done"
                style={{
                  flexShrink: 0,
                  background: 'transparent',
                  border: `1px solid ${CRUSH.Squid}`,
                  color: CRUSH.Squid,
                  width: 22, height: 22,
                  borderRadius: 4,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
                  cursor: 'not-allowed',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0.7
                }}
              >⏳</span>
            )}
          </div>
          {/* Inline draft-queued indicator — confirms to the user that
              their Enter while compacting wasn't lost. The auto-send
              useEffect clears pendingDraft when it dispatches, so this
              banner disappears the moment the queued message is sent. */}
          {compactInProgress && pendingDraft !== null && (
            <div
              data-testid="hive-chat-draft-queued"
              style={{
                marginTop: 6,
                padding: '4px 10px',
                background: 'rgba(255,204,51,0.08)',
                border: `1px solid ${CRUSH.Julep}`,
                borderRadius: 6,
                color: CRUSH.Julep,
                fontFamily: FONT_MONO, fontSize: 11
              }}
            >
              Draft saved — will send after compact completes
            </div>
          )}
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

      {/* Permission modal — wrapped in ErrorBoundary so a schema change
          in claude's `permission_suggestions` payload (or any other
          unforeseen render error) can't black-screen the chat. The
          fallback is a minimal Allow/Deny prompt rendered straight
          from primitive divs/buttons; it ignores suggestions entirely. */}
      {pendingPermission && (
        <PermissionErrorBoundary
          fallback={
            <PermissionFallback
              req={pendingPermission}
              onDecide={(decision) => {
                window.api.chat.respondPermission(
                  id,
                  pendingPermission.requestId,
                  decision,
                  decision === 'allow' ? pendingPermission.input : undefined,
                  decision === 'deny' ? 'Denied by user' : undefined
                )
                // Shift this answered request off the head; next queued
                // request (if any) auto-renders. Don't clear whole queue.
                setPendingPermissions(prev => prev.slice(1))
              }}
            />
          }
        >
        <PermissionModal
          req={pendingPermission}
          peerCount={pendingPermissions.filter((p, i) => i > 0 && p.toolName === pendingPermission.toolName).length}
          onDecide={async (decision, saveSuggestion) => {
            if (saveSuggestion) {
              // Pass the WHOLE suggestion to the IPC. claude's new
              // schema (2.1.123+) sends `{type:'addDirectories', ...}`
              // or `{type:'setMode', ...}` instead of the old `rules`
              // array. Backend translates each shape into the right
              // ~/.claude/settings.json field. Without this the click
              // silently no-op'd and user kept being re-prompted for
              // the same file forever.
              await window.api.settings.addClaudeAllowRule(saveSuggestion as any).catch(() => {})
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
            // Shift this answered request off the head; next queued
            // request (if any) auto-renders.
            setPendingPermissions(prev => prev.slice(1))
          }}
          onAllowSession={async () => {
            // Two-part effect for the "batch problem" (N parallel MCP
            // calls emitted in one assistant turn):
            //  1. Tell main to auto-approve future control_requests for
            //     this tool this session (session-permissions.ts).
            //  2. Also respond `allow` to any peers ALREADY sitting in
            //     the pending queue with the same toolName — those
            //     arrived before the allowlist entry existed, so main
            //     already broadcast them.
            const toolName = pendingPermission.toolName
            await window.api.chat.allowToolForSession(id, toolName).catch(() => {})
            const peers = pendingPermissions.filter(p => p.toolName === toolName)
            for (const p of peers) {
              window.api.chat.respondPermission(id, p.requestId, 'allow', p.input)
            }
            setPendingPermissions(prev => prev.filter(p => p.toolName !== toolName))
          }}
        />
        </PermissionErrorBoundary>
      )}
      </>)}
      {contextModal.open && (
        <ContextModal
          loading={contextModal.loading}
          error={contextModal.error}
          data={contextModal.data}
          claudeSid={sessionId}
          onRefresh={() => triggerContextScrape(true)}
          onClose={() => setContextModal(prev => ({ ...prev, open: false }))}
        />
      )}
      {authState !== 'idle' && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15,10,26,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, fontFamily: FONT_MONO
        }}>
          <div style={{
            background: CRUSH.BBQ,
            border: `1px solid ${authState === 'failed' ? CRUSH.Sriracha : CRUSH.Bok}`,
            borderRadius: 10, padding: '18px 22px 16px',
            width: 520, maxWidth: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <div style={{
              color: authState === 'failed' ? CRUSH.Sriracha : CRUSH.Bok,
              fontWeight: 700, fontSize: 12, textTransform: 'uppercase' as const,
              letterSpacing: '0.08em', marginBottom: 10
            }}>
              {authState === 'needed' && '🔒 Sign in to Claude'}
              {authState === 'in-progress' && '⏳ Signing in…'}
              {authState === 'success' && '✓ Signed in'}
              {authState === 'failed' && '✕ Sign-in failed'}
            </div>
            {authState === 'needed' && (
              <div style={{ color: CRUSH.Ash, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
                Claude Code needs to authenticate before it can chat. This opens a browser
                to anthropic.com for your subscription login — no API key required.
              </div>
            )}
            {(authState === 'in-progress' || authState === 'failed') && (
              <div style={{
                color: CRUSH.Ash, background: CRUSH.Pepper,
                border: `1px solid ${CRUSH.Charcoal}`, borderRadius: 4,
                padding: '8px 12px', fontSize: 11, marginBottom: 12,
                fontFamily: FONT_MONO, whiteSpace: 'pre-wrap',
                maxHeight: 220, overflowY: 'auto', wordBreak: 'break-all'
              }}>{authOutput || (authState === 'in-progress' ? 'Waiting for claude auth login…' : '(no output)')}</div>
            )}
            {authState === 'failed' && authError && (
              <div style={{ color: CRUSH.Sriracha, fontSize: 12, marginBottom: 12 }}>{authError}</div>
            )}
            {authState === 'success' && (
              <div style={{ color: CRUSH.Ash, fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
                You're signed in. Click <strong style={{ color: CRUSH.Bok }}>Resume</strong> on
                the session below to retry, or close this dialog.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {authState === 'needed' && (
                <>
                  <button onClick={() => setAuthState('idle')} style={{
                    background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
                    color: CRUSH.Squid, padding: '8px 14px', borderRadius: 6,
                    fontFamily: FONT_MONO, fontSize: 12, cursor: 'pointer'
                  }}>Not now</button>
                  <button onClick={startAuthLogin} style={{
                    background: CRUSH.Bok, border: 'none',
                    color: CRUSH.Pepper, padding: '8px 18px', borderRadius: 6,
                    fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, cursor: 'pointer'
                  }}>Sign in →</button>
                </>
              )}
              {authState === 'in-progress' && (
                <>
                  <div style={{ color: CRUSH.Squid, fontSize: 11, alignSelf: 'center', marginRight: 'auto' }}>
                    Browser should open automatically. Complete auth there.
                  </div>
                  <button onClick={dismissAuthModal} style={{
                    background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
                    color: CRUSH.Squid, padding: '8px 14px', borderRadius: 6,
                    fontFamily: FONT_MONO, fontSize: 12, cursor: 'pointer'
                  }}>Cancel</button>
                </>
              )}
              {authState === 'failed' && (
                <>
                  <button onClick={() => setAuthState('idle')} style={{
                    background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
                    color: CRUSH.Squid, padding: '8px 14px', borderRadius: 6,
                    fontFamily: FONT_MONO, fontSize: 12, cursor: 'pointer'
                  }}>Close</button>
                  <button onClick={startAuthLogin} style={{
                    background: CRUSH.Bok, border: 'none',
                    color: CRUSH.Pepper, padding: '8px 18px', borderRadius: 6,
                    fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, cursor: 'pointer'
                  }}>Retry</button>
                </>
              )}
              {authState === 'success' && (
                <button onClick={() => setAuthState('idle')} style={{
                  background: CRUSH.Bok, border: 'none',
                  color: CRUSH.Pepper, padding: '8px 18px', borderRadius: 6,
                  fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, cursor: 'pointer'
                }}>Done</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    {handoffAgentId && (
      <HandoffModal
        open={handoffModalOpen}
        chatId={id}
        agentName={agentName || handoffAgentId}
        onCancel={() => setHandoffModalOpen(false)}
        onStarted={() => setHandoffModalOpen(false)}
      />
    )}
    </HiveChatErrorBoundary>
    </AskUserQuestionContext.Provider>
    </SignInContext.Provider>
    </HiveChatPausedContext.Provider>
  )
}

/**
 * Wrap PermissionModal so a render throw can't unmount HiveChat (which
 * is what black-screens the chat surface). Caught errors fall back to
 * a minimal allow/deny prompt that uses zero schema-specific access.
 *
 * Why a class component: React's getDerivedStateFromError/componentDidCatch
 * only exists on class components. There's no hook equivalent yet.
 */
/**
 * Outer boundary for the HiveChat component itself. Without this, any
 * render throw inside the chat surface — a corrupt timeline entry, a
 * tool-result with an unexpected shape, a modal that references a
 * missing prop — black-screens the whole panel with no clue why.
 * Catches the throw, ships {message, stack, componentStack} to main
 * via window.api.crash.report (lands in ~/.hive/crash-log.jsonl), and
 * shows a minimal recovery card with a copy-stack button + reload.
 */
class HiveChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; err?: Error; info?: React.ErrorInfo }
> {
  constructor(props: any) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err } }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    this.setState({ info })
    try {
      window.api.crash.report('renderer-hive-chat-throw', {
        message: err.message,
        stack: err.stack,
        componentStack: info.componentStack
      }).catch(() => {})
    } catch {}
    // eslint-disable-next-line no-console
    console.error('[HiveChat] render threw:', err, info)
  }
  render() {
    if (!this.state.hasError) return this.props.children
    const stack = `${this.state.err?.message}\n${this.state.err?.stack}\n--- component ---\n${this.state.info?.componentStack || ''}`
    return (
      <div style={{
        width: '100%', height: '100%', background: '#150e24',
        color: CRUSH.Ash, fontFamily: FONT_MONO, fontSize: 13,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, gap: 12
      }}>
        <div style={{ color: CRUSH.Sriracha, fontWeight: 700, fontSize: 14 }}>
          ✕ HiveChat render failed
        </div>
        <div style={{ color: CRUSH.Squid, fontSize: 12, maxWidth: 600, textAlign: 'center' }}>
          The chat panel hit an exception. A crash report was written to{' '}
          <code style={{ color: CRUSH.Bok }}>~/.hive/crash-log.jsonl</code>.
        </div>
        <pre style={{
          background: CRUSH.Pepper, border: `1px solid ${CRUSH.Charcoal}`,
          padding: 10, borderRadius: 6, fontSize: 11, color: CRUSH.Ash,
          maxWidth: 720, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap'
        }}>{stack}</pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { try { navigator.clipboard.writeText(stack) } catch {} }} style={{
            background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Ash, padding: '8px 14px', borderRadius: 6,
            fontFamily: FONT_MONO, fontSize: 12, cursor: 'pointer'
          }}>Copy stack</button>
          <button onClick={() => window.location.reload()} style={{
            background: CRUSH.Bok, border: 'none',
            color: CRUSH.Pepper, padding: '8px 18px', borderRadius: 6,
            fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, cursor: 'pointer'
          }}>Reload</button>
        </div>
      </div>
    )
  }
}

class PermissionErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean; err?: Error }
> {
  constructor(props: any) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError(err: Error) { return { hasError: true, err } }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[PermissionModal] render threw — falling back to minimal prompt:', err, info)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

/**
 * Last-ditch permission UI rendered when PermissionModal itself throws.
 * Uses only primitive props — no permission_suggestions logic, no
 * input introspection beyond `tool_name`. Goal: claude unsticks even
 * when our pretty modal can't render.
 */
function PermissionFallback({ req, onDecide }: {
  req: { requestId: string; toolName: string }
  onDecide: (d: 'allow' | 'deny') => void
}) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(15,10,26,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, fontFamily: FONT_MONO
    }}>
      <div style={{
        background: CRUSH.BBQ,
        border: `1px solid ${CRUSH.Sriracha}`,
        borderRadius: 8,
        padding: 16,
        width: 400, maxWidth: '80%'
      }}>
        <div style={{ color: CRUSH.Sriracha, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 8 }}>
          Permission required (fallback ui)
        </div>
        <div style={{ color: CRUSH.Ash, fontSize: 13, marginBottom: 4 }}>
          Claude wants to use <strong style={{ color: CRUSH.Charple }}>{String(req.toolName || 'unknown tool')}</strong>
        </div>
        <div style={{ color: CRUSH.Squid, fontSize: 11, marginBottom: 14 }}>
          The pretty modal failed to render — using a minimal prompt so the chat doesn't lock up.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => onDecide('deny')} style={{
            background: 'transparent', color: CRUSH.Sriracha,
            border: `1px solid ${CRUSH.Sriracha}`, borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO, cursor: 'pointer'
          }}>Deny</button>
          <button onClick={() => onDecide('allow')} style={{
            background: CRUSH.Julep, color: CRUSH.Pepper,
            border: 'none', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO, fontWeight: 700, cursor: 'pointer'
          }}>Allow once</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Claude's `permission_suggestions[]` payload. Multiple shapes exist
 * because claude added new types over time without bumping any version
 * — we MUST handle each defensively (and accept unknown future types
 * as plain `Allow & remember` with an opaque label).
 *
 * Old shape (v1 — original, was the only one until ~2026-04):
 *   { type: 'addRule' (or anything), rules: [{toolName, ruleContent}], behavior, destination }
 *
 * New shapes (v2 — observed 2026-04 onwards, broke PermissionModal):
 *   { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
 *   { type: 'addDirectories', directories: ['/Users/x/.claude'], destination: 'session' }
 *
 * NEVER trust `.rules` to exist. NEVER `.map` directly. The 04-29
 * black-screen incident was `req.suggestions[0].rules.map(...)` throwing
 * TypeError → React unmounted HiveChat → user saw a black void. Render
 * MUST be defensive enough that an unknown shape produces a plain button
 * with a generic label, not a crash.
 */
export interface PermissionSuggestion {
  type: string
  rules?: { toolName: string; ruleContent: string }[]
  mode?: string                     // setMode shape
  directories?: string[]            // addDirectories shape
  behavior?: string
  destination?: string
}

/**
 * Convert any suggestion shape to a stable `{ label, hover }` pair for
 * the button. Returns null if we can't make sense of it (caller hides
 * the button instead of rendering broken text).
 */
export function describeSuggestion(s: PermissionSuggestion | null | undefined):
  { label: string; hover: string } | null
{
  if (!s || typeof s !== 'object') return null
  const dest = s.destination || 'session'
  // setMode: claude proposes flipping the whole session into a more
  // permissive mode (e.g. acceptEdits) so future writes don't prompt.
  if (s.type === 'setMode' && typeof s.mode === 'string') {
    return { label: `Allow & switch to ${s.mode}`, hover: `Sets permission mode to "${s.mode}" for this ${dest}` }
  }
  // addDirectories: trust a path so future tool calls inside it skip
  // the permission gate.
  if (s.type === 'addDirectories' && Array.isArray(s.directories) && s.directories.length > 0) {
    const dirs = s.directories.join(', ')
    return { label: `Allow & trust ${s.directories.length === 1 ? s.directories[0] : `${s.directories.length} dirs`}`, hover: `Adds ${dirs} to trusted directories for this ${dest}` }
  }
  // Original shape — explicit toolName/ruleContent rules.
  if (Array.isArray(s.rules) && s.rules.length > 0) {
    const summary = s.rules
      .filter(r => r && typeof r.toolName === 'string')
      .map(r => `${r.toolName}(${r.ruleContent ?? ''})`)
      .join(', ')
    if (summary) return { label: 'Allow & remember', hover: `Adds "${summary}" to ~/.claude/settings.json` }
  }
  // Unknown future shape — keep the action available but with a
  // generic label. Better than hiding silently.
  if (s.type) return { label: `Allow & ${s.type}`, hover: `Applies suggestion type "${s.type}" for this ${dest}` }
  return null
}

export function PermissionModal({ req, peerCount, onDecide, onAllowSession }: {
  req: { requestId: string; toolName: string; displayName?: string; input: Record<string, unknown>; suggestions?: PermissionSuggestion[] }
  /** How many OTHER queued requests share this same toolName. Renders a "+N more" hint on the batch-allow button. */
  peerCount: number
  onDecide: (d: 'allow' | 'deny', saveSuggestion?: PermissionSuggestion) => void
  /** Grants the tool session-wide: adds to main's per-chat allowlist AND drains any peers with the same toolName from the pending queue. */
  onAllowSession: () => void
}) {
  const summary = (() => {
    try {
      const i = req.input || {}
      if (typeof i.command === 'string') return i.command
      if (typeof i.file_path === 'string') return i.file_path
      if (typeof i.path === 'string') return i.path
      if (typeof i.skill === 'string') return `${i.skill}${i.args ? ` ${i.args}` : ''}`
      if (typeof i.url === 'string') return i.url
      if (typeof i.pattern === 'string') return i.pattern
      return JSON.stringify(i)
    } catch { return '' }
  })()
  const suggestion = req.suggestions?.[0]
  const desc = describeSuggestion(suggestion)
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
          <button onClick={onAllowSession} style={{
            background: 'transparent', color: CRUSH.Malibu,
            border: `1px solid ${CRUSH.Malibu}`, borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO, cursor: 'pointer'
          }} title={`Auto-allow every future ${req.displayName || req.toolName} call for this chat session${peerCount > 0 ? ` (and the ${peerCount} more already queued)` : ''}`}>
            Allow this session{peerCount > 0 ? ` (+${peerCount})` : ''}
          </button>
          {desc && suggestion && (
            <button onClick={() => onDecide('allow', suggestion)} style={{
              background: CRUSH.Julep, color: CRUSH.Pepper,
              border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO,
              fontWeight: 700, cursor: 'pointer'
            }} title={desc.hover}>
              {desc.label}
            </button>
          )}
          {/* MCP tools: claude typically sends NO permission_suggestions
             (their inputs are freeform JSON, so no pattern to generalize).
             The above "Allow & remember" button therefore never renders
             for them, and before this button existed the only durable
             option was the session-scoped one — every new chat started
             asking again. This synthesizes a bare-tool-name suggestion
             (`mcp__server__tool_name`, the shape claude 2.1.x actually
             accepts) so onDecide → addClaudeAllowRule writes it into
             ~/.claude/settings.json for every future session/agent/Hive. */}
          {!suggestion && req.toolName.startsWith('mcp__') && (
            <button onClick={() => onDecide('allow', { rules: [{ toolName: req.toolName, ruleContent: '' }] })} style={{
              background: CRUSH.Zest, color: CRUSH.Pepper,
              border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, fontFamily: FONT_MONO,
              fontWeight: 700, cursor: 'pointer'
            }} title={`Persist ${req.toolName} in ~/.claude/settings.json permissions.allow — never asked again across any session or agent`}>
              Allow forever
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * ContextModal — pretty render of `/context` output. Five tabs:
 *   Overview  — proportional grid (40×20) + category legend
 *   MCP Tools — searchable + sticky-header table, top-10 highlighted
 *   Custom Agents / Memory Files / Skills — same table pattern
 *
 * Data comes from `chat:scrapeContext` IPC which kills the live --print,
 * runs `claude --print --resume <sid> /context`, parses the markdown
 * response, then respawns the live --print. Cache is 5 min; hitting
 * Refresh forces a fresh scrape.
 */
type CtxData = {
  model: string
  totalTokens: number
  totalLimit: number
  totalPct: number
  categories: { name: string; tokens: number; pct: number }[]
  mcpTools: { name: string; server?: string; tokens: number }[]
  customAgents: { name: string; tokens: number }[]
  memoryFiles: { name: string; tokens: number }[]
  skills: { name: string; source?: string; tokens: number }[]
  scrapedAtMs: number
}

const CTX_CAT_COLOR: Record<string, string> = {
  'System prompt': '#858392',
  'System tools': '#68FFD6',
  'MCP tools (deferred)': '#00A4FF',
  'System tools (deferred)': '#4FBFA8',
  'Custom agents': '#C259FF',
  'Memory files': '#EB4268',
  'Skills': '#E8FE96',
  'Messages': '#6B50FF',
  'Autocompact buffer': '#EB5DFF',
  'Free space': '#2A2935'
}

/**
 * Extract the model-visible context size in tokens from a Claude
 * `usage` payload. Same math used by:
 *   - live `result` events (debounced setLatestInputTokens on every turn)
 *   - historical replay assistant events (seeds the ctx % bar after
 *     a session resume, BEFORE any new turn fires a result event)
 *
 * Why iterations[-1] not the top level: a single agentic turn can have
 * dozens of tool-use loops; top-level cache_read_input_tokens is the
 * cumulative sum across them all and balloons to multiples of the
 * window. Each `iterations[i]` records that loop's own usage; the LAST
 * loop is what's currently visible to the model. Falls back to top-level
 * if iterations is missing (early claude versions / non-agentic turns).
 */
export function extractCtxTotalFromUsage(usage: any): number {
  if (!usage || typeof usage !== 'object') return 0
  const its = Array.isArray(usage.iterations) ? usage.iterations : []
  const last = its.length > 0 ? its[its.length - 1] : usage
  const inp = typeof last?.input_tokens === 'number' ? last.input_tokens : 0
  const cacheRead = typeof last?.cache_read_input_tokens === 'number' ? last.cache_read_input_tokens : 0
  const cacheCreate = typeof last?.cache_creation_input_tokens === 'number' ? last.cache_creation_input_tokens : 0
  return inp + cacheRead + cacheCreate
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

type CtxTab = 'overview' | 'mcp' | 'agents' | 'memory' | 'skills'

export function ContextModal({ loading, error, data, claudeSid, onRefresh, onClose }: {
  loading: boolean
  error: string | null
  data: CtxData | null
  claudeSid: string
  onRefresh: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<CtxTab>('overview')
  const [filter, setFilter] = useState('')

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset filter when switching tabs
  useEffect(() => { setFilter('') }, [tab])

  const dotColor = error ? CRUSH.Sriracha : loading ? CRUSH.Zest : CRUSH.Charple

  const filterRows = <T extends { name: string; server?: string; source?: string }>(rows: T[]) => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.server || '').toLowerCase().includes(q) ||
      (r.source || '').toLowerCase().includes(q)
    )
  }

  return (
    <div
      style={{
        position: 'absolute' as const, inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 820, maxWidth: '92%', maxHeight: '92%',
        background: CRUSH.BBQ,
        border: `1px solid ${CRUSH.Charple}`,
        borderRadius: 12,
        boxShadow: `0 8px 40px rgba(107,80,255,0.25), 0 4px 12px rgba(0,0,0,0.5)`,
        display: 'flex', flexDirection: 'column' as const,
        overflow: 'hidden'
      }}>
        {/* Head */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px',
          background: CRUSH.Pepper,
          borderBottom: `1px solid ${CRUSH.Charcoal}`,
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Space Grotesk, sans-serif' as any, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: CRUSH.Ash }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, boxShadow: `0 0 10px ${dotColor}` }} />
            Context Usage
            {data && (
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: CRUSH.Squid, fontWeight: 400, marginLeft: 8 }}>
                {data.model.replace(/^claude-/, '').replace(/\[.*\]$/, '')} ·{' '}
                <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>{data.totalPct}%</span> · {fmtTokens(data.totalTokens)} / {fmtTokens(data.totalLimit)}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 11,
            padding: '2px 8px', borderRadius: 4, cursor: 'pointer', lineHeight: 1
          }}>✕</button>
        </div>

        {/* Tabs (only when data loaded) */}
        {data && !loading && !error && (
          <div style={{
            display: 'flex', gap: 0, padding: '0 12px',
            background: CRUSH.Pepper, borderBottom: `1px solid ${CRUSH.Charcoal}`, flexShrink: 0
          }}>
            <CtxTabBtn active={tab==='overview'} onClick={() => setTab('overview')}>Overview</CtxTabBtn>
            <CtxTabBtn active={tab==='mcp'} onClick={() => setTab('mcp')} count={data.mcpTools.length}>MCP Tools</CtxTabBtn>
            <CtxTabBtn active={tab==='agents'} onClick={() => setTab('agents')} count={data.customAgents.length}>Custom Agents</CtxTabBtn>
            <CtxTabBtn active={tab==='memory'} onClick={() => setTab('memory')} count={data.memoryFiles.length}>Memory Files</CtxTabBtn>
            <CtxTabBtn active={tab==='skills'} onClick={() => setTab('skills')} count={data.skills.length}>Skills</CtxTabBtn>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto' as const, padding: '16px 18px', minHeight: 0 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14, padding: '38px 18px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: `3px solid ${CRUSH.Charcoal}`,
                borderTopColor: CRUSH.Charple,
                animation: 'hive-spin 800ms linear infinite'
              }} />
              <style>{`@keyframes hive-spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 12, color: CRUSH.Ash, textAlign: 'center' as const }}>
                Pausing chat for /context scrape
              </div>
              <div style={{ fontSize: 10, color: CRUSH.Squid, textAlign: 'center' as const, fontFamily: 'Space Grotesk, sans-serif' as any, letterSpacing: '0.04em' }}>
                ~7s · session resumes automatically when done
              </div>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14, padding: '38px 18px' }}>
              <div style={{ fontSize: 28, color: CRUSH.Sriracha }}>⚠</div>
              <div style={{ fontSize: 12, color: CRUSH.Ash }}>Failed to scrape /context</div>
              <div style={{ fontSize: 10, color: CRUSH.Sriracha, fontFamily: FONT_MONO }}>{error}</div>
            </div>
          ) : data ? (
            tab === 'overview' ? <CtxOverview data={data} />
            : tab === 'mcp' ? <CtxDetail rows={filterRows(data.mcpTools)} cols={['Tool', 'Server', 'Tokens']} colorDot={CRUSH.Malibu} filter={filter} setFilter={setFilter} totalRows={data.mcpTools.length} totalTokens={data.mcpTools.reduce((s, r) => s + r.tokens, 0)} highlightTopN={10} />
            : tab === 'agents' ? <CtxDetail rows={filterRows(data.customAgents)} cols={['Agent', '', 'Tokens']} colorDot={CRUSH.Violet} filter={filter} setFilter={setFilter} totalRows={data.customAgents.length} totalTokens={data.customAgents.reduce((s, r) => s + r.tokens, 0)} />
            : tab === 'memory' ? <CtxDetail rows={filterRows(data.memoryFiles)} cols={['Path', '', 'Tokens']} colorDot={CRUSH.Sriracha} filter={filter} setFilter={setFilter} totalRows={data.memoryFiles.length} totalTokens={data.memoryFiles.reduce((s, r) => s + r.tokens, 0)} pathify />
            : <CtxDetail rows={filterRows(data.skills)} cols={['Skill', 'Source', 'Tokens']} colorDot={CRUSH.Zest} filter={filter} setFilter={setFilter} totalRows={data.skills.length} totalTokens={data.skills.reduce((s, r) => s + r.tokens, 0)} />
          ) : (
            <div style={{ padding: 32, textAlign: 'center' as const, color: CRUSH.Squid }}>No data</div>
          )}
        </div>

        {/* Foot */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 18px',
          background: CRUSH.Pepper,
          borderTop: `1px solid ${CRUSH.Charcoal}`,
          fontFamily: FONT_MONO, fontSize: 10, color: CRUSH.Squid,
          flexShrink: 0
        }}>
          {data ? (
            <span style={Date.now() - data.scrapedAtMs > 60_000 ? { color: CRUSH.Zest, fontStyle: 'italic' as const } : undefined}>
              {fmtAgo(data.scrapedAtMs)} · session {claudeSid.slice(0, 8)}
            </span>
          ) : <span>session {claudeSid.slice(0, 8)}</span>}
          <span style={{ marginLeft: 'auto' }} />
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
              color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 11,
              padding: '4px 12px', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1
            }}
          >Refresh now (~7s)</button>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(107,80,255,0.12)',
              border: `1px solid ${CRUSH.Charple}`,
              color: CRUSH.Charple,
              fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
              padding: '4px 12px', borderRadius: 4, cursor: 'pointer'
            }}
          >Close</button>
        </div>
      </div>
    </div>
  )
}

function CtxTabBtn({ active, onClick, children, count }: {
  active: boolean; onClick: () => void; children: React.ReactNode; count?: number
}) {
  return (
    <span
      onClick={onClick}
      style={{
        fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
        color: active ? CRUSH.Charple : CRUSH.Squid,
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: `2px solid ${active ? CRUSH.Charple : 'transparent'}`,
        transition: 'all 120ms',
        display: 'inline-flex' as const, alignItems: 'center', gap: 6
      }}
    >
      {children}
      {typeof count === 'number' && (
        <span style={{
          fontSize: 9, fontWeight: 400,
          background: active ? 'rgba(107,80,255,0.18)' : CRUSH.Charcoal,
          color: active ? CRUSH.Charple : CRUSH.Squid,
          padding: '1px 5px', borderRadius: 8
        }}>{count}</span>
      )}
    </span>
  )
}

function CtxOverview({ data }: { data: CtxData }) {
  // 800-cell proportional grid (40×20). One cell = 0.125% of contextWindow.
  const totalCells = 800
  const cells: { color: string; cls?: string }[] = []
  for (const cat of data.categories) {
    const n = Math.round(cat.pct * totalCells / 100)
    const color = CTX_CAT_COLOR[cat.name] || CRUSH.Squid
    for (let i = 0; i < n; i++) cells.push({ color, cls: cat.name === 'Autocompact buffer' ? 'autocompact' : undefined })
  }
  while (cells.length < totalCells) cells.push({ color: CTX_CAT_COLOR['Free space'] })
  cells.length = totalCells

  return (
    <>
      <div style={{
        background: CRUSH.Pepper,
        border: `1px solid ${CRUSH.Charcoal}`,
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 14
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(40, 1fr)', gap: 2 }}>
          {cells.map((c, i) => (
            <div key={i} style={{
              aspectRatio: '1', minHeight: 8,
              background: c.color,
              opacity: c.cls === 'autocompact' ? 0.5 : 1,
              borderRadius: 1
            }} />
          ))}
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 22px',
        fontFamily: FONT_MONO, fontSize: 11
      }}>
        {data.categories.map((c) => {
          const isMessages = c.name === 'Messages'
          return (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: CTX_CAT_COLOR[c.name] || CRUSH.Squid, flexShrink: 0 }} />
              <span style={{
                color: isMessages ? CRUSH.Charple : CRUSH.Ash,
                fontWeight: isMessages ? 600 : 400,
                flex: '1 1 auto', minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const
              }}>{c.name}</span>
              <span style={{ color: CRUSH.Squid }}>{fmtTokens(c.tokens)}</span>
              <span style={{
                color: isMessages ? CRUSH.Charple : CRUSH.Squid,
                fontWeight: isMessages ? 600 : 400,
                minWidth: 36, textAlign: 'right' as const
              }}>{c.pct.toFixed(1)}%</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function CtxDetail({
  rows, cols, colorDot, filter, setFilter, totalRows, totalTokens, highlightTopN, pathify
}: {
  rows: { name: string; server?: string; source?: string; tokens: number }[]
  cols: [string, string, string]
  colorDot: string
  filter: string
  setFilter: (s: string) => void
  totalRows: number
  totalTokens: number
  highlightTopN?: number
  pathify?: boolean
}) {
  const sorted = [...rows].sort((a, b) => b.tokens - a.tokens)
  const topThreshold = highlightTopN && sorted.length > highlightTopN ? sorted[highlightTopN - 1].tokens : -1

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={`filter ${cols[0].toLowerCase()}…`}
          style={{
            flex: '1 1 auto',
            background: CRUSH.Pepper,
            border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Butter,
            fontFamily: FONT_MONO, fontSize: 11,
            padding: '5px 10px', borderRadius: 4, outline: 'none'
          }}
          onFocus={e => { e.currentTarget.style.borderColor = CRUSH.Charple }}
          onBlur={e => { e.currentTarget.style.borderColor = CRUSH.Charcoal }}
        />
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: CRUSH.Squid }}>
          {filter ? `${rows.length} of ` : ''}{totalRows} · {fmtTokens(totalTokens)} tokens
          {highlightTopN ? ` · top ${highlightTopN} highlighted` : ''}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontFamily: FONT_MONO, fontSize: 11 }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} style={{
                textAlign: i === 2 ? 'right' as const : 'left' as const,
                padding: '6px 10px',
                background: CRUSH.Pepper,
                color: CRUSH.Squid,
                fontWeight: 600, fontSize: 10,
                textTransform: 'uppercase' as const, letterSpacing: '0.08em',
                position: 'sticky' as const, top: -16,
                borderBottom: `1px solid ${CRUSH.Charcoal}`
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={3} style={{ padding: 16, textAlign: 'center' as const, color: CRUSH.Squid, fontStyle: 'italic' as const }}>no rows</td></tr>
          ) : sorted.map((r, i) => {
            const top = highlightTopN && r.tokens >= topThreshold && i < highlightTopN
            const displayName = pathify ? r.name.replace(/^\/Users\/[^/]+/, '~') : r.name.replace(/^mcp__[^_]+__/, '')
            return (
              <tr key={i} style={{ background: top ? 'rgba(107,80,255,0.06)' : 'transparent' }}>
                <td style={{ padding: '5px 10px', borderBottom: `1px solid rgba(58,57,67,0.4)`, color: CRUSH.Ash }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colorDot, marginRight: 6, verticalAlign: 'middle' as const }} />
                  {displayName}
                </td>
                <td style={{ padding: '5px 10px', borderBottom: `1px solid rgba(58,57,67,0.4)`, color: CRUSH.Squid, fontSize: 10 }}>
                  {(r.source && (
                    <span style={{ color: r.source === 'Plugin' ? CRUSH.Violet : CRUSH.Squid }}>{r.source}</span>
                  )) || r.server || ''}
                </td>
                <td style={{
                  padding: '5px 10px', borderBottom: `1px solid rgba(58,57,67,0.4)`,
                  textAlign: 'right' as const,
                  color: top ? CRUSH.Charple : CRUSH.Butter,
                  fontWeight: 600, whiteSpace: 'nowrap' as const
                }}>{fmtTokens(r.tokens)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

export type ChooserMode = 'resume' | 'compact-resume' | 'new' | 'fork'

/**
 * Decide what a StartChooser top-level (no picker open) keystroke should do.
 * Returns the mode to launch, or null to let the key fall through untouched.
 *
 * CRITICAL: `active` is false for backgrounded chat panels. HiveChat keeps
 * every agent's panel mounted (visibility toggled via CSS), and StartChooser
 * registers a *global* window keydown listener. Without this guard a
 * backgrounded chooser swallows digit keys from the focused panel's textarea —
 * notably '3' (→ 'new'), the only mode with no `!hasPrev` pass-through — so the
 * user had to press '3' once per lingering background chooser before it would
 * finally type. Inactive panels must ignore ALL keys.
 */
export function chooserKeyMode(
  key: string,
  active: boolean,
  hasPrev: boolean,
  defaultMode: ChooserMode
): ChooserMode | null {
  if (!active) return null
  if (key === 'Enter') return defaultMode
  const orderedModes: ChooserMode[] = ['resume', 'compact-resume', 'new', 'fork']
  const idx = '1234'.indexOf(key)
  if (idx < 0) return null
  const m = orderedModes[idx]
  if ((m === 'resume' || m === 'compact-resume' || m === 'fork') && !hasPrev) return null
  return m
}

/**
 * StartChooser — replaces the chat surface when HiveChat first mounts
 * (or until the user picks a startup mode). Shows the prior session's
 * sid / ctx% / model / last-active and four buttons:
 *   ↻ Resume          claude -c
 *   ⎙ Compact+Resume  --print /compact → --resume sid
 *   ✦ Start new       fresh session-id, no prior context
 *   ⑂ Fork            --resume sid --fork-session
 *
 * Smart default focus:
 *   - no prior session                  → Start new (autoFocus)
 *   - prior session, ctx >= 80%         → Compact+Resume (autoFocus)
 *   - prior session, ctx < 80% / unknown → Resume (autoFocus)
 *
 * Keyboard: ↵ fires the focused button; 1-4 picks by index.
 */
export function StartChooser({
  cwd, loaded, info, onPick, active = true
}: {
  cwd?: string
  loaded: boolean
  info: { sid: string; model: string; contextSize: string; peakInputTokens: number; lastActiveMs: number; cwd: string } | null
  onPick: (mode: 'resume' | 'compact-resume' | 'new' | 'fork', chosenSid?: string) => void
  active?: boolean
}) {
  const ctxTotal = info ? parseContextSize(info.contextSize) : 0
  const pct = ctxTotal > 0 && info && info.peakInputTokens > 0
    ? Math.round((info.peakInputTokens / ctxTotal) * 100)
    : 0
  const ctxTier: 'normal' | 'warn' | 'urgent' =
    pct >= 80 ? 'urgent' : pct >= 60 ? 'warn' : 'normal'
  const ctxColor = ctxTier === 'urgent' ? CRUSH.Sriracha : ctxTier === 'warn' ? CRUSH.Zest : CRUSH.Julep

  const hasPrev = !!info
  const defaultMode: 'resume' | 'compact-resume' | 'new' | 'fork' = !hasPrev
    ? 'new'
    : ctxTier === 'urgent' ? 'compact-resume' : 'resume'

  // Inline session picker. When user clicks Resume / Compact+Resume /
  // Fork (any of which targets a specific session), we expand a 5-row
  // list of recent sessions under the buttons. New is direct (no pick).
  type PickerMode = 'resume' | 'compact-resume' | 'fork'
  const [picker, setPicker] = useState<{
    action: PickerMode
    sessions: RecentSessionRow[]
    selectedSid: string
    loading: boolean
  } | null>(null)

  const openPicker = async (action: PickerMode) => {
    setPicker({ action, sessions: [], selectedSid: '', loading: true })
    try {
      let list = await window.api.chat.getRecentSessions(cwd || '', 5)
      // getRecentSessions only lists the cwd bucket. When that's empty but the
      // backend recovered a session cross-bucket (worktree↔session mismatch),
      // `info` still holds it — surface it so the user can resume.
      if (list.length === 0 && info?.sid) {
        list = [{
          sid: info.sid,
          title: '(recovered session)',
          preview: '',
          lastActiveMs: info.lastActiveMs,
          ctxPct: 0,
          totalTokens: info.peakInputTokens
        }]
      }
      // UX shortcut: when only one session is on disk, skip the picker
      // step entirely and launch with that sid. Users were hitting
      // "click Compact+Resume → picker opens → click row → click
      // Confirm" 3-step friction and reporting "Compact+Resume 没反应"
      // because they didn't realize the picker required a Confirm tap.
      // Hide the picker, fire onPick directly. Two or more sessions
      // still need the picker (user has a real choice to make).
      if (list.length === 1) {
        setPicker(null)
        onPick(action, list[0].sid)
        return
      }
      setPicker({
        action,
        sessions: list,
        selectedSid: list[0]?.sid || '',
        loading: false
      })
    } catch {
      setPicker({ action, sessions: [], selectedSid: '', loading: false })
    }
  }

  const handlePick = (mode: 'resume' | 'compact-resume' | 'new' | 'fork') => {
    if (mode === 'new') { onPick('new'); return }
    openPicker(mode)
  }

  // Keyboard shortcuts: ↵ activates default, 1-4 pick by index.
  // While picker is open: ↵ confirms, Esc closes, ↑↓ navigates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Backgrounded panels must never consume keys (see chooserKeyMode docs).
      if (!active) return
      if (picker) {
        if (e.key === 'Escape') { e.preventDefault(); setPicker(null); return }
        if (e.key === 'Enter' && picker.selectedSid) {
          e.preventDefault()
          onPick(picker.action, picker.selectedSid)
          return
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && picker.sessions.length > 0) {
          e.preventDefault()
          const idx = picker.sessions.findIndex(s => s.sid === picker.selectedSid)
          const next = e.key === 'ArrowDown'
            ? Math.min(picker.sessions.length - 1, idx + 1)
            : Math.max(0, idx - 1)
          setPicker({ ...picker, selectedSid: picker.sessions[next].sid })
          return
        }
        return
      }
      const mode = chooserKeyMode(e.key, active, hasPrev, defaultMode)
      if (mode) { e.preventDefault(); handlePick(mode) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, defaultMode, hasPrev, onPick, picker])

  const cwdLabel = (cwd || '').replace(/^\/Users\/[^/]+/, '~')
  const sidShort = info?.sid?.slice(0, 8) ?? ''
  const lastActiveLabel = info ? humanRelativeTime(Date.now() - info.lastActiveMs) : ''
  const modelLabel = info?.model ? info.model.replace(/^claude-/, '') + (info.contextSize ? ` · ${info.contextSize}` : '') : ''

  return (
    <div style={{
      flex: '1 1 auto', minHeight: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      overflow: 'auto'
    }}>
      <div style={{
        width: '100%', maxWidth: 760,
        background: CRUSH.BBQ,
        border: `1px solid ${CRUSH.Charcoal}`,
        borderRadius: 12,
        padding: '24px 24px 20px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
      }}>
        {/* Head */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: 14, marginBottom: 18,
          borderBottom: `1px dashed ${CRUSH.Charcoal}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: hasPrev ? (ctxTier === 'urgent' ? CRUSH.Sriracha : CRUSH.Charple) : CRUSH.Zest,
              boxShadow: `0 0 8px ${hasPrev ? (ctxTier === 'urgent' ? CRUSH.Sriracha : CRUSH.Charple) : CRUSH.Zest}`
            }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: CRUSH.Ash, letterSpacing: '0.04em' }}>
              Start session — pick a mode
            </span>
          </div>
          {cwdLabel && (
            <span title={cwd} style={{
              fontFamily: FONT_MONO, fontSize: 10, color: CRUSH.Squid,
              background: CRUSH.Pepper, border: `1px solid ${CRUSH.Charcoal}`,
              borderRadius: 4, padding: '3px 8px',
              maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>{cwdLabel}</span>
          )}
        </div>

        {/* Info row */}
        {!loaded ? (
          <div style={{
            background: CRUSH.Pepper, border: `1px solid ${CRUSH.Charcoal}`, borderRadius: 8,
            padding: 18, textAlign: 'center', color: CRUSH.Squid, fontSize: 11, marginBottom: 18
          }}>scanning ~/.claude/projects…</div>
        ) : hasPrev ? (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            background: CRUSH.Pepper, border: `1px solid ${CRUSH.Charcoal}`,
            borderRadius: 8, overflow: 'hidden', marginBottom: 18
          }}>
            <ChooserCell label="Last session" value={sidShort} valueColor={CRUSH.Bok} title={info!.sid} />
            <ChooserCell label="Context" value={pct > 0 ? `${pct}%` : `${(info!.peakInputTokens / 1000).toFixed(1)}K`} valueColor={ctxColor} />
            <ChooserCell label="Model" value={modelLabel || 'unknown'} valueColor={CRUSH.Malibu} />
            <ChooserCell label="Last active" value={lastActiveLabel} valueColor={CRUSH.Ash} last />
          </div>
        ) : (
          <div style={{
            background: CRUSH.Pepper, border: `1px solid ${CRUSH.Charcoal}`, borderRadius: 8,
            padding: 18, textAlign: 'center', marginBottom: 18
          }}>
            <div style={{ fontSize: 9, color: CRUSH.Squid, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
              No previous session for this directory
            </div>
            <div style={{ fontSize: 12, color: CRUSH.Squid }}>First time here — only "Start new" is available</div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {/* Active mode: when picker is open, the action you clicked
              is "active" (replaces defaultMode highlight). Otherwise
              defaultMode (smart pick based on ctx tier) is highlighted.
              Without this, clicking Compact+Resume left the green
              Resume highlight up — confusing the user about which
              action was actually queued. */}
          <ChooserBtn
            icon="↻" label="Resume" desc="pick session"
            color={CRUSH.Bok}
            disabled={!hasPrev}
            isDefault={(picker ? picker.action : defaultMode) === 'resume'}
            onClick={() => handlePick('resume')}
          />
          <ChooserBtn
            icon="⎙" label="Compact + Resume" desc="pick session"
            color={CRUSH.Charple}
            disabled={!hasPrev}
            isDefault={(picker ? picker.action : defaultMode) === 'compact-resume'}
            onClick={() => handlePick('compact-resume')}
          />
          <ChooserBtn
            icon="✦" label="Start new" desc="fresh session-id"
            color={CRUSH.Zest}
            disabled={false}
            isDefault={picker ? false : defaultMode === 'new'}
            onClick={() => handlePick('new')}
          />
          <ChooserBtn
            icon="⑂" label="Fork" desc="pick session"
            color={CRUSH.Mochi}
            disabled={!hasPrev}
            isDefault={(picker ? picker.action : defaultMode) === 'fork'}
            onClick={() => handlePick('fork')}
          />
        </div>

        {/* Inline session picker — appears under the buttons whenever
           Resume / Compact+Resume / Fork is clicked. Lists 5 newest
           sessions for this cwd; default-selects the latest; click row
           to swap selection; Confirm to launch with that sid. */}
        {picker && (
          <SessionPickerInline
            action={picker.action}
            sessions={picker.sessions}
            loading={picker.loading}
            selectedSid={picker.selectedSid}
            onSelect={(sid) => setPicker({ ...picker, selectedSid: sid })}
            onConfirm={() => {
              if (picker.selectedSid) onPick(picker.action, picker.selectedSid)
            }}
            onCancel={() => setPicker(null)}
          />
        )}

        {/* Hint */}
        <div style={{ marginTop: 14, fontSize: 10, color: CRUSH.Squid, textAlign: 'center', letterSpacing: '0.04em' }}>
          <Kbd>↵</Kbd> default · <Kbd>1</Kbd>–<Kbd>4</Kbd> pick by index
        </div>
        {ctxTier === 'urgent' && hasPrev && (
          <div style={{ marginTop: 8, fontSize: 10, color: CRUSH.Sriracha, textAlign: 'center' }}>
            Context near limit — Compact + Resume is the safer bet
          </div>
        )}
      </div>
    </div>
  )
}

type RecentSessionRow = {
  sid: string
  title: string
  preview: string
  lastActiveMs: number
  ctxPct: number
  totalTokens: number
}

export function SessionPickerInline({
  action, sessions, loading, selectedSid, onSelect, onConfirm, onCancel
}: {
  action: 'resume' | 'compact-resume' | 'fork'
  sessions: RecentSessionRow[]
  loading: boolean
  selectedSid: string
  onSelect: (sid: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const actionMeta = action === 'resume'
    ? { icon: '↻', label: 'Resume', color: CRUSH.Bok }
    : action === 'compact-resume'
      ? { icon: '⎙', label: 'Compact + Resume', color: CRUSH.Charple }
      : { icon: '⑂', label: 'Fork', color: CRUSH.Mochi }

  const fmtAgo = (ms: number) => {
    const diff = Date.now() - ms
    if (diff < 60_000) return 'just now'
    const m = Math.floor(diff / 60_000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }

  return (
    <div style={{
      marginTop: 12,
      background: CRUSH.Pepper,
      border: `1px solid ${actionMeta.color}`,
      borderRadius: 8,
      padding: 10
    }}>
      {/* Picker header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: 'Space Grotesk, sans-serif' as any,
        fontSize: 10, color: CRUSH.Squid,
        textTransform: 'uppercase' as const, letterSpacing: '0.08em',
        paddingBottom: 8, marginBottom: 8,
        borderBottom: `1px dashed ${CRUSH.Charcoal}`
      }}>
        <span>
          Pick a session to{' '}
          <span style={{ color: actionMeta.color, fontWeight: 700 }}>
            {actionMeta.icon} {actionMeta.label}
          </span>
        </span>
        <span
          onClick={onCancel}
          style={{ cursor: 'pointer', fontSize: 12, color: CRUSH.Squid }}
          onMouseEnter={e => { e.currentTarget.style.color = CRUSH.Sriracha }}
          onMouseLeave={e => { e.currentTarget.style.color = CRUSH.Squid }}
        >✕</span>
      </div>

      {/* Rows */}
      {loading ? (
        <div style={{ padding: 18, textAlign: 'center' as const, color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 11 }}>
          scanning ~/.claude/projects…
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center' as const, color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 11 }}>
          no prior sessions found for this directory
        </div>
      ) : (
        sessions.map(s => {
          const isSelected = s.sid === selectedSid
          const ctxColor = s.ctxPct >= 80 ? CRUSH.Sriracha
            : s.ctxPct >= 60 ? CRUSH.Zest
            : CRUSH.Charple
          return (
            <div
              key={s.sid}
              onClick={() => onSelect(s.sid)}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr 110px',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${isSelected ? actionMeta.color : 'transparent'}`,
                background: isSelected ? `${actionMeta.color}15` : 'transparent',
                alignItems: 'start' as const,
                transition: 'all 120ms'
              }}
              onMouseEnter={e => {
                if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }}
              onMouseLeave={e => {
                if (!isSelected) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{
                fontFamily: FONT_MONO, fontSize: 11, color: actionMeta.color,
                fontWeight: 600, paddingTop: 2,
                whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis'
              }} title={s.sid}>{s.sid.slice(0, 8)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: FONT_MONO, fontSize: 12, color: CRUSH.Ash, fontWeight: 600,
                  marginBottom: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const
                }}>{s.title}</div>
                <div style={{
                  fontFamily: FONT_MONO, fontSize: 10, color: CRUSH.Squid,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const
                }}>└ {s.preview}</div>
              </div>
              <div style={{
                textAlign: 'right' as const,
                fontFamily: FONT_MONO, fontSize: 9, color: CRUSH.Squid,
                paddingTop: 2
              }}>
                <div style={{ color: CRUSH.Ash }}>{fmtAgo(s.lastActiveMs)}</div>
                {s.ctxPct > 0 && (
                  <div style={{ color: ctxColor, marginTop: 1 }}>{s.ctxPct}%</div>
                )}
              </div>
            </div>
          )
        })
      )}

      {/* Footer */}
      <div style={{
        display: 'flex', gap: 8, marginTop: 10,
        paddingTop: 8,
        borderTop: `1px dashed ${CRUSH.Charcoal}`,
        alignItems: 'center'
      }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: CRUSH.Squid }}>
          {sessions.length > 0 ? `${sessions.length} most recent · ↑↓ navigate · ↵ confirm · esc cancel` : ''}
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          onClick={onCancel}
          style={{
            background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 11,
            padding: '5px 14px', borderRadius: 4, cursor: 'pointer'
          }}
        >Cancel</button>
        <button
          onClick={onConfirm}
          disabled={!selectedSid}
          style={{
            background: selectedSid ? `${actionMeta.color}1F` : 'transparent',
            border: `1px solid ${actionMeta.color}`,
            color: actionMeta.color,
            fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
            padding: '5px 14px', borderRadius: 4,
            cursor: selectedSid ? 'pointer' : 'not-allowed',
            opacity: selectedSid ? 1 : 0.4
          }}
        >{actionMeta.icon} {actionMeta.label} {selectedSid ? selectedSid.slice(0, 8) : ''}</button>
      </div>
    </div>
  )
}

function ChooserCell({ label, value, valueColor, title, last }: {
  label: string; value: string; valueColor: string; title?: string; last?: boolean
}) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRight: last ? 'none' : `1px solid ${CRUSH.Charcoal}`,
      display: 'flex', flexDirection: 'column', gap: 4
    }}>
      <span style={{ fontSize: 9, color: CRUSH.Squid, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
      <span title={title} style={{
        fontSize: 13, fontWeight: 600, color: valueColor, fontFamily: FONT_MONO,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>{value}</span>
    </div>
  )
}

// Solid hex tints for default-mode buttons. Matches ui-preview-start-chooser.html.
// Per the color contract we don't apply rgba() alpha to accent colors — the
// border + icon + label render at full saturation, and the panel background
// is a precomputed solid blend.
const CHOOSER_TINTS: Record<string, string> = {
  [CRUSH.Bok]: '#1a3a30',
  [CRUSH.Charple]: '#1f1a3a',
  [CRUSH.Zest]: '#2a2a18',
  [CRUSH.Mochi]: '#3a1d3f'
}
function ChooserBtn({ icon, label, desc, color, disabled, isDefault, onClick }: {
  icon: string; label: string; desc: string; color: string;
  disabled: boolean; isDefault: boolean; onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (isDefault && !disabled) ref.current?.focus() }, [isDefault, disabled])
  const tinted = CHOOSER_TINTS[color] || CRUSH.Pepper
  return (
    <button
      ref={ref}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        background: isDefault && !disabled ? tinted : CRUSH.Pepper,
        border: isDefault && !disabled ? `2px solid ${color}` : `1px solid ${CRUSH.Charcoal}`,
        color: disabled ? CRUSH.Squid : (isDefault ? color : CRUSH.Ash),
        fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
        padding: isDefault && !disabled ? '15px 11px' : '16px 12px',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        textAlign: 'center',
        transition: 'all 120ms',
        display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        outline: 'none'
      }}
      onMouseEnter={e => {
        if (disabled || isDefault) return
        e.currentTarget.style.borderColor = color
        e.currentTarget.style.color = color
      }}
      onMouseLeave={e => {
        if (disabled || isDefault) return
        e.currentTarget.style.borderColor = CRUSH.Charcoal
        e.currentTarget.style.color = CRUSH.Ash
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, color: disabled ? CRUSH.Squid : color }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 400, letterSpacing: '0.02em', color: disabled ? CRUSH.Squid : CRUSH.Squid }}>{desc}</span>
    </button>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      background: CRUSH.Charcoal, color: CRUSH.Ash,
      padding: '1px 6px', borderRadius: 3, margin: '0 2px',
      fontFamily: FONT_MONO, fontSize: 9, border: `1px solid ${CRUSH.Oyster}`
    }}>{children}</kbd>
  )
}

function humanRelativeTime(ms: number): string {
  if (ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function humanEta(resetsAt: number | undefined): string {
  if (!resetsAt) return ''
  const ms = resetsAt * 1000 - Date.now()
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins}m`
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

/**
 * CrushTooltip — small hover popover styled to match the rest of the
 * chat surface (Pepper bg, Charple border, mono font). Replaces native
 * HTML `title` attributes (which are rendered as OS tooltips and can't
 * be CSS-styled). 250ms delay before showing so brief mouseovers don't
 * flicker; arrow points at the trigger.
 *
 * Usage:  <CrushTooltip text="run /compact"><button>⎙</button></CrushTooltip>
 */
export function CrushTooltip({ text, children, side = 'top', block = false }: {
  text: string
  children: React.ReactNode
  side?: 'top' | 'bottom'
  block?: boolean
}) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShow(true), 250)
  }
  const leave = () => {
    if (timer.current) clearTimeout(timer.current)
    setShow(false)
  }
  return (
    <span
      style={{
        position: 'relative' as const,
        display: block ? 'block' as const : 'inline-flex' as const,
        ...(block ? { minWidth: 0 } : {})
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute' as const,
          ...(side === 'top'
            ? { bottom: 'calc(100% + 8px)' }
            : { top: 'calc(100% + 8px)' }),
          left: '50%', transform: 'translateX(-50%)',
          background: CRUSH.Pepper,
          border: `1px solid ${CRUSH.Charple}`,
          color: CRUSH.Ash,
          fontFamily: FONT_MONO, fontSize: 11, lineHeight: 1.4,
          padding: '6px 10px',
          borderRadius: 6,
          whiteSpace: 'normal' as const,
          width: 'max-content',
          maxWidth: 280,
          zIndex: 200,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          pointerEvents: 'none' as const,
          textAlign: 'center' as const
        }}>
          {text}
          <span style={{
            position: 'absolute' as const,
            left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            ...(side === 'top'
              ? { top: '100%', borderTop: `5px solid ${CRUSH.Charple}` }
              : { bottom: '100%', borderBottom: `5px solid ${CRUSH.Charple}` })
          }} />
        </span>
      )}
    </span>
  )
}

/**
 * ActionToolbar — single-row utility strip above the input bubble.
 *
 * Layout:  [● 7d allowed · resets in 4h 12m]  [ctx 22%]   [Compact] [⋮]
 *
 * Combines what used to be two stacked rows (RateLimitBar + buttons) into
 * one — saves vertical space and matches the visual height of the bottom
 * ModelUsageBar. Compact button border/label escalate with ctx %:
 *   < 60%:    Charple border, label "Compact"
 *   ≥ 60%:    Zest border,    label "Compact (⚠ 68%)"
 *   ≥ 80%:    Sriracha border (matches CtxNagBanner urgent color)
 *
 * `⋮` kebab opens a dropdown housing other session-level actions
 * (Fork, Resume, Remote Control, Close).
 */
function ActionToolbar({
  usedTokens, contextSize, onCompact, compacting, onFork, onResume, onNewSession, onRemoteControl, onClose, onHandoff, sessionActive,
  rateLimit5h, rateLimit7d, autoContinueAt, onCancelAutoContinue, modelKnown, onViewContext
}: {
  usedTokens: number
  contextSize: string
  onCompact: () => void
  compacting: boolean
  onFork: () => void
  onResume: () => void
  onNewSession: () => void
  onRemoteControl: () => void
  onClose: () => void
  onHandoff: () => void
  sessionActive: boolean
  rateLimit5h: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null
  rateLimit7d: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null
  autoContinueAt: number | null
  onCancelAutoContinue: () => void
  modelKnown: boolean
  onViewContext: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const ctxTotal = parseContextSize(contextSize)
  const pct = ctxTotal > 0 && usedTokens > 0 ? Math.round((usedTokens / ctxTotal) * 100) : 0
  const tier = selectCompactBtnTier(pct)
  const compactColor = tier === 'urgent' ? CRUSH.Sriracha : tier === 'warn' ? CRUSH.Zest : CRUSH.Charple
  const compactBg = tier === 'urgent' ? 'rgba(235,66,104,0.10)' : tier === 'warn' ? 'rgba(232,254,150,0.08)' : 'transparent'
  const compactLabel = tier === 'normal' ? 'Compact' : `Compact (⚠ ${pct}%)`

  // 60s heartbeat so `resets in Xh Ym` ticks down without waiting for new events.
  const [, force] = useState(0)
  const paused = useContext(HiveChatPausedContext)
  useEffect(() => {
    if (paused) return
    if (!rateLimit5h?.resetsAt && !rateLimit7d?.resetsAt && !autoContinueAt) return
    const iv = setInterval(() => force(n => n + 1), 60_000)
    return () => clearInterval(iv)
  }, [paused, rateLimit5h?.resetsAt, rateLimit7d?.resetsAt, autoContinueAt])

  // Click-outside to close menu
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const showRateRow = !!(rateLimit5h || rateLimit7d || autoContinueAt)

  return (
    <>
      {/* Line 1 — rate-limit + auto-continue (BBQ background, hidden
         until claude actually emits its first rate_limit_event or a
         whip schedules an auto-continue) */}
      {showRateRow && (
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          padding: '4px 12px',
          background: CRUSH.BBQ,
          fontFamily: FONT_MONO, fontSize: 10,
          color: CRUSH.Squid,
          gap: 10
        }}>
          <RateChip info={rateLimit5h} typeLabel="5h" />
          {rateLimit5h && (rateLimit7d || autoContinueAt) && <span style={{ color: CRUSH.Oyster }}>|</span>}
          <RateChip info={rateLimit7d} typeLabel="7d" />
          {rateLimit7d && autoContinueAt && <span style={{ color: CRUSH.Oyster }}>|</span>}
          {autoContinueAt && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: CRUSH.Charple }}>
                ⏱ auto-continue in {humanEta(Math.floor(autoContinueAt / 1000))}
              </span>
              <button
                onClick={onCancelAutoContinue}
                style={{
                  background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
                  color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 9,
                  padding: '0 5px', borderRadius: 2, cursor: 'pointer'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = CRUSH.Charple; e.currentTarget.style.color = CRUSH.Charple }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = CRUSH.Charcoal; e.currentTarget.style.color = CRUSH.Squid }}
              >cancel</button>
            </span>
          )}
        </div>
      )}

      {/* Line 2 — context progress bar + Compact + kebab. Background
         matches the chat surface (no BBQ panel) so the bar feels part
         of the conversation column. When no model has emitted yet,
         left side shows a subdued "waiting for first message…". */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '6px 12px',
        background: CHAT_SURFACE_BG,
        fontFamily: FONT_MONO, fontSize: 10,
        color: CRUSH.Squid,
        gap: 10,
        position: 'relative' as const
      }}>
        {pct > 0 ? (
          <>
            <span style={{ color: CRUSH.Squid, fontSize: 10 }}>context</span>
            <CtxProgressBar pct={pct} tier={tier} />
            <span style={{
              color: compactColor, fontWeight: 600, minWidth: 36, textAlign: 'right' as const
            }}>{pct}%</span>
            <CrushTooltip text="View context breakdown · ~7s session pause to scrape /context">
              <button
                onClick={onViewContext}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: CRUSH.Squid,
                  cursor: 'pointer',
                  fontSize: 13, lineHeight: 1,
                  padding: '2px 4px',
                  borderRadius: 3,
                  transition: 'color 120ms'
                }}
                onMouseEnter={e => { e.currentTarget.style.color = CRUSH.Bok }}
                onMouseLeave={e => { e.currentTarget.style.color = CRUSH.Squid }}
              >ⓘ</button>
            </CrushTooltip>
          </>
        ) : !modelKnown ? (
          <span style={{ color: CRUSH.Oyster, fontStyle: 'italic' as const }}>
            waiting for first message…
          </span>
        ) : (
          <span style={{ color: CRUSH.Oyster }}>context —</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <CrushTooltip text={compacting ? 'Compacting in progress — please wait (up to 10 min)' : 'Run /compact · summarize history into a smaller prompt · up to 10 min'}>
          <button
            onClick={onCompact}
            disabled={compacting}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: compactBg,
              border: `1px solid ${compactColor}`,
              color: compactColor,
              fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: compacting ? 'not-allowed' : 'pointer',
              opacity: compacting ? 0.5 : 1,
              transition: 'all 120ms'
            }}
            onMouseEnter={e => { if (compacting) return; e.currentTarget.style.background = compactColor; e.currentTarget.style.color = CRUSH.Pepper }}
            onMouseLeave={e => { if (compacting) return; e.currentTarget.style.background = compactBg; e.currentTarget.style.color = compactColor }}
          >
            <span style={{ fontSize: 11, lineHeight: 1 }}>⎙</span>{compacting ? 'Compacting…' : compactLabel}
          </button>
        </CrushTooltip>
        <div ref={menuRef} style={{ position: 'relative' as const }}>
          <CrushTooltip text="More session actions · Resume / Fork / Remote / Close">
          <button
            onClick={() => setMenuOpen(o => !o)}
            style={{
              background: 'transparent',
              border: `1px solid ${menuOpen ? CRUSH.Charple : CRUSH.Charcoal}`,
              color: menuOpen ? CRUSH.Charple : CRUSH.Squid,
              fontFamily: FONT_MONO, fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 120ms',
              lineHeight: 1
            }}
          >⋮</button>
          </CrushTooltip>
          {menuOpen && (
            <div style={{
              position: 'absolute' as const,
              right: 0, bottom: 'calc(100% + 4px)',
              background: CRUSH.BBQ,
              border: `1px solid ${CRUSH.Charple}`,
              borderRadius: 6,
              padding: 4,
              minWidth: 220,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              zIndex: 20
            }}>
              <MenuItem icon="🥴" label="Handoff…" desc="autonomous /goal loop" onClick={() => { setMenuOpen(false); onHandoff() }} hover="Hand a goal off to the agent and walk away. It runs claude -p /goal in the background with cost/turn/wall-time circuit breakers. Stop button always visible while running." />
              <div style={{ height: 1, background: CRUSH.Charcoal, margin: '3px 0' }} />
              <MenuItem icon="≡" label="Compact + Fork" desc="summary → new sid" onClick={() => { setMenuOpen(false); onFork() }} disabled={!sessionActive} hover="Summarise current context, fork to a NEW session id. Old jsonl is left untouched; live session id changes." />
              <MenuItem icon="↻" label="Restart Session" desc="kill + resume" onClick={() => { setMenuOpen(false); onResume() }} hover="Kill the live --print child and immediately re-spawn with --resume <sid>. Same session id, same jsonl. Auto-compacts first if context > 50%. Useful for hard-refresh; not a no-op." />
              <MenuItem icon="✦" label="Start New Session" desc="clean slate, no memory" onClick={() => { setMenuOpen(false); onNewSession() }} />
              <MenuItem icon="⌽" label="Remote Control" desc="/remote-control" onClick={() => { setMenuOpen(false); onRemoteControl() }} />
              <div style={{ height: 1, background: CRUSH.Charcoal, margin: '3px 0' }} />
              <MenuItem icon="✕" label="Close Session" desc="stop --print" onClick={() => { setMenuOpen(false); onClose() }} danger />
            </div>
          )}
        </div>
      </span>
      </div>
    </>
  )
}

const CHAT_SURFACE_BG = '#150e24'

/** Inline chip rendering "● {type} {status} resets in {eta}" for one
 * rate-limit window. Returns null when there's no event yet for this
 * window — caller decides whether to insert separators. */
function RateChip({ info, typeLabel }: {
  info: { status?: string; resetsAt?: number; isUsingOverage?: boolean } | null
  typeLabel: string
}) {
  if (!info) return null
  const color = info.status === 'allowed' ? CRUSH.Julep
    : info.status === 'rejected' || info.status === 'blocked' ? CRUSH.Sriracha
    : CRUSH.Zest
  const isUrgent = info.status === 'rejected' || info.status === 'blocked'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color, fontWeight: 700 }}>● {typeLabel}</span>
      <span style={{ color: CRUSH.Ash }}>{info.status || '?'}</span>
      {info.resetsAt && (
        <span style={{ color: isUrgent ? CRUSH.Sriracha : CRUSH.Squid }}>
          resets in {humanEta(info.resetsAt)}
        </span>
      )}
      {info.isUsingOverage && <span style={{ color: CRUSH.Zest }}>⚠ overage</span>}
    </span>
  )
}

/** Filled progress bar for context %. Gradient escalates with tier:
 *   normal  → Charple → Mochi
 *   warn    → Zest → #FFC857
 *   urgent  → Sriracha → Dolly
 */
function CtxProgressBar({ pct, tier }: { pct: number; tier: 'normal' | 'warn' | 'urgent' }) {
  const grad = tier === 'urgent' ? `linear-gradient(90deg, ${CRUSH.Sriracha}, ${CRUSH.Dolly})`
    : tier === 'warn' ? `linear-gradient(90deg, ${CRUSH.Zest}, #FFC857)`
    : `linear-gradient(90deg, ${CRUSH.Charple}, ${CRUSH.Mochi})`
  return (
    <span style={{
      flex: '1 1 auto',
      position: 'relative' as const,
      height: 6,
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 3,
      overflow: 'hidden' as const,
      border: `1px solid ${CRUSH.Charcoal}`
    }}>
      <span style={{
        display: 'block',
        height: '100%',
        width: `${Math.min(100, pct)}%`,
        background: grad,
        borderRadius: 2,
        transition: 'width 200ms'
      }} />
    </span>
  )
}

function MenuItem({ icon, label, desc, onClick, danger, disabled, hover }: {
  icon: string; label: string; desc?: string; onClick: () => void; danger?: boolean; disabled?: boolean
  /** Native browser tooltip. Used to explain non-obvious behaviour
   *  (e.g. "Restart Session (kill + resume)" needs to say WHAT it
   *  kills so users don't fire it as a no-op-refresh). */
  hover?: string
}) {
  const accent = danger ? CRUSH.Sriracha : CRUSH.Charple
  const bg = danger ? 'rgba(235,66,104,0.14)' : 'rgba(107,80,255,0.14)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hover}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '7px 10px',
        background: 'transparent', border: 'none', borderRadius: 3,
        color: disabled ? CRUSH.Oyster : CRUSH.Ash,
        fontFamily: FONT_MONO, fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left' as const
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = bg; e.currentTarget.style.color = CRUSH.Butter } }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = disabled ? CRUSH.Oyster : CRUSH.Ash }}
    >
      <span style={{ color: disabled ? CRUSH.Oyster : accent, minWidth: 14, textAlign: 'center' as const, fontWeight: 700 }}>{icon}</span>
      <span>{label}</span>
      {desc && <span style={{ marginLeft: 'auto', color: CRUSH.Oyster, fontSize: 10 }}>{desc}</span>}
    </button>
  )
}

/** Context-pressure nag banner. Fires at 80% (warn, Zest) and 90%
 * (urgent, Sriracha) of the model context window. Each tier
 * dismissable independently; both reset when ctx drops by ≥ 30%
 * (signals a /compact ran). User can hit "Compact now" inline
 * instead of typing /compact. */
function CtxNagBanner({
  contextSize, usedTokens, dismissed,
  onDismissWarn, onDismissUrgent, onCompact
}: {
  contextSize: string
  usedTokens: number
  dismissed: { warn: boolean; urgent: boolean }
  onDismissWarn: () => void
  onDismissUrgent: () => void
  onCompact: () => void
}) {
  if (!contextSize || usedTokens <= 0) return null
  const ctxTotal = parseContextSize(contextSize)
  if (ctxTotal <= 0) return null
  const pct = Math.round((usedTokens / ctxTotal) * 100)
  const tier = selectCtxNagTier(pct, dismissed)
  if (!tier) return null
  const isUrgent = tier === 'urgent'
  const color = isUrgent ? CRUSH.Sriracha : CRUSH.Zest
  const bg = isUrgent ? 'rgba(235, 66, 104, 0.10)' : 'rgba(232, 254, 150, 0.08)'
  const label = isUrgent ? '⚠️ Context CRITICAL' : '⚠ Context filling up'
  const onDismiss = isUrgent ? onDismissUrgent : onDismissWarn
  return (
    <div style={{
      padding: '6px 12px',
      borderTop: `1px solid ${color}`,
      borderBottom: `1px solid ${color}`,
      background: bg,
      fontFamily: FONT_MONO, fontSize: 11,
      display: 'flex', alignItems: 'center', gap: 10,
      color: CRUSH.Ash
    }}>
      <span style={{ color, fontWeight: 700 }}>{label}</span>
      <span>{pct}% used ({usedTokens.toLocaleString()} / {ctxTotal.toLocaleString()} tokens)</span>
      <span style={{ color: CRUSH.Squid }}>· run /compact to summarize history</span>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        <button
          onClick={onCompact}
          style={{
            background: color, border: 'none',
            color: CRUSH.Pepper, fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700,
            padding: '2px 10px', borderRadius: 3, cursor: 'pointer'
          }}
        >Compact now</button>
        <button
          onClick={onDismiss}
          title="Dismiss this warning (will return on /compact)"
          style={{
            background: 'transparent', border: `1px solid ${CRUSH.Charcoal}`,
            color: CRUSH.Squid, fontFamily: FONT_MONO, fontSize: 10,
            padding: '1px 6px', borderRadius: 2, cursor: 'pointer'
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = CRUSH.Charcoal; e.currentTarget.style.color = CRUSH.Squid }}
        >✕</button>
      </span>
    </div>
  )
}

function SubagentBanner({ subs }: { subs: Record<string, {
  startedAt: number; lastEventAt: number; eventCount: number
  description?: string; lastToolName?: string
  totalTokens?: number; toolUses?: number; durationMs?: number
}> }) {
  const [, force] = useState(0)
  const paused = useContext(HiveChatPausedContext)
  useEffect(() => {
    if (paused) return
    const iv = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [paused])
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
  // Sort: active (recent activity) first, idle last — so when capped + scrolled
  // the user sees what's actually moving. Stable for equal lastEventAt.
  entries.sort(([, a], [, b]) => b.lastEventAt - a.lastEventAt)
  // Cap visible height around ~5 rows; scroll the rest. Without this, a
  // long-running multi-agent task (e.g. 36 subagents at once) pushes the
  // input bar and rate-limit row off screen.
  const ROW_PX = 22
  const MAX_VISIBLE = 5
  const needsScroll = entries.length > MAX_VISIBLE
  const activeCount = entries.filter(([, s]) => Date.now() - s.lastEventAt < 60000).length
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
      {entries.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: CRUSH.Charple, fontWeight: 700,
          fontSize: 10, letterSpacing: '0.04em',
          paddingBottom: 2, marginBottom: 2,
          borderBottom: `1px dashed ${CRUSH.Charcoal}`
        }}>
          <span>🔧 {entries.length} subagents</span>
          <span style={{ color: CRUSH.Squid, fontWeight: 400 }}>· {activeCount} active</span>
          {needsScroll && (
            <span style={{ color: CRUSH.Squid, fontWeight: 400, marginLeft: 'auto' }}>
              showing {MAX_VISIBLE} · scroll for more
            </span>
          )}
        </div>
      )}
      <div style={{
        maxHeight: needsScroll ? ROW_PX * MAX_VISIBLE : undefined,
        overflowY: needsScroll ? 'auto' as const : undefined,
        display: 'flex', flexDirection: 'column' as const, gap: 2
      }}>
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
    </div>
  )
}

function RateLimitBar({ info, autoContinueAt, onCancelAutoContinue }: {
  info: { status?: string; rateLimitType?: string; resetsAt?: number; isUsingOverage?: boolean } | null
  autoContinueAt?: number | null
  onCancelAutoContinue?: () => void
}) {
  // 60s heartbeat so `resets in Xh Ym` and `auto-continue in Xh Ym`
  // tick down live without waiting for the next stream event. Matches
  // humanEta's minute resolution exactly — by-the-minute updates,
  // no oversampling.
  const [, force] = useState(0)
  useEffect(() => {
    if (!info?.resetsAt && !autoContinueAt) return
    const iv = setInterval(() => force(n => n + 1), 60_000)
    return () => clearInterval(iv)
  }, [info?.resetsAt, autoContinueAt])
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
 * in v1.7.70 per user feedback). Math extracted to ./progress-bar
 * for unit-testing in node-env vitest. */
function PctBar({ pct, fullColor = CRUSH.Julep, total = 10 }: { pct?: number; fullColor?: string; total?: number }) {
  const { filled, empty } = computeGrainBar(pct, total)
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
          {/* Context %% lives in the dedicated row above input now (line 2
              of the new 4-line layout); no longer rendered inline here.
              Color tier still computed for the (unused) ctxColor var so
              future re-additions remain trivial. */}
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
      <CrushTooltip text={streamingMode
        ? 'Streaming mode ON · username + secrets masked in display'
        : 'Streaming mode OFF · real values shown'}>
        <button
          onClick={onToggleStreaming}
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
      </CrushTooltip>
      {sessionActive && (
        <CrushTooltip text="End this claude session · a confirm panel will appear">
          <button
            onClick={onCloseSession}
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
        </CrushTooltip>
      )}
    </div>
  )
}
