// Worker thread: reads past chat sessions (big JSONL files) off the main
// process, so opening chats never freezes the window.
import { parentPort } from 'worker_threads'
import { getPrevSessionInfo, getRecentSessions } from './chat-recent-sessions'

parentPort?.on('message', (m: { id: number; fn: 'prev' | 'recent'; args: any[] }) => {
  try {
    const result = m.fn === 'prev' ? getPrevSessionInfo(m.args[0], m.args[1]) : getRecentSessions(m.args[0], m.args[1])
    parentPort!.postMessage({ id: m.id, ok: true, result })
  } catch (e) {
    parentPort!.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
