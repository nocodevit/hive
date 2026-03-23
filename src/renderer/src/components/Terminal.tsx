import { useEffect, useRef } from 'react'
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
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyReady = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    console.log('[Terminal] Mounting terminal:', id, 'cwd:', cwd)

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

    console.log('[Terminal] xterm opened, container size:', el.clientWidth, 'x', el.clientHeight)

    // Delay fit + PTY creation to next frame so container has dimensions
    setTimeout(() => {
      try {
        fit.fit()
        console.log('[Terminal] fit done')
      } catch (e) {
        console.error('[Terminal] fit error:', e)
      }

      if (!ptyReady.current) {
        ptyReady.current = true
        console.log('[Terminal] Creating PTY...')

        window.api.pty.create(id, cwd)
          .then((result) => {
            console.log('[Terminal] PTY created:', result)

            window.api.pty.onData(id, (data) => {
              term.write(data)
              term.scrollToBottom()
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
                // Escape single quotes in prompt
                const escaped = jobPickupPrompt.replace(/'/g, "'\\''")
                cmd += ` --prompt '${escaped}'`
              }
              setTimeout(() => window.api.pty.write(id, cmd + '\r'), 500)
            }
          })
          .catch((err) => {
            console.error('[Terminal] PTY create failed:', err)
            term.write(`\r\nError: ${err}\r\n`)
          })
      }
    }, 200)

    const observer = new ResizeObserver(() => {
      try { fit.fit(); term.scrollToBottom() } catch {}
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [id, cwd])

  // Re-fit on visibility change
  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit(); termRef.current?.scrollToBottom() } catch {}
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const path = e.dataTransfer.getData('text/plain')
    if (path) window.api.pty.write(id, path)
  }

  return (
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
  )
}
