import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { ipcMain, BrowserWindow } from 'electron'

/**
 * Spawn a `claude --print --input-format stream-json --output-format stream-json`
 * subprocess per chat session. stdin accepts JSON user messages, stdout
 * emits JSON events that we forward to the renderer as-is.
 *
 * This is the "Hive Chat" data path — Pretty-mode decoration is suspended
 * and not used here. See docs/structured-events.md for the expected event
 * shapes once they're confirmed empirically.
 */

interface ChatSession {
  id: string
  child: ChildProcessWithoutNullStreams
  buffer: string
  startedAt: number
}

const sessions = new Map<string, ChatSession>()

function broadcast(event: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload)
  }
}

function parseJsonLines(buf: string, sessionId: string): { events: any[]; rest: string } {
  const events: any[] = []
  let rest = buf
  while (true) {
    const nl = rest.indexOf('\n')
    if (nl < 0) break
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch (e) {
      // Swallow parse errors but keep session alive. Real parse bugs will
      // surface in logs; we don't want a malformed frame to kill chat.
      console.warn(`[chat ${sessionId}] JSON parse fail:`, line.slice(0, 200))
    }
  }
  return { events, rest }
}

export function startChat(id: string, opts: { cwd?: string; agent?: string; name?: string } = {}) {
  if (sessions.has(id)) return
  const args = [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose'
  ]
  if (opts.agent) args.push('--agent', opts.agent)
  if (opts.name) args.push('-n', opts.name)

  const child = spawn('claude', args, {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const session: ChatSession = { id, child, buffer: '', startedAt: Date.now() }
  sessions.set(id, session)

  child.stdout.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf8')
    const { events, rest } = parseJsonLines(session.buffer, id)
    session.buffer = rest
    for (const ev of events) {
      broadcast(`chat:event:${id}`, ev)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    broadcast(`chat:stderr:${id}`, chunk.toString('utf8'))
  })
  child.on('exit', (code) => {
    broadcast(`chat:exit:${id}`, code)
    sessions.delete(id)
  })
  child.on('error', (err) => {
    broadcast(`chat:error:${id}`, String(err))
    sessions.delete(id)
  })
}

export function sendUserMessage(id: string, text: string) {
  const session = sessions.get(id)
  if (!session) return { ok: false, error: 'no_session' }
  // stream-json expects {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  const frame = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }]
    }
  }
  try {
    session.child.stdin.write(JSON.stringify(frame) + '\n')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function stopChat(id: string) {
  const session = sessions.get(id)
  if (!session) return
  try { session.child.kill() } catch {}
  sessions.delete(id)
}

export function registerChatIpc() {
  ipcMain.handle('chat:start', (_e, { id, cwd, agent, name }) => {
    startChat(id, { cwd, agent, name })
    return { ok: true }
  })
  ipcMain.handle('chat:send', (_e, { id, text }) => sendUserMessage(id, text))
  ipcMain.handle('chat:stop', (_e, { id }) => { stopChat(id); return { ok: true } })
}
