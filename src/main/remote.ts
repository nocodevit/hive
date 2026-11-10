// Remote Butler (phase 1): this Hive's Butler talks to another person's
// Hive Butler over Tailscale. Nothing here reaches an agent directly:
//   in  — a message from a peer on the allow list goes to Butler (straight in,
//         or first as an Approve card, per peer). Butler treats it as what
//         that person said, never as the owner's instruction; work for an
//         agent still goes through ./hive assign (an Assign card).
//   out — ./hive remote send <peer> TEXT posts to that peer's Hive.
// Hive does not ship Tailscale. Only once the owner turns Remote on (Butler
// settings) does Hive run `tailscale status --json`: installed? connected?
// which devices are on the tailnet and who owns them. If that fails, Remote
// stays off and the owner is told why. The other Mac is found through
// Tailscale (its address) plus the port its Hive listens on. A sender is recognised by the Tailscale address the
// request comes from (WireGuard-authenticated), matched to the device's
// stable id — never by a name it claims.
//
// Settings: <data>/remote.json { enabled, port, peers: { <stableId>: { name, login, mode, port } } }
// Log:      <data>/remote-log.json, last 50 messages in and out.

import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { Approval } from './approvals'
import { remoteButlerText, type RemoteChatEvent } from '../shared/remote-message'

export const REMOTE_KIND = 'remote.message'
export const REMOTE_PORT = Number(process.env.HIVE_REMOTE_PORT) || 17731
const validPort = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1024 && (v as number) <= 65535 ? (v as number) : undefined)
export const MAX_TEXT = 4000
const LOG_KEEP = 50
const RATE_PER_MIN = 30
export const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download/mac'

export const TAILSCALE_PATHS = [
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
]

export type PeerMode = 'ask' | 'auto'

export interface TsPeer {
  /** Tailscale stable node id: the key of the allow list. */
  id: string
  name: string
  ips: string[]
  login: string
  userName: string
  online: boolean
  os: string
}

export interface TsStatus {
  installed: boolean
  /** 'Missing' (no tailscale), or Tailscale's BackendState: Running, Stopped, NeedsLogin, … */
  state: string
  selfIp?: string
  selfName?: string
  selfLogin?: string
  peers: TsPeer[]
  error?: string
}

export interface AllowedPeer { name: string; login: string; mode: PeerMode; /** Their Hive's port, when not the default. */ port?: number }

export interface RemoteSettings { enabled: boolean; /** The port this Hive listens on (default REMOTE_PORT). */ port?: number; peers: Record<string, AllowedPeer> }

