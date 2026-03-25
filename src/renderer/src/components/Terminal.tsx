import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  id: string
  agentId: string
  agentName: string  // for claude --agent hive-{agentId}
  cwd?: string
  visible: boolean
  autoRunClaude?: boolean
  continueSession?: boolean
  startupCommand?: string
}

export default function Terminal({ id, agentId, agentName, cwd, visible, autoRunClaude, continueSession, startupCommand }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyReady = useRef(false)
  const isAtBottom = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Noto Mono for Powerline", "MesloLGS NF", Menlo, Monaco, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        selectionBackground: '#3f3f46'
      }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

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
              if (isAtBottom.current) term.scrollToBottom()
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
              // Use -c only if there's a previous session (avoid "No conversation found" error)
              const tryCmd = continueSession
                ? `claude --agent ${agent} -c -n "${agentName}" 2>/dev/null || claude --agent ${agent} -n "${agentName}"`
                : `claude --agent ${agent} -n "${agentName}"`
              setTimeout(() => window.api.pty.write(id, tryCmd + '\r'), 500)
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
    if (visible && fitRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit() } catch {}
      }, 100)
    }
  }, [visible])

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
    const path = e.dataTransfer.getData('text/plain')
    if (path) window.api.pty.write(id, path)
  }

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'visible' }}>
      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: '100%', height: '100%', minHeight: '200px',
          visibility: visible ? 'visible' : 'hidden',
          position: visible ? 'relative' : 'absolute',
          pointerEvents: visible ? 'auto' : 'none'
        }}
      />
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
          <span className="text-[11px] font-medium">Bottom</span>
        </button>
      )}
    </div>
  )
}
