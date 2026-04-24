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
    const offEv = window.api.chat.onEvent(id, (ev: StreamEvent) => {
      // Extract timeline entries from each event. Live events like
      // `stream_event` / `content_block_delta` are absorbed silently for
      // now — the POC focuses on complete message / tool_use / tool_result
      // events. Once we see real /tmp/claude-json.log we refine.
      if (ev.type === 'assistant' && 'message' in ev) {
        const content = (ev as any).message?.content as ContentBlock[] | undefined
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type === 'text') {
            addEntry({ kind: 'assistant', text: block.text, id: `a${entryIdRef.current++}` })
          } else if (block.type === 'tool_use') {
            addEntry({ kind: 'tool_call', name: block.name, input: block.input, id: block.id })
          }
        }
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
              addEntry({ kind: 'tool_result', toolUseId: block.tool_use_id, content: text, isError: block.is_error })
            }
          }
        }
      } else if (ev.type === 'system') {
        const sub = (ev as any).subtype
        if (sub && sub !== 'init') addEntry({ kind: 'system', text: `system: ${sub}` })
      } else if (ev.type === 'result') {
        const cost = (ev as any).total_cost_usd
        addEntry({ kind: 'system', text: cost != null ? `result · $${cost.toFixed(4)}` : `result` })
      }
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
