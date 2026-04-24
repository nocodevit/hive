import { useEffect, useRef, useState } from 'react'
import { CRUSH, FONT_MONO } from './crush-styles'
import { TimelineRow } from './renderers'
import type { ContentBlock, StreamEvent, TimelineEntry } from './types'

interface Props {
  id: string
  cwd?: string
  agent?: string
  agentName?: string
  visible: boolean
}

/**
 * HiveChat — Crush-flavored structured chat UI driven by
 * `claude --print --output-format stream-json`. The main process spawns
 * one claude subprocess per chat session and streams JSON events to us.
 * We flatten those into a TimelineEntry list and render each entry with
 * a Crush-styled component.
 */
export default function HiveChat({ id, cwd, agent, agentName, visible }: Props) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [exited, setExited] = useState<number | null>(null)
  const [stderr, setStderr] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const entryIdRef = useRef(0)

  const addEntry = (entry: Omit<TimelineEntry, 'id'> & { id?: string }) => {
    const id = entry.id || `e${entryIdRef.current++}`
    setTimeline(prev => [...prev, { ...entry, id } as TimelineEntry])
  }

  useEffect(() => {
    window.api.chat.start(id, { cwd, agent, name: agentName })

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
            replaceEntry(entryId, { kind: 'tool_call', name: block.name, input: block.input, id: entryId })
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

    return () => {
      offEv()
      offErr()
      offExit()
      window.api.chat.stop(id)
    }
  }, [id, cwd, agent, agentName])

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
      background: CRUSH.Pepper, color: CRUSH.Ash,
      fontFamily: FONT_MONO, fontSize: 13,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Timeline */}
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto',
        padding: '12px 16px',
        scrollBehavior: 'smooth'
      }}>
        {timeline.length === 0 && (
          <div style={{ color: CRUSH.Squid, fontSize: 12, padding: 12 }}>
            Chat session started. Type a message below to talk to Claude.
          </div>
        )}
        {timeline.map(entry => <TimelineRow key={entry.id} entry={entry} />)}
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
    </div>
  )
}