export interface LogEntry {
  id: string
  at: number
  dir: 'in' | 'out'
  peerId: string
  peerName: string
  text: string
  /** in: 'butler' | 'card' ; out: 'sent' | an error code */
  result: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** `tailscale status --json` → what Hive needs. Unknown shapes come back empty, never throw. */
export function parseStatus(j: any): TsStatus {
  const users = (j && typeof j.User === 'object' && j.User) || {}
  const login = (uid: unknown) => str(users[String(uid)]?.LoginName)
  const userName = (uid: unknown) => str(users[String(uid)]?.DisplayName) || login(uid)
  const self = j?.Self ?? {}
  const peers: TsPeer[] = Object.values((j?.Peer as Record<string, any>) ?? {})
    .filter(p => p && typeof p.ID === 'string' && p.ID)
    .map(p => ({
      id: p.ID,
      name: str(p.HostName) || str(p.DNSName).split('.')[0] || p.ID,
      ips: Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs.filter((x: unknown) => typeof x === 'string') : [],
      login: login(p.UserID),
      userName: userName(p.UserID),
      online: p.Online === true,
      os: str(p.OS)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const ips: string[] = Array.isArray(j?.TailscaleIPs) ? j.TailscaleIPs : Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : []
  return {
    installed: true,
    state: str(j?.BackendState) || 'Unknown',
    selfIp: ips.find(ip => typeof ip === 'string' && ip.includes('.')),
    selfName: str(self.HostName) || undefined,
    selfLogin: login(self.UserID) || undefined,
    peers
  }
}

/** The device a request came from, by its Tailscale address (IPv4-mapped IPv6 accepted). */
export function peerByIp(peers: TsPeer[], addr: string | undefined): TsPeer | undefined {
  const ip = (addr ?? '').replace(/^::ffff:/, '')
  return ip ? peers.find(p => p.ips.includes(ip)) : undefined
}

/** A peer named by the owner/Butler: exact (case-insensitive) saved name, device name, login or id — allowed peers only. */
export function resolvePeer(settings: RemoteSettings, peers: TsPeer[], ref: string):
  { ok: true; peer: TsPeer; allowed: AllowedPeer } | { ok: false; error: 'no_such_peer' | 'ambiguous'; candidates: string[] } {
  const r = ref.trim().toLowerCase()
  const hits = Object.entries(settings.peers).filter(([id, a]) => {
    const p = peers.find(x => x.id === id)
    return [id, a.name, a.login, p?.name ?? ''].some(v => v && v.toLowerCase() === r)
  })
  if (hits.length !== 1) {
    return { ok: false, error: hits.length ? 'ambiguous' : 'no_such_peer', candidates: (hits.length ? hits : Object.entries(settings.peers)).map(([, a]) => `${a.name} (${a.login})`) }
  }
  const [id, allowed] = hits[0]
  const peer = peers.find(p => p.id === id)
  if (!peer) return { ok: false, error: 'no_such_peer', candidates: [`${allowed.name} — not on your Tailscale network right now`] }
  return { ok: true, peer, allowed }
}

export type InboundCheck =
  | { ok: true; peer: TsPeer; allowed: AllowedPeer; text: string }
  | { ok: false; status: number; error: string }

/** Who is asking and may they: only allowed devices, no browsers, a short text. */
export function checkInbound(input: { addr?: string; origin?: string; body: unknown }, status: TsStatus, settings: RemoteSettings): InboundCheck {
  if (!settings.enabled) return { ok: false, status: 503, error: 'remote_off' }
  if (input.origin) return { ok: false, status: 403, error: 'browser_refused' }
  const peer = peerByIp(status.peers, input.addr)
  if (!peer) return { ok: false, status: 403, error: 'unknown_device' }
  const allowed = settings.peers[peer.id]
  if (!allowed) return { ok: false, status: 403, error: 'not_allowed' }
  const text = str((input.body as any)?.text).trim()
  if (!text) return { ok: false, status: 400, error: 'empty_text' }
  if (text.length > MAX_TEXT) return { ok: false, status: 413, error: 'too_long' }
  return { ok: true, peer, allowed, text }
}

/** What Butler receives: who it is from, and that it is their words, not the owner's. */
export function butlerText(peerName: string, peer: TsPeer, text: string): string {
  return remoteButlerText(peerName, peer.login, peer.name, text)
}

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

export function readSettings(file: string): RemoteSettings {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    const peers: Record<string, AllowedPeer> = {}
    for (const [id, p] of Object.entries((j?.peers as Record<string, any>) ?? {})) {
      if (!id || !p) continue
      const port = validPort(p.port)
      peers[id] = { name: str(p.name) || id, login: str(p.login), mode: p.mode === 'auto' ? 'auto' : 'ask', ...(port ? { port } : {}) }
    }
    const port = validPort(j?.port)
    return { enabled: j?.enabled === true, ...(port ? { port } : {}), peers }
  } catch {
    return { enabled: false, peers: {} }
  }
}

function writeJson(file: string, v: unknown) {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(v, null, 2))
  renameSync(file + '.tmp', file)
}

/** Run `tailscale status --json` with the first binary that exists. */
export function tailscaleStatus(paths = TAILSCALE_PATHS, exists = existsSync): Promise<TsStatus> {
  const bin = paths.find(p => exists(p))
  if (!bin) return Promise.resolve({ installed: false, state: 'Missing', peers: [] })
  return new Promise(resolve => {
    execFile(bin, ['status', '--json'], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      try { return resolve(parseStatus(JSON.parse(stdout))) } catch { /* fall through */ }
      resolve({ installed: true, state: 'Unknown', peers: [], error: err ? String(err.message).slice(0, 200) : 'unreadable status' })
    })
  })
}

export type SendError = 'remote_off' | 'no_such_peer' | 'ambiguous' | 'empty_text' | 'too_long' | 'not_connected'
  | 'peer_offline' | 'their_remote_off' | 'not_allowed_by_them' | 'failed'

/** POST the text to the peer's Hive. Errors say which side to fix. */
export function postToPeer(ip: string, port: number, text: string, timeoutMs = 8000): Promise<{ ok: true; delivered: string } | { ok: false; error: SendError; detail?: string }> {
  return new Promise(resolve => {
    const data = JSON.stringify({ text })
    const req = request({ host: ip, port, path: '/remote/v1/message', method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        let j: any = {}
        try { j = JSON.parse(body) } catch { /* not JSON */ }
        if (res.statusCode === 200) return resolve({ ok: true, delivered: str(j.delivered) || 'butler' })
        if (res.statusCode === 403) return resolve({ ok: false, error: 'not_allowed_by_them', detail: str(j.error) })
        if (res.statusCode === 503) return resolve({ ok: false, error: 'their_remote_off' })
        resolve({ ok: false, error: 'failed', detail: str(j.error) || `HTTP ${res.statusCode}` })
      })
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', (e: NodeJS.ErrnoException) => {
      resolve(e.code === 'ECONNREFUSED' ? { ok: false, error: 'their_remote_off' } : { ok: false, error: 'peer_offline', detail: e.code || e.message })
    })
    req.end(data)
  })
}

