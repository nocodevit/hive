// Notifier: events → filter → channels. Plain code, no LLM, not via Butler.
//
// Filter, in order: the event's switch, quiet hours, "the owner is looking
// at it" (Hive focused AND showing that place), 10-minute de-dup per event
// key. Then every channel that applies: the Mac channel always (when on),
// away channels (Telegram; Prime later) only while the owner is away.

import { targetPlace, type NotifyEventKind, type NotifySettings, type NotifyTarget } from '../shared/notify'

export interface NotifyEvent {
  kind: NotifyEventKind
  /** De-dup key: the same key within DEDUP_MS is dropped. */
  key: string
  title: string
  body: string
  target: NotifyTarget
}

export interface Channel {
  id: string
  /** 'always' = whenever notifications pass the filter; 'away' = only while the owner is away. */
  when: 'always' | 'away'
  enabled: (s: NotifySettings) => boolean
  send: (ev: NotifyEvent) => Promise<void> | void
}

export interface NotifierDeps {
  settings: () => NotifySettings
  channels: Channel[]
  now?: () => number
  /** Screen locked or idle > 10 min. */
  isAway: () => boolean
  /** Hive's window has focus and shows this place ('agent:<id>', 'approvals', 'routines'), or null. */
  focusedPlace: () => string | null
}

export type Decision =
  | { send: true; channels: string[] }
  | { send: false; reason: 'event_off' | 'quiet' | 'looking' | 'duplicate' | 'no_channel' }

export const DEDUP_MS = 10 * 60_000
export const AWAY_IDLE_SEC = 10 * 60

/** "HH:MM" → minutes after midnight. */
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

/** Inside [start, end) local time; a window past midnight (22:00–08:00) wraps. start === end = never. */
export function inQuietHours(q: NotifySettings['quiet'], at: Date): boolean {
  if (!q.on) return false
  const a = mins(q.start), b = mins(q.end), m = at.getHours() * 60 + at.getMinutes()
  if (a === b) return false
  return a < b ? m >= a && m < b : m >= a || m < b
}

export function createNotifier(deps: NotifierDeps) {
  const now = deps.now ?? Date.now
  const lastSent = new Map<string, number>()

  function decide(ev: NotifyEvent): Decision {
    const s = deps.settings()
    if (!s.events[ev.kind]) return { send: false, reason: 'event_off' }
    if (inQuietHours(s.quiet, new Date(now()))) return { send: false, reason: 'quiet' }
    if (deps.focusedPlace() === targetPlace(ev.target)) return { send: false, reason: 'looking' }
    const t = now()
    const prev = lastSent.get(ev.key)
    if (prev !== undefined && t - prev < DEDUP_MS) return { send: false, reason: 'duplicate' }
    const away = deps.channels.some(c => c.when === 'away' && c.enabled(s)) && deps.isAway()
    const channels = deps.channels.filter(c => c.enabled(s) && (c.when === 'always' || away)).map(c => c.id)
    if (!channels.length) return { send: false, reason: 'no_channel' }
    return { send: true, channels }
  }

  return {
    decide,
    /** Filter, then send to every channel that applies. A failing channel never stops the others. */
    async emit(ev: NotifyEvent): Promise<Decision> {
      const d = decide(ev)
      if (!d.send) return d
      lastSent.set(ev.key, now())
      for (const t of [...lastSent]) if (now() - t[1] >= DEDUP_MS) lastSent.delete(t[0])
      await Promise.all(deps.channels.filter(c => d.channels.includes(c.id)).map(c =>
        Promise.resolve().then(() => c.send(ev)).catch(e => console.warn(`[notify] ${c.id} failed:`, e instanceof Error ? e.message : e))))
      return d
    }
  }
}

export type Notifier = ReturnType<typeof createNotifier>

// ── Agent watch: what each chat is waiting on, from its live stream ──────

export type WaitState = 'waiting' | 'question' | 'permission'

export interface AgentWait {
  agentId: string
  state: WaitState
  since: number
  text: string
}

const clip = (s: string, n = 140) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

function toolHint(name: string, input: Record<string, any>): string {
  const h = input?.command ?? input?.file_path ?? input?.path ?? input?.url ?? input?.pattern ?? input?.description ?? ''
  return clip(`${name}${h ? ' · ' + String(h) : ''}`, 120)
}

function questionText(input: Record<string, any>): string {
  const q = Array.isArray(input?.questions) ? input.questions[0]?.question : input?.question
  return typeof q === 'string' ? clip(q) : ''
}

/**
 * Per-agent wait state from stream-json events: a `result` ends the turn
 * (waiting for the owner); a `control_request/can_use_tool` asks permission
 * (AskUserQuestion = a question); any generation event clears it.
 */
export function createAgentWatch(now: () => number = Date.now) {
  const waits = new Map<string, AgentWait>()
  const lastText = new Map<string, string>()

  return {
    /** Feed one event; returns the new wait when this event started one. */
    onEvent(agentId: string, ev: any): AgentWait | null {
      const t = ev?.type
      if (t === 'control_request' && ev.request?.subtype === 'can_use_tool' && typeof ev.request.tool_name === 'string') {
        const name: string = ev.request.tool_name
        const input = ev.request.input && typeof ev.request.input === 'object' ? ev.request.input : {}
        const w: AgentWait = name === 'AskUserQuestion'
          ? { agentId, state: 'question', since: now(), text: questionText(input) || lastText.get(agentId) || '' }
          : { agentId, state: 'permission', since: now(), text: toolHint(name, input) }
        waits.set(agentId, w)
        return w
      }
      if (t === 'result') {
        const w: AgentWait = { agentId, state: 'waiting', since: now(), text: lastText.get(agentId) || '' }
        lastText.delete(agentId)
        waits.set(agentId, w)
        return w
      }
      if (t === 'assistant' && !ev.parent_tool_use_id) {
        const blocks = Array.isArray(ev.message?.content) ? ev.message.content : []
        const text = blocks.filter((b: any) => b?.type === 'text' && b.text).map((b: any) => String(b.text)).join(' ')
        if (text) lastText.set(agentId, clip(text))
      }
      if (t === 'assistant' || t === 'user' || t === 'stream_event') waits.delete(agentId)
      return null
    },
    /** Waits of chats still running, oldest first. */
    pending(liveAgentIds: Iterable<string>): AgentWait[] {
      const live = new Set(liveAgentIds)
      return [...waits.values()].filter(w => live.has(w.agentId)).sort((a, b) => a.since - b.since)
    },
    clear(agentId: string) { waits.delete(agentId) }
  }
}

export type AgentWatch = ReturnType<typeof createAgentWatch>

/** The notification an agent wait raises. */
export function agentWaitEvent(w: AgentWait, agentName: string): NotifyEvent {
  const target: NotifyTarget = { kind: 'agent', agentId: w.agentId }
  if (w.state === 'permission') return { kind: 'agentPermission', key: `perm:${w.agentId}`, title: `${agentName} asks permission`, body: w.text, target }
  if (w.state === 'question') return { kind: 'agentWaiting', key: `wait:${w.agentId}`, title: `${agentName} asks you`, body: w.text, target }
  return { kind: 'agentWaiting', key: `wait:${w.agentId}`, title: `${agentName} is waiting for you`, body: w.text || 'Turn finished', target }
}
