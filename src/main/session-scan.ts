// Session lookups read whole JSONL files (claude's session + up to 50 Hive
// chat logs) and JSON.parse every line. Run on the main thread that froze the
// whole app — spinning cursor — for seconds on launch with chats left open.
// They now run in a worker thread; this is the main-side request/response
// client, kept free of Electron so it can be unit-tested with a fake worker.

export type ScanOp = 'getPrevSessionInfo' | 'getRecentSessions'

export interface ScanRequest { id: number; op: ScanOp; args: unknown[] }
export type ScanResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }

export interface WorkerLike {
  postMessage(msg: ScanRequest): void
  on(event: 'message', cb: (msg: ScanResponse) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  unref?(): void
}

export function createSessionScanClient(spawn: () => WorkerLike, timeoutMs = 30_000) {
  let worker: WorkerLike | null = null
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

  const failAll = (err: Error) => {
    pending.forEach(p => { clearTimeout(p.timer); p.reject(err) })
    pending.clear()
  }

  const ensure = (): WorkerLike => {
    if (worker) return worker
    const w = spawn()
    w.unref?.()
    w.on('message', (msg) => {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if ('error' in msg) p.reject(new Error(msg.error))
      else p.resolve(msg.value)
    })
    // A dead worker fails its in-flight requests; the next call spawns a fresh one.
    w.on('error', (err) => { if (worker === w) worker = null; failAll(err) })
    w.on('exit', (code) => { if (worker === w) worker = null; failAll(new Error(`session-scan worker exited (${code})`)) })
    worker = w
    return w
  }

  function call<T>(op: ScanOp, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`session-scan ${op} timed out`))
      }, timeoutMs)
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        ensure().postMessage({ id, op, args })
      } catch (e) {
        pending.delete(id)
        clearTimeout(timer)
        reject(e as Error)
      }
    })
  }

  return { call }
}