export type DetectError = 'tailscale_missing' | 'tailscale_not_connected' | 'tailscale_unreadable'

/** Why Remote cannot be turned on, or null when Tailscale is installed and connected. */
export function detectError(st: TsStatus): DetectError | null {
  if (!st.installed) return 'tailscale_missing'
  if (st.state === 'Unknown') return 'tailscale_unreadable'
  if (st.state !== 'Running' || !st.selfIp) return 'tailscale_not_connected'
  return null
}

export const DETECT_ERROR_TEXT: Record<DetectError, string> = {
  tailscale_missing: 'Tailscale is not installed on this Mac. Install it, sign in, then turn Remote on.',
  tailscale_not_connected: 'Tailscale is installed but not connected. Open Tailscale, connect, then turn Remote on.',
  tailscale_unreadable: 'Hive could not read Tailscale’s status. Open Tailscale and check it is running.'
}

export interface RemoteDeps {
  dataDir: string
  status?: () => Promise<TsStatus>
  approvals: {
    add: (i: Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>) => Approval
    register: (kind: string, exec: (item: Approval) => Promise<{ ok: boolean; error?: string }>) => void
  }
  /** Put text into the Butler chat; false when Butler is not running. */
  toButler: (text: string) => { ok: boolean; error?: string }
  notify?: (title: string, body: string) => void
  onChange?: () => void
  /** Address to listen on; tests use 127.0.0.1. Default: this Mac's Tailscale IPv4. */
  bindHost?: (status: TsStatus) => string | undefined
  /** Shown in the Butler chat as a card. */
  chatEvent?: (e: RemoteChatEvent) => void
  post?: typeof postToPeer
  now?: () => number
}

