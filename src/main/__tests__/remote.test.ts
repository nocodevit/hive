import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request } from 'http'
import { createApprovals } from '../approvals'
import { createRemote, detectError, parseStatus, resolvePeer, checkInbound, REMOTE_KIND, type TsStatus } from '../remote'
import { parseRemoteButlerText, remoteButlerText } from '../../shared/remote-message'

const dirs: string[] = []
const remotes: Array<{ close: () => void }> = []
afterEach(() => {
  for (const r of remotes.splice(0)) r.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'hive-remote-')); dirs.push(d); return d }
const freePort = () => 40000 + Math.floor(Math.random() * 20000)

const running = (peers: TsStatus['peers'], selfIp = '100.64.0.1'): TsStatus => ({ installed: true, state: 'Running', selfIp, selfName: 'me-mac', peers })
const peer = (id: string, name: string, ips = ['127.0.0.1'], login = `${name}@x.com`) => ({ id, name, ips, login, userName: name, online: true, os: 'macOS' })

function make(opts: { status: TsStatus | (() => TsStatus); port?: number; settings?: object; butlerLive?: boolean }) {
  const dir = tmp()
  if (opts.settings) writeFileSync(join(dir, 'remote.json'), JSON.stringify(opts.settings))
  const approvals = createApprovals({ dir })
  const toButler = vi.fn((_t: string) => (opts.butlerLive === false ? { ok: false, error: 'no_session' } : { ok: true }))
  const chatEvent = vi.fn()
  const statusFn = vi.fn(async () => (typeof opts.status === 'function' ? opts.status() : opts.status))
  const remote = createRemote({ dataDir: dir, approvals, toButler, chatEvent, status: statusFn, bindHost: () => '127.0.0.1' })
  remotes.push(remote)
  return { remote, approvals, toButler, chatEvent, statusFn }
}

function postRaw(port: number, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request({ host: '127.0.0.1', port, path: '/remote/v1/message', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b || '{}') }))
    })
    req.on('error', reject)
    req.end(data)
  })
}

describe('parseStatus', () => {
  it('maps devices to their stable id, name, addresses and owner', () => {
    const st = parseStatus({
      BackendState: 'Running', TailscaleIPs: ['100.64.0.1', 'fd7a::1'],
      Self: { HostName: 'me-mac', UserID: 1 },
      User: { 1: { LoginName: 'me@x.com', DisplayName: 'Me' }, 2: { LoginName: 'wang@x.com', DisplayName: 'Wang' } },
      Peer: { k1: { ID: 'nW', HostName: 'wang-mbp', TailscaleIPs: ['100.64.0.2'], UserID: 2, Online: true, OS: 'macOS' } }
    })
    expect(st).toMatchObject({ installed: true, state: 'Running', selfIp: '100.64.0.1', selfName: 'me-mac', selfLogin: 'me@x.com' })
    expect(st.peers).toEqual([{ id: 'nW', name: 'wang-mbp', ips: ['100.64.0.2'], login: 'wang@x.com', userName: 'Wang', online: true, os: 'macOS' }])
  })

  it('an unreadable status gives no devices instead of throwing', () => {
    expect(parseStatus(null).peers).toEqual([])
  })
})

describe('detectError — Remote can only be turned on with Tailscale installed and connected', () => {
  it('names what is missing', () => {
    expect(detectError({ installed: false, state: 'Missing', peers: [] })).toBe('tailscale_missing')
    expect(detectError({ installed: true, state: 'Stopped', peers: [] })).toBe('tailscale_not_connected')
    expect(detectError({ installed: true, state: 'NeedsLogin', peers: [] })).toBe('tailscale_not_connected')
    expect(detectError(running([]))).toBeNull()
  })
})

