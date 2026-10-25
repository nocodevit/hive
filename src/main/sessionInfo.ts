// Past-session lookups for the chat start chooser, run on a worker thread
// (sessionInfoWorker.ts, built next to index.js). If the worker cannot start,
// the same (now cheap — head/tail reads) code runs in-process.
import { Worker } from 'worker_threads'
import { existsSync } from 'fs'
import { join } from 'path'
import { getPrevSessionInfo, getRecentSessions, type PrevSessionInfo, type RecentSession } from './chat-recent-sessions'

let worker: Worker | null = null
let broken = false
let seq = 0
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function start(): Worker | null {
  if (worker || broken) return worker
  const file = join(__dirname, 'sessionInfoWorker.js')
  if (!existsSync(file)) { broken = true; return null }
  try {
    const w = new Worker(file)
    w.unref()
    w.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = waiting.get(m.id)
      if (!p) return
      waiting.delete(m.id)
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error))
    })
    const fail = (e: unknown) => {
      console.log(`[sessionInfo] worker failed, reading in-process: ${e instanceof Error ? e.message : e}`)
      broken = true; worker = null
      for (const p of waiting.values()) p.reject(e instanceof Error ? e : new Error(String(e)))
      waiting.clear()
    }
    w.on('error', fail)
    w.on('exit', code => { if (code !== 0) fail(new Error(`session worker exited ${code}`)); worker = null })
    worker = w
    console.log('[sessionInfo] worker started')
    return w
  } catch (e) {
    console.log(`[sessionInfo] worker unavailable: ${e instanceof Error ? e.message : e}`)
    broken = true
    return null
  }
}

function call<T>(fn: 'prev' | 'recent', args: unknown[], local: () => T): Promise<T> {
  const w = start()
  if (!w) return Promise.resolve().then(local)
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, fn, args })
  }).catch(() => local())
}

export const prevSessionInfo = (cwd: string, chatId?: string): Promise<PrevSessionInfo | null> =>
  call('prev', [cwd, chatId], () => getPrevSessionInfo(cwd, chatId))
export const recentSessions = (cwd: string, limit = 5): Promise<RecentSession[]> =>
  call('recent', [cwd, limit], () => getRecentSessions(cwd, limit))
