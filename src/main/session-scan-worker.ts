// Worker-thread entry for session-scan.ts. Everything heavy (sync fs reads,
// JSON.parse of whole session logs) happens here, off the main thread.
import { parentPort } from 'node:worker_threads'
import { getPrevSessionInfo, getRecentSessions } from './chat-recent-sessions'
import type { ScanRequest, ScanResponse } from './session-scan'

const ops = {
  getPrevSessionInfo: (cwd: string, chatId?: string) => getPrevSessionInfo(cwd, chatId),
  getRecentSessions: (cwd: string, limit?: number) => getRecentSessions(cwd, limit ?? 5)
} as const

parentPort?.on('message', (req: ScanRequest) => {
  let res: ScanResponse
  try {
    const fn = ops[req.op] as (...a: unknown[]) => unknown
    if (!fn) throw new Error(`unknown op ${req.op}`)
    res = { id: req.id, ok: true, value: fn(...req.args) }
  } catch (e) {
    res = { id: req.id, ok: false, error: String((e as Error)?.message || e) }
  }
  parentPort!.postMessage(res)
})