export function createRemote(deps: RemoteDeps) {
  const settingsFile = join(deps.dataDir, 'remote.json')
  const logFile = join(deps.dataDir, 'remote-log.json')
  const now = deps.now ?? Date.now
  const port = () => settings.port ?? REMOTE_PORT
  const getStatus = deps.status ?? (() => tailscaleStatus())
  const post = deps.post ?? postToPeer
  let settings = readSettings(settingsFile)
  let status: TsStatus = { installed: false, state: 'Unknown', peers: [] }
  let statusAt = 0
  let server: Server | null = null
  let boundTo = ''
  let listenError = ''
  const hits = new Map<string, number[]>()
  let log: LogEntry[] = (() => { try { const j = JSON.parse(readFileSync(logFile, 'utf8')); return Array.isArray(j) ? j : [] } catch { return [] } })()

  const changed = () => deps.onChange?.()
  const saveSettings = () => { writeJson(settingsFile, settings); changed() }
  const addLog = (e: Omit<LogEntry, 'id' | 'at'>) => {
    log = [...log, { ...e, id: randomUUID(), at: now() }].slice(-LOG_KEEP)
    try { writeJson(logFile, log) } catch { /* the log is a convenience */ }
    changed()
  }

  async function refresh(maxAgeMs = 0): Promise<TsStatus> {
    if (maxAgeMs && now() - statusAt < maxAgeMs) return status
    status = await getStatus()
    statusAt = now()
    return status
  }

  function giveToButler(peerName: string, peer: TsPeer, text: string) {
    return deps.toButler(butlerText(peerName, peer, text))
  }

  deps.approvals.register(REMOTE_KIND, async item => {
    // Who sent it, as recorded when it arrived.
    const p = item.payload as { peerId?: string; peerName?: string; login?: string; device?: string; question?: string }
    const r = deps.toButler(remoteButlerText(str(p.peerName), str(p.login), str(p.device), str(p.question)))
    return r.ok ? { ok: true } : { ok: false, error: r.error === 'no_session' ? 'Butler is not running — turn Butler on, then Retry' : r.error || 'failed' }
  })

  function card(peerName: string, peer: TsPeer, text: string, why?: string) {
    const a = deps.approvals.add({
      kind: REMOTE_KIND,
      title: `${peerName} · ${clip(text, 60)}`,
      subtitle: `Remote · ${peerName}'s Hive${peer.login ? ` (${peer.login})` : ''}${why ? ` · ${why}` : ''}`,
      draft: '',
      payload: { peerId: peer.id, peerName, login: peer.login, device: peer.name, question: text },
      action: 'Give to Butler'
    })
    deps.chatEvent?.({ type: 'in', id: randomUUID(), peerName, login: peer.login, device: peer.name, text, cardId: a.id })
  }

  function rateOk(id: string): boolean {
    const t = now()
    const list = (hits.get(id) ?? []).filter(x => t - x < 60_000)
    if (list.length >= RATE_PER_MIN) { hits.set(id, list); return false }
    list.push(t)
    hits.set(id, list)
    return true
  }

  /** One request from the network. */
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const reply = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    try {
      const path = (req.url || '').split('?')[0]
      if (req.method === 'GET' && path === '/remote/v1/ping') return reply(settings.enabled ? 200 : 503, { ok: settings.enabled })
      if (req.method !== 'POST' || path !== '/remote/v1/message') return reply(404, { ok: false, error: 'not_found' })
      const body = await new Promise<unknown>((resolve, reject) => {
        let b = ''
        req.on('data', c => { b += c; if (b.length > 64_000) reject(new Error('too_long')) })
        req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { reject(new Error('bad_json')) } })
        req.on('error', reject)
      }).catch(e => e as Error)
      if (body instanceof Error) return reply(400, { ok: false, error: body.message })
      // A device that just joined is not in a status older than a few seconds.
      let st = await refresh(15_000)
      if (!peerByIp(st.peers, req.socket.remoteAddress)) st = await refresh()
      const c = checkInbound({ addr: req.socket.remoteAddress, origin: req.headers.origin, body }, st, settings)
      if (c.ok === false) { const f = c as Extract<InboundCheck, { ok: false }>; return reply(f.status, { ok: false, error: f.error }) }
      if (!rateOk(c.peer.id)) return reply(429, { ok: false, error: 'too_many' })
      const name = c.allowed.name
      if (c.allowed.mode === 'auto') {
        const r = giveToButler(name, c.peer, c.text)
        if (r.ok) {
          addLog({ dir: 'in', peerId: c.peer.id, peerName: name, text: c.text, result: 'butler' })
          deps.notify?.(`${name}'s Hive → Butler`, clip(c.text, 100))
          return reply(200, { ok: true, delivered: 'butler' })
        }
        card(name, c.peer, c.text, 'Butler was off')
      } else {
        card(name, c.peer, c.text)
      }
      addLog({ dir: 'in', peerId: c.peer.id, peerName: name, text: c.text, result: 'card' })
      return reply(200, { ok: true, delivered: 'card' })
    } catch (e) {
      return reply(500, { ok: false, error: e instanceof Error ? e.message : 'failed' })
    }
  }

  function closeServer() {
    if (server) { try { server.close() } catch { /* already closed */ } }
    server = null
    boundTo = ''
  }

  /** Listen on the Tailscale address while on; follow the address when it changes. */
  async function sync() {
    if (!settings.enabled) { closeServer(); listenError = ''; changed(); return }
    const st = await refresh()
    const host = deps.bindHost ? deps.bindHost(st) : st.state === 'Running' ? st.selfIp : undefined
    if (!host) { closeServer(); changed(); return }
    if (server && boundTo === `${host}:${port()}`) return
    closeServer()
    await new Promise<void>(resolve => {
      const s = createServer((req, res) => { void handle(req, res) })
      const p = port()
      s.once('error', (e: NodeJS.ErrnoException) => { listenError = e.code === 'EADDRINUSE' ? `port ${p} is in use — pick another port` : e.message; resolve() })
      s.listen(p, host, () => { server = s; boundTo = `${host}:${p}`; listenError = ''; resolve() })
    })
    changed()
  }

  function view() {
    const allowed = Object.entries(settings.peers).map(([id, a]) => ({ id, ...a, device: status.peers.find(p => p.id === id) ?? null }))
    return {
      enabled: settings.enabled,
      listening: !!server,
      address: boundTo,
      port: port(),
      listenError,
      tailscale: { installed: status.installed, state: status.state, selfName: status.selfName, selfIp: status.selfIp, selfLogin: status.selfLogin, error: status.error },
      devices: status.peers.map(p => ({ ...p, allowed: settings.peers[p.id] ?? null })),
      allowed,
      log: [...log].reverse()
    }
  }

  return {
    sync,
    refresh,
    handle,
    view,
    settings: () => settings,
    /** Turning on detects Tailscale first; when it is missing or not connected Remote stays off and says why. */
    async setEnabled(on: boolean): Promise<{ ok: boolean; error?: DetectError; view: ReturnType<typeof view> }> {
      if (on) {
        const st = await refresh()
        const err = detectError(st)
        if (err) { changed(); return { ok: false, error: err, view: view() } }
      }
      settings = { ...settings, enabled: on }
      saveSettings()
      await sync()
      return { ok: true, view: view() }
    },
    async setPort(p: number) {
      const v = validPort(p)
      if (!v) return { ok: false as const, error: 'bad_port', view: view() }
      settings = { ...settings, port: v }
      saveSettings()
      closeServer()
      await sync()
      return { ok: true as const, view: view() }
    },
    /** Allow a device (or change its mode / name); null removes it. */
    setPeer(id: string, peer: Partial<AllowedPeer> | null) {
      const peers = { ...settings.peers }
      if (peer === null) delete peers[id]
      else {
        const dev = status.peers.find(p => p.id === id)
        const prev = peers[id]
        if (!prev && !dev) return view()
        peers[id] = {
          name: (peer.name ?? prev?.name ?? dev?.userName ?? dev?.name ?? id).trim() || id,
          login: prev?.login || dev?.login || '',
          mode: peer.mode === 'auto' || peer.mode === 'ask' ? peer.mode : prev?.mode ?? 'ask'
        }
        const pp = peer.port === undefined ? prev?.port : validPort(peer.port)
        if (pp && pp !== REMOTE_PORT) peers[id].port = pp
      }
      settings = { ...settings, peers }
      saveSettings()
      return view()
    },
    /** Allowed peers with their device and whether it is online. */
    async peers() {
      const st = await refresh(10_000)
      return Object.entries(settings.peers).map(([id, a]) => {
        const d = st.peers.find(p => p.id === id)
        return { id, name: a.name, login: a.login, mode: a.mode, device: d?.name ?? '', online: d?.online ?? false, onNetwork: !!d }
      })
    },
    async send(ref: string, text: string): Promise<{ ok: true; peer: string; delivered: string } | { ok: false; error: SendError; detail?: string; candidates?: string[] }> {
      const t = text.trim()
      if (!settings.enabled) return { ok: false, error: 'remote_off' }
      if (!t) return { ok: false, error: 'empty_text' }
      if (t.length > MAX_TEXT) return { ok: false, error: 'too_long' }
      const st = await refresh(10_000)
      if (st.state !== 'Running') return { ok: false, error: 'not_connected', detail: st.state }
      const r = resolvePeer(settings, st.peers, ref)
      if (r.ok === false) return r as Extract<typeof r, { ok: false }>
      const ip = r.peer.ips.find(x => x.includes('.')) ?? r.peer.ips[0]
      if (!ip) return { ok: false, error: 'peer_offline' }
      const out = await post(ip, r.allowed.port ?? REMOTE_PORT, t)
      const err = out.ok ? '' : (out as Extract<typeof out, { ok: false }>).error
      addLog({ dir: 'out', peerId: r.peer.id, peerName: r.allowed.name, text: t, result: out.ok ? 'sent' : err })
      deps.chatEvent?.({ type: 'out', id: randomUUID(), peerName: r.allowed.name, text: t, ok: out.ok, ...(out.ok ? {} : { error: err }) })
      if (out.ok === true) return { ok: true, peer: r.allowed.name, delivered: (out as { delivered: string }).delivered }
      return out as Extract<typeof out, { ok: false }>
    },
    close: closeServer
  }
}

export type Remote = ReturnType<typeof createRemote>

/** One line per send error, for ./hive and the UI. */
export const SEND_ERROR_TEXT: Record<SendError, string> = {
  remote_off: 'Remote is off on this Mac: App Settings › Remote, turn it on.',
  no_such_peer: 'No such person on your Remote list (App Settings › Remote).',
  ambiguous: 'More than one person matches — use the exact name.',
  empty_text: 'Nothing to send.',
  too_long: `Too long (max ${MAX_TEXT} characters).`,
  not_connected: 'Tailscale is not connected on this Mac. Open Tailscale and connect.',
  peer_offline: 'Their Mac is not reachable on Tailscale (offline or asleep).',
  their_remote_off: 'Their Hive is closed, or Remote is off in their Hive.',
  not_allowed_by_them: "They have not added you to their Remote list yet.",
  failed: 'Sending failed.'
}
