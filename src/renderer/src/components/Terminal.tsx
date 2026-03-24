import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  id: string
  agentId: string
  cwd?: string
  visible: boolean
  autoRunClaude?: boolean
  startupCommand?: string
  jobPickupPrompt?: string | null
}

export default function Terminal({ id, agentId, cwd, visible, autoRunClaude, startupCommand, jobPickupPrompt }: TerminalProps) {
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
    term.onScroll(() => {
      const buffer = term.buffer.active
      const atBottom = buffer.viewportY >= buffer.baseY
      isAtBottom.current = atBottom
      setShowScrollDown(!atBottom)
    })

    // Delay fit + PTY creation
    setTimeout(() => {
      try { fit.fit() } catch {}

      if (!ptyReady.current) {
        ptyReady.current = true

        window.api.pty.create(id, cwd)
          .then((result) => {
            window.api.pty.onData(id, (data) => {
              term.write(data)
              // Only auto-scroll if user is already at bottom
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

            // Auto-run command after shell is ready
            if (startupCommand) {
              setTimeout(() => window.api.pty.write(id, startupCommand + '\r'), 500)
            } else if (autoRunClaude) {
              const soulPath = `~/.hive/souls/${agentId}.md`
              let cmd = `claude --append-system-prompt-file ${soulPath}`
              if (jobPickupPrompt) {
                const escaped = jobPickupPrompt.replace(/'/g, "'\\''")
                cmd += ` --prompt '${escaped}'`
              }
              setTimeout(() => window.api.pty.write(id, cmd + '\r'), 500)
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

  // Re-fit on visibility change
  useEffect(() => {
    if (visible && fitRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit() } catch {}
      }, 100)
    }
  }, [visible])

  // Cleanup on unmount
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
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <div
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '200px',
          visibility: visible ? 'visible' : 'hidden',
          position: visible ? 'relative' : 'absolute',
          pointerEvents: visible ? 'auto' : 'none'
        }}
      />
      {showScrollDown && visible && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-accent text-text-on-purple
            flex items-center justify-center shadow-lg cursor-pointer
            hover:bg-accent-hover transition-colors z-10"
          title="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  )
}