describe('turning Remote on', () => {
  it('does not look at Tailscale while Remote is off', () => {
    const { remote, statusFn } = make({ status: running([]) })
    remote.view()
    expect(statusFn).not.toHaveBeenCalled()
  })

  it('stays off and says why when Tailscale is not installed', async () => {
    const { remote } = make({ status: { installed: false, state: 'Missing', peers: [] } })
    const r = await remote.setEnabled(true)
    expect(r).toMatchObject({ ok: false, error: 'tailscale_missing' })
    expect(r.view.enabled).toBe(false)
    expect(remote.settings().enabled).toBe(false)
  })

  it('stays off when Tailscale is stopped', async () => {
    const { remote } = make({ status: { installed: true, state: 'Stopped', peers: [] } })
    expect(await remote.setEnabled(true)).toMatchObject({ ok: false, error: 'tailscale_not_connected' })
    expect(remote.settings().enabled).toBe(false)
  })

  it('turns on and listens when Tailscale is connected', async () => {
    const port = freePort()
    const { remote } = make({ status: running([]), settings: { port } })
    const r = await remote.setEnabled(true)
    expect(r.ok).toBe(true)
    expect(r.view).toMatchObject({ enabled: true, listening: true, address: `127.0.0.1:${port}` })
  })
})

describe('resolvePeer — exact names on the allow list only', () => {
  const settings = { enabled: true, peers: { nW: { name: '小王', login: 'wang@x.com', mode: 'ask' as const }, nL: { name: 'Lin', login: 'lin@x.com', mode: 'ask' as const } } }
  const peers = [peer('nW', 'wang-mbp'), peer('nL', 'lin-mbp'), peer('nX', 'stranger')]
  it('by saved name, device name or login', () => {
    expect(resolvePeer(settings, peers, '小王')).toMatchObject({ ok: true, peer: { id: 'nW' } })
    expect(resolvePeer(settings, peers, 'LIN-MBP')).toMatchObject({ ok: true, peer: { id: 'nL' } })
    expect(resolvePeer(settings, peers, 'lin@x.com')).toMatchObject({ ok: true, peer: { id: 'nL' } })
  })
  it('no partial matches, and devices not on the list are never reachable', () => {
    expect(resolvePeer(settings, peers, '王')).toMatchObject({ ok: false, error: 'no_such_peer' })
    expect(resolvePeer(settings, peers, 'stranger')).toMatchObject({ ok: false, error: 'no_such_peer' })
  })
})

describe('checkInbound', () => {
  const settings = { enabled: true, peers: { nW: { name: '小王', login: 'wang@x.com', mode: 'ask' as const } } }
  const st = running([peer('nW', 'wang-mbp', ['100.64.0.2']), peer('nX', 'stranger', ['100.64.0.9'])])
  it('knows the sender by the address the request came from, not by what it says', () => {
    const c = checkInbound({ addr: '::ffff:100.64.0.2', body: { text: 'hi', from: 'Lin' } }, st, settings)
    expect(c).toMatchObject({ ok: true, peer: { id: 'nW' }, allowed: { name: '小王' }, text: 'hi' })
  })
  it('refuses devices not on the list, unknown addresses, browsers and empty text', () => {
    expect(checkInbound({ addr: '100.64.0.9', body: { text: 'hi' } }, st, settings)).toMatchObject({ ok: false, status: 403, error: 'not_allowed' })
    expect(checkInbound({ addr: '10.0.0.5', body: { text: 'hi' } }, st, settings)).toMatchObject({ ok: false, status: 403, error: 'unknown_device' })
    expect(checkInbound({ addr: '100.64.0.2', origin: 'https://evil.example', body: { text: 'hi' } }, st, settings)).toMatchObject({ ok: false, status: 403 })
    expect(checkInbound({ addr: '100.64.0.2', body: { text: '  ' } }, st, settings)).toMatchObject({ ok: false, status: 400 })
  })
})

