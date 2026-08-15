import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, IMarker, IDecoration } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import RichTerminal from './RichTerminal'
import { crushifyColors } from '../lib/crushify-colors'
import HiveChat from './hive-chat'
import { shouldCheckAgentSession, buildTerminalClaudeCmd } from '../terminalAutoRun'

type ViewMode = 'raw' | 'pretty'

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
  onCloseTerminal?: () => void
}

export default function Terminal({ id, agentId, agentName, cwd, visible, autoRunClaude, continueSession, startupCommand, rebaseOnStart, onCloseTerminal }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyReady = useRef(false)
  // Bumped once the PTY's data/exit handlers are wired up, so the deferred
  // claude auto-run effect knows it's safe to write to the shell.
  const [ptyReadyTick, setPtyReadyTick] = useState(0)
  // True while a claude launch is mid-flight — between writing the command and
  // claude showing up in the process table — so a rapid Chat/Term toggle in
  // that window can't fire a second launch before the session check would see it.
  const launchInFlight = useRef(false)
  const isAtBottom = useRef(true)
  const visibleRef = useRef(visible)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  // Pretty-mode decoration path is suspended — runtime stays on Raw xterm.
  // See pretty-term/SUSPENDED.md for history. The decoration code below
  // remains compiled so it's trivial to re-enable, but the Pretty button
  // is removed from the UI and prettyModeRef is hard-wired false.
  const [mode, setMode] = useState<ViewMode>('raw')
  // v2.0.0: chat-only surface. xterm/PTY infrastructure stays mounted for
  // future features (handoff supervisor, deep-link tools) but no user-facing
  // Term/Chat toggle any more — HiveChat is the one and only visible surface.
  const chatMode = true
  const chatEverOpened = true
  const prettyMode = false
  const prettyModeRef = useRef(false)
  const richMode = false
  const compareMode = false
  const [richLines, setRichLines] = useState<string[]>([])
  const richLinesRef = useRef<string[]>([])
  // All user-input lines get Dolly decorations and KEEP them as history —
  // scrolled-up input lines stay visibly highlighted in scrollback.
  interface InputDeco { marker: IMarker; bg: IDecoration | undefined; prompt: IDecoration | undefined }
  const inputDecosRef = useRef<InputDeco[]>([])
  // Tool-call lines (⏺  ● Tool ...) get a Crush-style card overlay per row.
  interface ToolDeco { marker: IMarker; card: IDecoration | undefined }
  const toolDecosRef = useRef<ToolDeco[]>([])
  const updateDecorationsRef = useRef<() => void>(() => {})
  const [interactivePrompt, setInteractivePrompt] = useState<{ type: 'menu' | 'confirm' | 'input'; title: string; options: { label: string; value: string }[] } | null>(null)
  const ptyBufferRef = useRef('')

  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      allowProposedApi: true, // Unicode11Addon + decorations need this
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
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    /**
     * Pretty-mode overlays: xterm does the rendering, we layer Crush
     * decorations on top via registerMarker/registerDecoration. Markers
     * follow their buffer line through scrollback automatically.
     *
     * Every line that begins with `❯` gets decorated exactly once. After
     * the user hits Enter, the old input line keeps its highlight — this
     * way the whole history of user prompts stays visibly pink in the
     * scrollback, not just the active prompt.
     */
    const disposeAllInputDecorations = () => {
      for (const d of inputDecosRef.current) {
        d.bg?.dispose()
        d.prompt?.dispose()
        d.marker.dispose()
      }
      inputDecosRef.current = []
    }

    const decorateInputLine = (absY: number, promptCol: number) => {
      if (!termRef.current) return
      const t = termRef.current
      const cursorAbs = t.buffer.active.baseY + t.buffer.active.cursorY
      const offset = absY - cursorAbs
      const marker = t.registerMarker(offset)
      if (!marker) return

      // Single top-layer decoration that fully covers the prompt row from
      // column `promptCol` through end. Solid Dolly bg occludes whatever
      // xterm drew beneath, and we re-render the row's content on top
      // (green ❯, then the user-typed text in Butter). onRender fires
      // whenever xterm re-draws this region, so the content stays live.
      const bg = t.registerDecoration({
        marker,
        x: promptCol,
        width: Math.max(1, t.cols - promptCol),
        height: 1,
        layer: 'top'
      })
      bg?.onRender((el: HTMLElement) => {
        // Re-read the line's current text so typing reflects live.
        const line = t.buffer.active.getLine(marker.line)
        const text = line?.translateToString(true) ?? ''
        const afterPrompt = text.slice(promptCol + 1).replace(/^\s+/, '') // skip ❯ + the space

        el.style.background = '#FF60FF'       // Solid Dolly
        el.style.borderLeft = '2px solid #6B50FF' // Charple accent
        el.style.boxSizing = 'border-box'
        el.style.padding = '0 4px'
        el.style.pointerEvents = 'none'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.gap = '6px'
        el.style.fontFamily = t.options.fontFamily || 'monospace'
        el.style.fontSize = `${t.options.fontSize ?? 13}px`
        el.style.overflow = 'hidden'
        el.style.whiteSpace = 'nowrap'
        el.innerHTML = `
          <span style="color:#00FFB2;font-weight:700;background:transparent;">❯</span>
          <span style="color:#FFFAF1;font-weight:500;">${escapeHtml(afterPrompt)}</span>
        `
      })

      inputDecosRef.current.push({ marker, bg, prompt: undefined })
    }

    /**
     * Decorate the *current* active prompt line only. We debounce so we only
     * look when the cursor rests — while Claude is streaming output its
     * cursor tears through many lines including ones that happen to contain
     * `❯`, and we don't want to decorate those transient positions.
     */
    const updateInputDecorations = () => {
      if (!termRef.current) return
      if (!prettyModeRef.current) {
        disposeAllInputDecorations()
        return
      }
      const t = termRef.current
      const buf = t.buffer.active
      const absY = buf.baseY + buf.cursorY

      inputDecosRef.current = inputDecosRef.current.filter(d => !d.marker.isDisposed)
      if (inputDecosRef.current.some(d => d.marker.line === absY)) return

      const line = buf.getLine(absY)
      const text = line?.translateToString(false) ?? ''
      let promptCol = -1
      for (let c = 0; c < Math.min(text.length, 10); c++) {
        if (text[c] === '❯') { promptCol = c; break }
      }
      if (promptCol < 0) return
      // Only decorate if cursor is past `❯ ` — filters out streams just
      // passing through ❯-containing output lines.
      if (buf.cursorX <= promptCol + 1) return

      decorateInputLine(absY, promptCol)
    }

    // ─── Tool-call card decorations ─────────────────────────────────────
    // Crush colors keyed by tool name. Anything not listed falls back to
    // Charple accent.
    const TOOL_COLORS: Record<string, string> = {
      Read: '#68FFD6',       // Bok
      Edit: '#00FFB2',       // Julep
      Write: '#00FFB2',
      MultiEdit: '#00FFB2',
      Bash: '#00A4FF',       // Malibu
      BashOutput: '#00A4FF',
      Grep: '#E8FE96',       // Zest
      Glob: '#E8FE96',
      Agent: '#FF60FF',      // Dolly
      Task: '#FF60FF',
      TodoWrite: '#6B50FF',  // Charple
      WebFetch: '#C259FF',
      WebSearch: '#C259FF'
    }
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const disposeAllToolDecorations = () => {
      for (const d of toolDecosRef.current) {
        d.card?.dispose()
        d.marker.dispose()
      }
      toolDecosRef.current = []
    }

    const decorateToolLine = (absY: number, tool: string, args: string) => {
      if (!termRef.current) return
      const t = termRef.current
      const cursorAbs = t.buffer.active.baseY + t.buffer.active.cursorY
      const offset = absY - cursorAbs
      const marker = t.registerMarker(offset)
      if (!marker) return

      const card = t.registerDecoration({
        marker,
        x: 0,
        width: t.cols,
        height: 1,
        layer: 'top'
      })
      card?.onRender((el: HTMLElement) => {
        const color = TOOL_COLORS[tool] || '#6B50FF'
        el.style.background = '#201F26'
        el.style.borderLeft = '3px solid #6B50FF'
        el.style.boxSizing = 'border-box'
        el.style.padding = '0 6px'
        el.style.pointerEvents = 'none'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.gap = '8px'
        el.style.fontFamily = t.options.fontFamily || 'monospace'
        el.style.fontSize = `${t.options.fontSize ?? 13}px`
        el.style.whiteSpace = 'nowrap'
        el.style.overflow = 'hidden'
        el.innerHTML = `
          <span style="color:${color};font-weight:700;">●</span>
          <span style="color:${color};font-weight:700;">${escapeHtml(tool)}</span>
          <span style="color:#DFDBDD;opacity:0.75;">${escapeHtml(args)}</span>
        `
      })

      toolDecosRef.current.push({ marker, card })
    }

    const scanForToolCalls = () => {
      if (!termRef.current) return
      if (!prettyModeRef.current) { disposeAllToolDecorations(); return }
      const t = termRef.current
      const buf = t.buffer.active

      toolDecosRef.current = toolDecosRef.current.filter(d => !d.marker.isDisposed)
      const decorated = new Set(toolDecosRef.current.map(d => d.marker.line))

      // Scan current viewport. Tool lines match `  ● ToolName args...`
      const scanStart = buf.baseY
      const scanEnd = buf.baseY + t.rows
      for (let y = scanStart; y < scanEnd; y++) {
        if (decorated.has(y)) continue
        const line = buf.getLine(y)
        if (!line) continue
        const text = line.translateToString(true) ?? ''
        const m = text.match(/^\s*●\s+(\w+)(?:\s+(.*))?$/)
        if (!m) continue
        decorateToolLine(y, m[1], (m[2] ?? '').trim())
      }
    }

    let restTimer: number | null = null
    const scheduleUpdate = () => {
      if (restTimer != null) window.clearTimeout(restTimer)
      restTimer = window.setTimeout(() => {
        updateInputDecorations()
        scanForToolCalls()
      }, 120)
    }

    updateDecorationsRef.current = () => {
      updateInputDecorations()
      if (prettyModeRef.current) scanForToolCalls()
      else { disposeAllInputDecorations(); disposeAllToolDecorations() }
    }
    // Debounced — only fire after the cursor has settled for ~120ms so we
    // skip streaming movement through output lines.
    const offCursor = term.onCursorMove(scheduleUpdate)
    const offWriteParsed = term.onWriteParsed(scheduleUpdate)

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
              // Pretty path suspended — raw PTY bytes only.
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

            // startupCommand owns the boot path when present (custom command).
            if (startupCommand) {
              setTimeout(() => window.api.pty.write(id, startupCommand + '\r'), 500)
            }
            // The default `claude --agent` auto-run is NOT fired here. Chat is
            // the default view, so booting claude on mount spawned a second,
            // unused claude per agent (HiveChat already runs claude --print).
            // The deferred effect below launches it only when the user opens
            // the Term tab. Signal readiness so that effect can fire.
            setPtyReadyTick((t) => t + 1)
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
      offCursor.dispose()
      offWriteParsed.dispose()
      disposeAllInputDecorations()
      disposeAllToolDecorations()
    }
  }, [id, cwd])

  // Launch the agent's `claude --agent` session only when the user opens the
  // Term tab (chatMode === false) AND no session is already running there. Chat
  // is the default view and runs its own claude --print, so launching on mount
  // spawned a second, idle claude per agent — doubling memory on small machines.
  //
  // We don't track a "did we start one" flag; we ask the main process whether a
  // claude child is actually alive in this terminal's shell. So: first Term-open
  // creates it, later opens reuse it, and if it was exited, reopening recreates.
  useEffect(() => {
    if (!shouldCheckAgentSession({
      autoRunClaude: !!autoRunClaude,
      hasStartupCommand: !!startupCommand,
      chatMode,
      ptyReady: ptyReady.current,
      launching: launchInFlight.current
    })) return
    let cancelled = false
    launchInFlight.current = true
    ;(async () => {
      try {
        const res = await window.api.pty.hasAgentSession(id)
        // res.alive === false → no session, create one. On an error result
        // (ps hiccup) alive is false but res.error is set; skip launching to
        // avoid spawning a duplicate when we can't actually tell.
        if (!cancelled && res && res.alive === false && !res.error) {
          const cmd = buildTerminalClaudeCmd({ agentId, agentName, continueSession, rebaseOnStart })
          window.api.pty.write(id, cmd + '\r')
        }
      } catch {
        // IPC unreachable — do nothing; a later toggle will retry.
      } finally {
        // Hold the in-flight lock briefly so a freshly-spawned claude appears in
        // the process table before the next check could run.
        setTimeout(() => { launchInFlight.current = false }, 3000)
      }
    })()
    return () => { cancelled = true }
  }, [chatMode, ptyReadyTick, autoRunClaude, startupCommand, id, agentId, agentName, continueSession, rebaseOnStart])

  // Re-run decoration logic when the Pretty toggle flips.
  useEffect(() => {
    updateDecorationsRef.current()
  }, [prettyMode])

  useEffect(() => {
    visibleRef.current = visible
    if (visible && fitRef.current) {
      setTimeout(() => {
        try { fitRef.current?.fit() } catch {}
      }, 100)
    }
  }, [visible])

  // Voice input: App.tsx dispatches CustomEvent `hive:voice-final` per
  // matched agentId. We only consume it if (a) we're the visible
  // Terminal AND (b) the user is in xterm tab (chatMode === false).
  // Otherwise HiveChat takes the transcript via its own listener.
  // Old direct onTranscript listener was removed — it fought with the
  // mic button's PTY-write path and double-fed transcripts (with
  // `final:` prefix littering the terminal output).
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ agentId: string; text: string }>
      if (!ev.detail || ev.detail.agentId !== id) return
      if (visible && !chatMode && ev.detail.text.trim()) {
        window.api.pty.write(id, ev.detail.text.trim())
      }
    }
    window.addEventListener('hive:voice-final', handler)
    return () => window.removeEventListener('hive:voice-final', handler)
  }, [id, visible, chatMode])

  useEffect(() => {
    return () => {
      termRef.current?.dispose()
      termRef.current = null
      window.api.pty.kill(id)
    }
  }, [id])

  // In-place PTY respawn: App's "↻ Restart terminal" button now dispatches
  // `hive:pty-respawn` instead of unmounting/remounting Terminal. Unmounting
  // also tears down the HiveChat overlay (which was the actual symptom —
  // user sees the bg-primary white flash because activeTerminals briefly
  // has no entry for this id). In-place respawn keeps the chat session
  // running and just restarts the xterm side, which is the only part that
  // needs to re-read the (possibly rewritten) agent definition.
  useEffect(() => {
    const onRespawn = async (e: Event) => {
      const ev = e as CustomEvent<{ agentId: string }>
      if (ev.detail?.agentId !== agentId) return
      try { await window.api.pty.kill(id) } catch {}
      termRef.current?.clear()
      termRef.current?.write('\x1b[33m[restarting…]\x1b[0m\r\n')
      ptyReady.current = false
      // Re-run the same create + onData wiring done at mount.
      try {
        await window.api.pty.create(id, cwd)
        ptyReady.current = true
        const term = termRef.current
        const fit = fitRef.current
        if (!term) return
        window.api.pty.onData(id, (data) => {
          term.write(data)
          if (visibleRef.current && isAtBottom.current) term.scrollToBottom()
          const newLines = data.split('\n')
          richLinesRef.current = [...richLinesRef.current.slice(-500), ...newLines]
          setRichLines([...richLinesRef.current])
        })
        window.api.pty.onExit(id, () => term.write('\r\n[Process exited]\r\n'))
        if (fit) {
          const dims = fit.proposeDimensions()
          if (dims) window.api.pty.resize(id, dims.cols, dims.rows)
        }
        if (autoRunClaude) {
          const ag = `hive-${agentId}`
          const base = `claude --agent ${ag} -n "${agentName}"`
          const cmd = continueSession ? `${base} -c` : base
          setTimeout(() => window.api.pty.write(id, cmd + '\r'), 500)
        }
      } catch (err) {
        termRef.current?.write(`\r\nrespawn error: ${err}\r\n`)
      }
    }
    window.addEventListener('hive:pty-respawn', onRespawn as EventListener)
    return () => window.removeEventListener('hive:pty-respawn', onRespawn as EventListener)
  }, [id, agentId, cwd, autoRunClaude, agentName, continueSession])

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
      {/* v2.0.0: Term/Chat toggle removed. Chat is the only visible surface. */}

      {/* Hive Chat — sticky mount. Once opened for this Terminal, stays
          mounted so the underlying `claude --print` subprocess survives
          agent switches. Shown/hidden via CSS. */}
      {chatEverOpened && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 100,
          // Locked to deep-purple regardless of system/app theme. The Crush
          // palette (Charple/Dolly/Julep accents + Butter/Ash text) is
          // engineered for a dark base; on a light background the text
          // and high-saturation accents collapse into invisibility.
          background: '#150e24',  // matches --sidebar-bg dark mode
          visibility: (chatMode && visible) ? 'visible' : 'hidden',
          pointerEvents: (chatMode && visible) ? 'auto' : 'none'
        }}>
          <HiveChat
            id={`chat-${id}`}
            cwd={cwd}
            agent={agentName ? `hive-${agentId}` : undefined}
            agentName={agentName}
            continueSession={continueSession}
            rebaseOnStart={rebaseOnStart}
            visible={chatMode && visible}
            onCloseTerminal={onCloseTerminal}
          />
        </div>
      )}
      {/* xterm.js — the one and only renderer. Pretty mode layers decorations on top. */}
      <div
        ref={containerRef}
        data-terminal-id={id}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          width: '100%',
          height: '100%', minHeight: '200px',
          visibility: visible ? 'visible' : 'hidden',
          position: visible ? 'relative' : 'absolute',
          pointerEvents: visible ? 'auto' : 'none'
        }}
      />
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
