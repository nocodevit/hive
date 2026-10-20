import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createWakeController, readWakeSettings, type WakeEvent, type WakeDeps } from '../wakeController'
import type { AgentRow } from '../butlerApi'

const row = (agentId: string, agent: string, project: string, chatLive = true): AgentRow =>
  ({ agentId, agent, projectId: `p-${project}`, project, role: '', note: '', chatLive, activity: chatLive ? 'waiting' : 'off' })

describe('wake controller', () => {
  let dir: string
  let bin: string
  let events: WakeEvent[]
  let sent: Array<[string, string]>
  let removed: string[]
  let rows: AgentRow[]
  let live: Set<string>
  let dictating: boolean
  let helpers: Array<{ args: string[]; onLine: (l: string) => void; onExit: (expected: boolean, err: string) => void; stopped: boolean; killed: boolean }>
  let timers: Array<{ fn: () => void; ms: number }>
  let n: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-wake-'))
    bin = join(dir, 'hive-speech')
    writeFileSync(bin, '')
    events = []; sent = []; removed = []; helpers = []; timers = []; n = 0
    rows = [row('a1', 'Missy', 'Cube v2'), row('a3', 'Missy', 'Mobile'), row('a2', 'Quinn', 'Cube v2'), row('a4', 'Ada', 'Mobile', false)]
    live = new Set(['chat-butler'])
    dictating = false
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function make(over: Partial<WakeDeps> = {}) {
    return createWakeController({
      dir,
      helperPath: () => bin,
      resolveText: async a => a.fallback,
      rows: () => rows,
      isLive: id => live.has(id),
      sendMessage: (id, text) => { sent.push([id, text]); return { ok: true } },
      isDictating: () => dictating,
      emit: ev => events.push(ev),
      startHelper: (_b, args, hooks) => {
        const h = { args, ...hooks, stopped: false, killed: false }
        helpers.push(h)
        return { stop: async () => { h.stopped = true }, kill: () => { h.killed = true } }
      },
      removeFile: p => removed.push(p),
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
      clearTimer: () => {},
      newId: () => `p${++n}`,
      ...over
    })
  }
  const proposals = () => events.flatMap(e => (e.type === 'proposal' ? [e.proposal] : []))

  it('persists the switch in the butler folder and starts the helper in wake mode', () => {
    const w = make()
    expect(w.getState()).toEqual({ enabled: false, status: 'off' })
    w.setEnabled(true)
    expect(readWakeSettings(dir)).toEqual({ enabled: true })
    expect(JSON.parse(readFileSync(join(dir, 'wake.json'), 'utf8'))).toEqual({ enabled: true })
    expect(helpers).toHaveLength(1)
    expect(helpers[0].args).toEqual(['--wake'])
    expect(w.getState().status).toBe('starting')
    helpers[0].onLine('listening:')
    expect(w.getState()).toEqual({ enabled: true, status: 'listening' })
    w.setEnabled(false)
    expect(helpers[0].stopped).toBe(true)
    expect(readWakeSettings(dir)).toEqual({ enabled: false })
    expect(w.getState()).toEqual({ enabled: false, status: 'off' })
  })

  it('comes back at launch when left on, and is killed on quit', () => {
    make().setEnabled(true)
    const w = make()
    w.init()
    expect(helpers).toHaveLength(2)
    w.kill()
    expect(helpers[1].killed).toBe(true)
  })

  it('reports a missing helper binary', () => {
    const w = make({ helperPath: () => null })
    w.setEnabled(true)
    expect(w.getState()).toMatchObject({ status: 'error', error: 'voice helper not found' })
  })

  it('proposes a single running agent and sends only on confirm', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('wake:')
    helpers[0].onLine('command:/tmp/c.wav\t告诉 Quinn 继续做 e2e')
    await w.idle()
    expect(events.some(e => e.type === 'wake')).toBe(true)
    const [p] = proposals()
    expect(p.plan).toMatchObject({ kind: 'agent', row: { agentId: 'a2' }, text: '继续做 e2e' })
    expect(sent).toEqual([])
    expect(w.send(p.id)).toEqual({ ok: true, to: 'Quinn' })
    expect(sent).toEqual([['chat-a2', '继续做 e2e']])
    expect(w.send(p.id)).toEqual({ ok: false, error: 'unknown_proposal' })
  })

  it('uses the cloud text when there is one', async () => {
    const w = make({ resolveText: async () => 'Hola Butler, tell Quinn to rerun' })
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\tgarbled')
    await w.idle()
    expect(proposals()[0].plan).toMatchObject({ kind: 'agent', row: { agentId: 'a2' }, text: 'rerun' })
  })

  it('ambiguous: never sends without a pick, and only to a listed candidate', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\ttell Missy to go')
    await w.idle()
    const [p] = proposals()
    expect(p.plan.kind).toBe('ambiguous')
    expect(w.send(p.id)).toEqual({ ok: false, error: 'not_a_candidate' })
    expect(w.send(p.id, 'a2')).toEqual({ ok: false, error: 'not_a_candidate' })
    expect(sent).toEqual([])
    expect(w.send(p.id, 'a3')).toEqual({ ok: true, to: 'Missy' })
    expect(sent).toEqual([['chat-a3', 'go']])
  })

  it('not_found: nothing to send unless a candidate is picked', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\ttell Zed to go')
    await w.idle()
    const [p] = proposals()
    expect(p.plan).toMatchObject({ kind: 'not_found', name: 'Zed', candidates: [] })
    expect(w.send(p.id)).toEqual({ ok: false, error: 'not_a_candidate' })
    expect(sent).toEqual([])
  })

  it('no_session: refuses to send into a chat that is not running (rechecked at send time)', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\ttell Ada to go')
    helpers[0].onLine('command:/tmp/d.wav\ttell Quinn to go')
    await w.idle()
    const [p1, p2] = proposals()
    expect(p1.plan.kind).toBe('no_session')
    expect(w.send(p1.id)).toEqual({ ok: false, error: 'unknown_proposal' })
    rows = rows.map(r => (r.agentId === 'a2' ? { ...r, chatLive: false } : r))
    expect(w.send(p2.id)).toEqual({ ok: false, error: 'no_session' })
    expect(sent).toEqual([])
  })

  it('no target → the Butler chat, if it is running', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\t谁在跑')
    await w.idle()
    const [p] = proposals()
    expect(p.plan).toEqual({ kind: 'butler', live: true, text: '谁在跑' })
    live.clear()
    expect(w.send(p.id)).toEqual({ ok: false, error: 'no_session' })
    live.add('chat-butler')
    expect(w.send(p.id)).toEqual({ ok: true, to: 'Butler' })
    expect(sent).toEqual([['chat-butler', '谁在跑']])
  })

  it('cancel said by voice drops the pending proposal', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\ttell Quinn to go')
    await w.idle()
    const [p] = proposals()
    helpers[0].onLine('cancel:')
    expect(events.at(-1)).toEqual({ type: 'cancel' })
    expect(w.send(p.id)).toEqual({ ok: false, error: 'unknown_proposal' })
  })

  it('a command that is just "取消" cancels instead of being proposed', async () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onLine('command:/tmp/c.wav\t取消')
    await w.idle()
    expect(proposals()).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'cancel' })
  })

  it('ignores the wake word while dictating, and deletes the recording', async () => {
    const w = make()
    w.setEnabled(true)
    dictating = true
    helpers[0].onLine('wake:')
    helpers[0].onLine('command:/tmp/c.wav\ttell Quinn to go')
    await w.idle()
    expect(events.filter(e => e.type !== 'state')).toEqual([])
    expect(removed).toEqual(['/tmp/c.wav'])
  })

  it('restarts a helper that died after listening, not one that never started', () => {
    const w = make()
    w.setEnabled(true)
    helpers[0].onExit(false, 'speech recognition not allowed (status 1)')
    expect(w.getState()).toMatchObject({ status: 'error', error: 'speech recognition not allowed (status 1)' })
    expect(timers).toHaveLength(0)

    w.setEnabled(false); w.setEnabled(true)
    helpers[1].onLine('listening:')
    helpers[1].onExit(false, '')
    expect(timers.map(t => t.ms)).toEqual([5000])
    timers[0].fn()
    expect(helpers).toHaveLength(3)
  })
})
