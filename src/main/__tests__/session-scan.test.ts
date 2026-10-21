import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createSessionScanClient, type ScanRequest, type WorkerLike } from '../session-scan'

class FakeWorker extends EventEmitter implements WorkerLike {
  sent: ScanRequest[] = []
  postMessage(msg: ScanRequest) { this.sent.push(msg) }
}

describe('createSessionScanClient', () => {
  it('resolves with the worker reply for the matching id', async () => {
    const w = new FakeWorker()
    const client = createSessionScanClient(() => w)
    const a = client.call('getPrevSessionInfo', '/p', 'chat-1')
    const b = client.call('getRecentSessions', '/p', 5)
    expect(w.sent.map(m => m.op)).toEqual(['getPrevSessionInfo', 'getRecentSessions'])
    w.emit('message', { id: w.sent[1].id, ok: true, value: ['s'] })
    w.emit('message', { id: w.sent[0].id, ok: true, value: null })
    await expect(a).resolves.toBeNull()
    await expect(b).resolves.toEqual(['s'])
  })

  it('rejects with the worker error', async () => {
    const w = new FakeWorker()
    const client = createSessionScanClient(() => w)
    const p = client.call('getRecentSessions', '/p')
    w.emit('message', { id: w.sent[0].id, ok: false, error: 'boom' })
    await expect(p).rejects.toThrow('boom')
  })

  it('fails in-flight calls when the worker dies and spawns a fresh one next time', async () => {
    const workers: FakeWorker[] = []
    const client = createSessionScanClient(() => { const w = new FakeWorker(); workers.push(w); return w })
    const p = client.call('getRecentSessions', '/p')
    workers[0].emit('exit', 1)
    await expect(p).rejects.toThrow('exited')
    const q = client.call('getRecentSessions', '/p')
    expect(workers).toHaveLength(2)
    workers[1].emit('message', { id: workers[1].sent[0].id, ok: true, value: [] })
    await expect(q).resolves.toEqual([])
  })

  it('times out a call the worker never answers', async () => {
    vi.useFakeTimers()
    try {
      const client = createSessionScanClient(() => new FakeWorker(), 1000)
      const p = client.call('getPrevSessionInfo', '/p')
      vi.advanceTimersByTime(1000)
      await expect(p).rejects.toThrow('timed out')
    } finally {
      vi.useRealTimers()
    }
  })
})