describe('incoming messages over HTTP', () => {
  async function on(mode: 'ask' | 'auto', butlerLive = true, allowed = true) {
    const port = freePort()
    const h = make({ status: running([peer('nW', 'wang-mbp')]), butlerLive, settings: { port, peers: allowed ? { nW: { name: '小王', login: 'wang@x.com', mode } } : {} } })
    expect((await h.remote.setEnabled(true)).ok).toBe(true)
    return { ...h, port }
  }

  it('ask first: becomes an Approve card and a card in the Butler chat; Butler gets nothing until the owner gives it', async () => {
    const h = await on('ask')
    const r = await postRaw(h.port, { text: '明天发布还按计划吗？' })
    expect(r).toMatchObject({ status: 200, json: { delivered: 'card' } })
    expect(h.toButler).not.toHaveBeenCalled()
    const card = h.approvals.pending()[0]
    expect(card).toMatchObject({ kind: REMOTE_KIND, action: 'Give to Butler', title: '小王 · 明天发布还按计划吗？' })
    expect(h.chatEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'in', peerName: '小王', text: '明天发布还按计划吗？', cardId: card.id }))
    expect((await h.approvals.approve(card.id)).ok).toBe(true)
    expect(h.toButler).toHaveBeenCalledTimes(1)
    expect(parseRemoteButlerText(h.toButler.mock.calls[0][0])).toEqual({ peerName: '小王', login: 'wang-mbp@x.com', device: 'wang-mbp', text: '明天发布还按计划吗？' })
  })

  it('straight to Butler: goes into the Butler chat, no card', async () => {
    const h = await on('auto')
    const r = await postRaw(h.port, { text: 'ping' })
    expect(r.json.delivered).toBe('butler')
    expect(h.toButler).toHaveBeenCalledTimes(1)
    expect(h.approvals.pending()).toHaveLength(0)
    expect(h.remote.view().log[0]).toMatchObject({ dir: 'in', peerName: '小王', result: 'butler' })
  })

  it('straight to Butler but Butler is off: kept as a card, never lost', async () => {
    const h = await on('auto', false)
    expect((await postRaw(h.port, { text: 'ping' })).json.delivered).toBe('card')
    expect(h.approvals.pending()).toHaveLength(1)
  })

  it('a device that is not on the list is refused and leaves nothing', async () => {
    const h = await on('ask', true, false)
    expect((await postRaw(h.port, { text: 'hi' })).status).toBe(403)
    expect(h.approvals.pending()).toHaveLength(0)
    expect(h.toButler).not.toHaveBeenCalled()
  })

  it('a request from a browser (Origin header) is refused', async () => {
    const h = await on('auto')
    expect((await postRaw(h.port, { text: 'hi' }, { Origin: 'https://evil.example' })).status).toBe(403)
    expect(h.toButler).not.toHaveBeenCalled()
  })
})

describe('two Hives talking (both on 127.0.0.1, different ports)', () => {
  async function pair(bAllowsA: boolean) {
    const pa = freePort(), pb = freePort()
    const a = make({ status: running([peer('nB', 'b-mac')]), settings: { port: pa, peers: { nB: { name: 'Bee', login: 'b@x.com', mode: 'ask', port: pb } } } })
    const b = make({ status: running([peer('nA', 'a-mac')]), settings: { port: pb, peers: bAllowsA ? { nA: { name: 'Ann', login: 'a@x.com', mode: 'auto', port: pa } } : {} } })
    await a.remote.setEnabled(true)
    await b.remote.setEnabled(true)
    return { a, b }
  }

  it('A sends, B (straight to Butler) gets it in its Butler chat; A shows the sent card', async () => {
    const { a, b } = await pair(true)
    const r = await a.remote.send('Bee', '你好')
    expect(r).toMatchObject({ ok: true, peer: 'Bee', delivered: 'butler' })
    expect(parseRemoteButlerText(b.toButler.mock.calls[0][0])).toMatchObject({ peerName: 'Ann', text: '你好' })
    expect(a.chatEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'out', peerName: 'Bee', text: '你好', ok: true }))
  })

  it('B has not added A: A is told so', async () => {
    const { a } = await pair(false)
    expect(await a.remote.send('Bee', '你好')).toMatchObject({ ok: false, error: 'not_allowed_by_them' })
  })

  it('B turned Remote off: A is told their Remote is off', async () => {
    const { a, b } = await pair(true)
    await b.remote.setEnabled(false)
    expect(await a.remote.send('Bee', '你好')).toMatchObject({ ok: false, error: 'their_remote_off' })
  })

  it('cannot send to someone not on my own list', async () => {
    const { a } = await pair(true)
    expect(await a.remote.send('Stranger', 'hi')).toMatchObject({ ok: false, error: 'no_such_peer' })
  })
})

describe('remote message text', () => {
  it('round-trips, and plain user text is not mistaken for a remote message', () => {
    const t = remoteButlerText('小王', 'wang@x.com', 'wang-mbp', '第一行\n第二行')
    expect(parseRemoteButlerText(t)).toEqual({ peerName: '小王', login: 'wang@x.com', device: 'wang-mbp', text: '第一行\n第二行' })
    expect(parseRemoteButlerText('[Remote · from me] hi')).toBeNull()
  })
})
