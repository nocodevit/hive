import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import RichTerminal from './RichTerminal'
import PrettyTerm from './PrettyTerm'

type ViewMode = 'raw' | 'pretty' | 'rich' | 'compare'

interface TerminalProps {
  id: string
  agentId: string
  agentName: string  // for claude --agent hive-{agentId}
  cwd?: string
  visible: boolean
  autoRunClaude?: boolean
  continueSession?: boolean
  startupCommand?: string
  rebaseOnStart?: boolean
}

export default function Terminal({ id, agentId, agentName, cwd, visible, autoRunClaude, continueSession, startupCommand, rebaseOnStart }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyReady = useRef(false)
  const isAtBottom = useRef(true)
  const visibleRef = useRef(visible)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [mode, setMode] = useState<ViewMode>('raw')
  const richMode = mode === 'rich'
  const compareMode = mode === 'compare'
  const prettyMode = mode === 'pretty'
  const [richLines, setRichLines] = useState<string[]>([])
  const richLinesRef = useRef<string[]>([])
  const [interactivePrompt, setInteractivePrompt] = useState<{ type: 'menu' | 'confirm' | 'input'; title: string; options: { label: string; value: string }[] } | null>(null)
  const ptyBufferRef = useRef('')

  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Noto Mono for Powerline", "MesloLGS NF", Menlo, Monaco, monospace',
      theme: {
        background: '#201F26',
        foreground: '#DFDBDD',
        cursor: '#FF60FF',
        cursorAccent: '#201F26',
        selectionBackground: 'rgba(107,80,255,0.3)',
        selectionForeground: '#FFFAF1',
        black: '#201F26',
        red: '#EB4268',
        green: '#00FFB2',
        yellow: '#E8FE96',
        blue: '#00A4FF',
        magenta: '#FF60FF',
        cyan: '#68FFD6',
        white: '#DFDBDD',
        brightBlack: '#605F6B',
        brightRed: '#FF577D',
        brightGreen: '#68FFD6',
        brightYellow: '#FFFAF1',
        brightBlue: '#4FBEFE',
        brightMagenta: '#FF84FF',
        brightCyan: '#5CDFEA',
        brightWhite: '#F1EFEF'
      }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    // Intercept paste: convert file paste to path instead of image (capture phase to beat xterm)
    const pasteHandler = (ev: Event) => {
      if (!el.contains(document.activeElement)) return
      const ce = ev as ClipboardEvent
      console.log('[Terminal] paste event:', {
        hasFiles: !!ce.clipboardData?.files.length,
        filesCount: ce.clipboardData?.files.length,
        types: ce.clipboardData?.types,
        items: Array.from(ce.clipboardData?.items || []).map(i => ({ kind: i.kind, type: i.type }))
      })
      if (ce.clipboardData?.files.length) {
        const files = Array.from(ce.clipboardData.files)
        console.log('[Terminal] paste files:', files.map(f => ({ name: f.name, type: f.type, size: f.size, path: window.api.getFilePath(f) })))
        const paths = files.map((f) => window.api.getFilePath(f)).filter(Boolean) as string[]
        if (paths.length > 0) {
          ce.preventDefault()
          ce.stopPropagation()
          console.log('[Terminal] paste writing paths:', paths)
          window.api.pty.write(id, paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' '))
          return
        }
      }
    }
    document.addEventListener('paste', pasteHandler, true) // capture phase


    // Track scroll position
    const checkScroll = () => {
      const buffer = term.buffer.active
      const atBottom = buffer.viewportY >= buffer.baseY
      isAtBottom.current = atBottom
      setShowScrollDown(!atBottom)
    }
    term.onScroll(checkScroll)

    setTimeout(() => {
      // Attach viewport scroll listener after xterm fully renders
      const viewport = el.querySelector('.xterm-viewport')
      if (viewport) {
        viewport.addEventListener('scroll', checkScroll)
        console.log('[Terminal] viewport scroll listener attached')
      } else {
        console.warn('[Terminal] .xterm-viewport not found')
      }
      try { fit.fit() } catch {}

      if (!ptyReady.current) {
        ptyReady.current = true

        window.api.pty.create(id, cwd)
          .then(() => {
            window.api.pty.onData(id, (data) => {
              term.write(data)
              if (visibleRef.current && isAtBottom.current) term.scrollToBottom()
              // Capture lines for Rich mode
              const newLines = data.split('\n')
              richLinesRef.current = [...richLinesRef.current.slice(-500), ...newLines]
              setRichLines([...richLinesRef.current])
              // Detect interactive prompts
              ptyBufferRef.current = (ptyBufferRef.current + data).slice(-2000)
              const buf = ptyBufferRef.current.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '')
              // Menu: "❯ 1. Option A\n  2. Option B\n  3. Option C"
              const menuMatch = buf.match(/(?:❯\s*)?(\d+)\.\s+(.+?)(?:\s*\(recommended\))?\n\s+(\d+)\.\s+(.+?)(?:\n\s+(\d+)\.\s+(.+?))?(?:\n|$)/)
              if (menuMatch && !interactivePrompt) {
                const options: { label: string; value: string }[] = []
                if (menuMatch[1] && menuMatch[2]) options.push({ label: menuMatch[2].trim(), value: menuMatch[1] })
                if (menuMatch[3] && menuMatch[4]) options.push({ label: menuMatch[4].trim(), value: menuMatch[3] })
                if (menuMatch[5] && menuMatch[6]) options.push({ label: menuMatch[6].trim(), value: menuMatch[5] })
                if (options.length >= 2) {
                  // Extract title from lines before menu
                  const lines = buf.split('\n')
                  const menuIdx = lines.findIndex(l => /❯\s*\d+\./.test(l) || /^\s*1\./.test(l))
                  const title = menuIdx > 0 ? lines.slice(Math.max(0, menuIdx - 3), menuIdx).join(' ').trim() : ''
                  setInteractivePrompt({ type: 'menu', title, options })
                  ptyBufferRef.current = ''
                }
              }
              // Confirm: "Y/n" or "[Y/n]"
              if (/\[?Y\/n\]?\s*[>❯]?\s*$/.test(buf) && !interactivePrompt) {
                setInteractivePrompt({
                  type: 'confirm',
                  title: buf.split('\n').filter(l => l.trim()).slice(-3).join(' ').replace(/\[?Y\/n\]?\s*[>❯]?\s*$/, '').trim(),
                  options: [{ label: 'Yes', value: 'Y' }, { label: 'No', value: 'N' }]
                })
                ptyBufferRef.current = ''
              }
            })

            window.api.pty.onExit(id, () => {
              term.write('\r\n[Process exited]\r\n')
            })

            term.onData((data) => {
              window.api.pty.write(id, data)
            })

            term.onResize(({ cols, rows }) => {
              window.api.pty.resize(id, cols, rows)
            })

            const dims = fit.proposeDimensions()
            if (dims) {
              window.api.pty.resize(id, dims.cols, dims.rows)
            }

            // Auto-run claude with native --agent flag
            if (startupCommand) {
              setTimeout(() => window.api.pty.write(id, startupCommand + '\r'), 500)
            } else if (autoRunClaude) {
              const agent = `hive-${agentId}`
              const base = `claude --agent ${agent} -n "${agentName}"`
              const claudeCmd = continueSession ? `${base} -c` : base
              if (rebaseOnStart) {
                // Detect base branch: prefer develop > main > master, only if remote tracking exists
                const rebaseCmd = `git fetch origin 2>/dev/null && BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && [ -n "$BASE" ] && echo "⏳ Rebasing from origin/$BASE..." && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"`
                setTimeout(() => window.api.pty.write(id, `${rebaseCmd} && ${claudeCmd}\r`), 500)
              } else {
                setTimeout(() => window.api.pty.write(id, claudeCmd + '\r'), 500)
              }
            }
          })
          .catch((err) => {
            term.write(`\r\nError: ${err}\r\n`)
          })
      }
    }, 200)

    const observer = new ResizeObserver(() => {
      try { fit.fit() } catch {}
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [id, cwd])

  useEffect(() => {
    visibleRef.current = visible
    if (visible && fitRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit() } catch {}
      }, 100)
    }
  }, [visible])

  // Speech transcript → write to PTY
  useEffect(() => {
    const remove = window.api.speech.onTranscript((line: string) => {
      if (visible && line.trim()) {
        window.api.pty.write(id, line.trim())
      }
    })
    return remove
  }, [id, visible])

  useEffect(() => {
    return () => {
      termRef.current?.dispose()
      termRef.current = null
      window.api.pty.kill(id)
    }
  }, [id])

  const scrollToBottom = () => {
    termRef.current?.scrollToBottom()
    isAtBottom.current = true
    setShowScrollDown(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.api.getFilePath(f))
        .filter(Boolean) as string[]
      if (paths.length > 0) {
        window.api.pty.write(id, paths.map((p) => p.includes(' ') ? `"${p}"` : p).join(' '))
        return
      }
    }
    const text = e.dataTransfer.getData('text/plain')
    if (text) window.api.pty.write(id, text)
  }

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'visible' }}>
      {/* Mode toggle */}
      {visible && (
        <div className="absolute top-2 right-2 z-[9999] flex items-center gap-0">
          <button
            onClick={() => setMode('raw')}
            className={`px-2 py-1 rounded-l-md text-[10px] font-mono cursor-pointer transition-colors border ${
              mode === 'raw' ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-muted hover:text-text-primary border-border'
            }`}
          >Raw</button>
          <button
            onClick={() => setMode('pretty')}
            className={`px-2 py-1 text-[10px] font-mono cursor-pointer transition-colors border -ml-px ${
              mode === 'pretty' ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-muted hover:text-text-primary border-border'
            }`}
          >Pretty</button>
          <button
            onClick={() => setMode('compare')}
            className={`px-2 py-1 rounded-r-md text-[10px] font-mono cursor-pointer transition-colors border -ml-px ${
              mode === 'compare' ? 'bg-accent text-white border-accent' : 'bg-bg-secondary text-text-muted hover:text-text-primary border-border'
            }`}
          >Compare</button>
        </div>
      )}
      {/* xterm.js — stays mounted in every mode (PTY consumer + Raw/Compare renderer).
          In Pretty mode it's hidden offscreen so the session isn't torn down. */}
      <div
        ref={containerRef}
        data-terminal-id={id}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: compareMode ? '50%' : '100%',
          height: '100%', minHeight: '200px',
          visibility: visible && !prettyMode ? 'visible' : 'hidden',
          position: visible && !prettyMode ? 'relative' : 'absolute',
          pointerEvents: visible && !prettyMode ? 'auto' : 'none',
          borderRight: compareMode ? '1px solid #3A3943' : 'none',
          transition: 'width 0.15s ease',
          top: prettyMode ? -9999 : 0,
          left: prettyMode ? -9999 : 0
        }}
      />
      {/* PrettyTerm — full viewport in pretty mode, right half in compare mode */}
      {(prettyMode || compareMode) && visible && (
        <div style={{
          position: 'absolute',
          top: 0, bottom: 0,
          right: 0,
          width: compareMode ? '50%' : '100%',
          background: '#201F26',
          overflow: 'hidden'
        }}>
          {compareMode && (
            <div style={{
              position: 'absolute', top: 6, left: 10,
              fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              color: '#858392', letterSpacing: '0.08em',
              textTransform: 'uppercase', zIndex: 5, pointerEvents: 'none'
            }}>Pretty (ours)</div>
          )}
          <PrettyTerm id={id} visible={visible} active={prettyMode || compareMode} />
        </div>
      )}
      {compareMode && visible && (
        <div style={{
          position: 'absolute', top: 6, left: 10,
          fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
          color: '#858392', letterSpacing: '0.08em',
          textTransform: 'uppercase', zIndex: 5, pointerEvents: 'none'
        }}>xterm.js</div>
      )}
      {/* Rich overlay — floats above xterm, only covers scrollback history, not active input area */}
      {richMode && visible && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 80,
          pointerEvents: 'auto', zIndex: 10,
          overflow: 'hidden'
        }}>
          <RichTerminal lines={richLines} visible={visible} />
        </div>
      )}
      {/* Voice input button */}
      {visible && (
        <button
          onClick={async () => {
            if (isRecording) {
              await window.api.speech.stop()
              setIsRecording(false)
            } else {
              setIsRecording(true)
              await window.api.speech.start()
            }
          }}
          className={`absolute bottom-4 left-4 w-9 h-9 rounded-full flex items-center justify-center shadow-lg cursor-pointer transition-all ${
            isRecording
              ? 'bg-red-500 animate-pulse'
              : 'bg-bg-secondary border border-border text-text-muted hover:text-text-primary hover:bg-bg-hover'
          }`}
          style={{ zIndex: 9999 }}
          title={isRecording ? 'Stop recording' : 'Voice input'}
        >
          {isRecording ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      )}
      {showScrollDown && visible && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 px-3 py-1.5 rounded-full bg-accent text-text-on-purple
            flex items-center gap-1.5 shadow-lg cursor-pointer
            hover:bg-accent-hover transition-colors"
          style={{ zIndex: 9999 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="text-[12px] font-medium">Bottom</span>
        </button>
      )}
      {/* Interactive prompt popup — Crush-style */}
      {interactivePrompt && visible && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 9999, background: 'rgba(32,31,38,0.85)', backdropFilter: 'blur(8px)' }}>
          <div style={{
            background: '#2D2C35',
            border: '2px solid #FF60FF',
            borderRadius: '16px',
            padding: '20px 24px',
            minWidth: '320px',
            maxWidth: '480px',
            boxShadow: '0 0 30px rgba(255,96,255,0.3), 0 0 60px rgba(107,80,255,0.2), 0 0 100px rgba(255,96,255,0.1)'
          }}>
            {interactivePrompt.title && (
              <p style={{ color: '#DFDBDD', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
                {interactivePrompt.title}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {interactivePrompt.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    window.api.pty.write(id, opt.value + '\r')
                    setInteractivePrompt(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 16px',
                    borderRadius: '10px',
                    border: i === 0 ? '2px solid #FF60FF' : '1px solid #3A3943',
                    background: i === 0 ? 'rgba(255,96,255,0.12)' : '#201F26',
                    color: i === 0 ? '#FFFAF1' : '#DFDBDD',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left' as const,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#FF60FF'; e.currentTarget.style.background = 'rgba(255,96,255,0.15)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = i === 0 ? '#FF60FF' : '#3A3943'; e.currentTarget.style.background = i === 0 ? 'rgba(255,96,255,0.12)' : '#201F26' }}
                >
                  <span style={{ color: '#C259FF', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: '14px' }}>{opt.value}</span>
                  <span>{opt.label}</span>
                  {i === 0 && <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#858392' }}>recommended</span>}
                </button>
              ))}
            </div>
            <button
              onClick={() => setInteractivePrompt(null)}
              style={{
                marginTop: '12px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #3A3943',
                background: 'transparent',
                color: '#605F6B',
                cursor: 'pointer',
                fontSize: '11px',
                width: '100%'
              }}
            >Dismiss (use terminal directly)</button>
          </div>
        </div>
      )}
    </div>
  )
}
