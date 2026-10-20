import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  butlerArgs, bridgeSessionId, claudeTrustsFolder, readButlerOutput, outputTail, installButlerFiles, createButler,
  readButlerSettings, RESTART_DELAYS_MS, STABLE_AFTER_MS, type ButlerState, type PtyLike
} from '../butler'

const TRUST_PROMPT = 'Quick safety check: is this a project you created or one you trust? Sessions started here can read, edit, and execute files.\r\nTrust /Users/me/.hive/butler? [y/N] '

const RESOURCES = join(__dirname, '..', '..', '..', 'resources', 'butler')

class FakePty implements PtyLike {
  static nextPid = 100
  pid = FakePty.nextPid++
  written: string[] = []
  private dataCbs: Array<(d: string) => void> = []
  private exitCbs: Array<(e: { exitCode: number }) => void> = []
  constructor(public args: string[], public cwd: string) {}
  write(d: string) { this.written.push(d) }
  onData(cb: (d: string) => void) { this.dataCbs.push(cb) }
  onExit(cb: (e: { exitCode: number }) => void) { this.exitCbs.push(cb) }
  emit(d: string) { for (const cb of this.dataCbs) cb(d) }
  exit(code = 1) { for (const cb of this.exitCbs) cb({ exitCode: code }) }
}

function setup(opts: { enabled?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-butler-'))
  if (opts.enabled) writeFileSync(join(dataDir, 'butler.json'), JSON.stringify({ enabled: true }))
  const ptys: FakePty[] = []
  const killed: FakePty[] = []
  const stale: number[] = []
  const states: ButlerState[] = []
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  let clock = 1_000_000
  let recorded: string | null = null
  let claudeOk = true
  const butler = createButler({
    claudeTrusts: () => claudeOk,
    recordedSessionId: () => recorded,
    dataDir,
    resourcesDir: RESOURCES,
    spawn: (args, cwd) => { const p = new FakePty(args, cwd); ptys.push(p); return p },
    kill: t => { killed.push(t as FakePty) },
    killStale: pid => { stale.push(pid) },
    onState: s => states.push(s),
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t },
    clearTimer: t => { (t as { cleared: boolean }).cleared = true }
  })
  return {
    dataDir, butler, ptys, killed, stale, states, timers,
    last: () => ptys[ptys.length - 1],
    advance: (ms: number) => { clock += ms },
    record: (id: string | null) => { recorded = id },
    claudeTrust: (ok: boolean) => { claudeOk = ok }
  }
}

describe('butlerArgs', () => {
  it('a new session is named and refuses unlisted tools', () => {
    expect(butlerArgs('fresh')).toEqual(['remote-control', '--name', 'Hive Butler', '--permission-mode', 'dontAsk'])
  })
  it('--continue reattaches the last one recorded here', () => {
    expect(butlerArgs('continue')).toEqual(['remote-control', '--name', 'Hive Butler', '--permission-mode', 'dontAsk', '--continue'])
  })
  it('a saved session is reattached by id, without spawn flags', () => {
    expect(butlerArgs({ sessionId: 'session_01ABC' })).toEqual(['remote-control', '--session-id', 'session_01ABC'])
  })
})

describe('claudeTrustsFolder', () => {
  const cfg = (projects: unknown) => {
    const f = join(mkdtempSync(join(tmpdir(), 'hive-claude-json-')), '.claude.json')
    writeFileSync(f, JSON.stringify({ projects }))
    return f
  }
  it('true only when Claude Code accepted trust for that exact real path', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hive-trust-'))
    const real = realpathSync(cwd)
    expect(claudeTrustsFolder(cfg({ [real]: { hasTrustDialogAccepted: true } }), cwd)).toBe(true)
    expect(claudeTrustsFolder(cfg({ [real]: { hasTrustDialogAccepted: false } }), cwd)).toBe(false)
    expect(claudeTrustsFolder(cfg({ [real + '-other']: { hasTrustDialogAccepted: true } }), cwd)).toBe(false)
    expect(claudeTrustsFolder(cfg({}), cwd)).toBe(false)
  })
  it('false when the config is missing or unreadable', () => {
    expect(claudeTrustsFolder(join(tmpdir(), 'no-such-dir', '.claude.json'), tmpdir())).toBe(false)
  })
})

describe('bridgeSessionId', () => {
  it('reads the session remote-control recorded for the folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'hive-claude-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'hive butler.dir-'))
    const slug = realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, '-')
    mkdirSync(join(home, 'projects', slug), { recursive: true })
    writeFileSync(join(home, 'projects', slug, 'bridge-pointer.json'),
      JSON.stringify({ sessionId: 'session_01TyEz', environmentId: 'env_01HE', source: 'standalone', pid: 1 }))
    expect(bridgeSessionId(home, cwd)).toBe('session_01TyEz')
  })
  it('none when nothing was recorded', () => {
    expect(bridgeSessionId(mkdtempSync(join(tmpdir(), 'hive-claude-home-')), tmpdir())).toBeNull()
  })
})

describe('readButlerOutput', () => {
  it('finds the session URL through ANSI colour codes', () => {
    expect(readButlerOutput('\x1b[32mReady\x1b[0m https://claude.ai/code/session_01ABC?x=1\x1b[0m\r\n'))
      .toEqual({ kind: 'connected', url: 'https://claude.ai/code/session_01ABC?x=1' })
  })
  it('recognises the folder trust prompt', () => {
    expect(readButlerOutput(TRUST_PROMPT)).toEqual({ kind: 'trust' })
  })
  it('recognises the enable question that follows it', () => {
    expect(readButlerOutput(TRUST_PROMPT + ' y\r\nTake this session with you…\r\nEnable Remote Control? (y/n) ')).toEqual({ kind: 'enable' })
  })
  it('the URL wins once it is there', () => {
    expect(readButlerOutput(TRUST_PROMPT + '\n·✔︎· Connected · butler\nContinue coding in the Claude mobile app or https://claude.ai/code?environment=env_01HE4u\n'))
      .toEqual({ kind: 'connected', url: 'https://claude.ai/code?environment=env_01HE4u' })
  })
  it('nothing yet', () => {
    expect(readButlerOutput('Starting remote control…')).toBeNull()
  })
})

describe('outputTail', () => {
  it('keeps the last readable lines', () => {
    expect(outputTail('\x1b[31ma\x1b[0m\r\n\r\nb\nc\r\nd', 2)).toBe('c\nd')
  })
})

describe('installButlerFiles', () => {
  it('writes the rules, an executable CLI and the permission settings, overwriting edits', () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'hive-butler-dest-')), 'butler')
    mkdirSync(dest)
    writeFileSync(join(dest, 'CLAUDE.md'), 'edited by hand')
    writeFileSync(join(dest, 'notes.txt'), 'keep me')
    installButlerFiles(RESOURCES, dest)
    expect(readFileSync(join(dest, 'CLAUDE.md'), 'utf8')).toBe(readFileSync(join(RESOURCES, 'CLAUDE.md'), 'utf8'))
    expect(statSync(join(dest, 'hive')).mode & 0o111).toBeTruthy()
    const settings = JSON.parse(readFileSync(join(dest, '.claude', 'settings.json'), 'utf8'))
    expect(settings.permissions.allow).toEqual([
      'Bash(./hive agents:*)', 'Bash(./hive tail:*)', 'Bash(./hive send:*)', 'Bash(./hive start:*)'
    ])
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Edit', 'Write']))
    expect(readFileSync(join(dest, 'notes.txt'), 'utf8')).toBe('keep me')
  })
})

describe('bundled rules', () => {
  const rules = readFileSync(join(RESOURCES, 'CLAUDE.md'), 'utf8')
  it.each([
    ['exact names', /Exact names only/],
    ['candidates on ambiguous/not found', /ambiguous or not found, list the candidates/],
    ['verbatim forwarding', /Send the owner's words, not yours/],
    ['never start on its own', /Never start a chat on your own/],
    ['only the named agent', /Only the agent the owner named/],
    ['truthful reporting', /Never claim something was\s+sent or started unless/],
    ['no agent work', /You do not do the agents' work/],
    ['reply language + short', /language the owner writes in[\s\S]*short/]
  ])('keeps the %s rule', (_name, re) => {
    expect(rules).toMatch(re)
  })
})

describe('createButler', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => { t = setup() })

  it('is off by default and spawns nothing', () => {
    expect(t.butler.getState()).toEqual({ enabled: false, status: 'off' })
    t.butler.restore()
    expect(t.ptys).toHaveLength(0)
  })

  it('switching on installs the files, starts in the butler folder and reports connected', () => {
    t.butler.setEnabled(true)
    expect(readButlerSettings(t.dataDir).enabled).toBe(true)
    expect(existsSync(join(t.dataDir, 'butler', 'CLAUDE.md'))).toBe(true)
    expect(t.last().cwd).toBe(join(t.dataDir, 'butler'))
    expect(t.butler.getState().status).toBe('starting')
    t.last().emit('Connected: https://claude.ai/code/s1\r\n')
    expect(t.butler.getState()).toEqual({ enabled: true, status: 'connected', url: 'https://claude.ai/code/s1' })
    expect(readFileSync(join(t.dataDir, 'butler', '.pid'), 'utf8')).toBe(String(t.last().pid))
  })

  it('falls back to a fresh session when --continue has nothing to reattach', () => {
    t.butler.setEnabled(true)
    expect(t.last().args).toContain('--continue')
    t.last().emit('No session recorded for this directory')
    t.last().exit(1)
    expect(t.ptys).toHaveLength(2)
    expect(t.last().args).not.toContain('--continue')
  })

  it('remembers the connected session and reattaches it by id next time', () => {
    t.butler.setEnabled(true)
    t.record('session_01KEEP')
    t.last().emit('Ready: https://claude.ai/code?environment=env_1\r\n')
    expect(readFileSync(join(t.dataDir, 'butler', '.session-id'), 'utf8')).toBe('session_01KEEP')
    t.butler.shutdown()
    t.butler.restore()
    expect(t.last().args).toEqual(['remote-control', '--session-id', 'session_01KEEP'])
  })

  it('a saved session that cannot be reattached is forgotten: --continue, then new', () => {
    mkdirSync(join(t.dataDir, 'butler'), { recursive: true })
    writeFileSync(join(t.dataDir, 'butler', '.session-id'), 'session_GONE')
    t.butler.setEnabled(true)
    expect(t.last().args).toContain('--session-id')
    t.last().exit(1)
    expect(existsSync(join(t.dataDir, 'butler', '.session-id'))).toBe(false)
    expect(t.last().args).toContain('--continue')
    t.last().exit(1)
    expect(t.last().args).toEqual(['remote-control', '--name', 'Hive Butler', '--permission-mode', 'dontAsk'])
    expect(t.ptys).toHaveLength(3)
  })

  it('a restart after a crash reattaches the same session by id', () => {
    t.butler.setEnabled(true)
    t.record('session_01SAME')
    t.last().emit('https://claude.ai/code?environment=env_1')
    t.last().exit(1)
    t.timers[0].fn()
    expect(t.last().args).toEqual(['remote-control', '--session-id', 'session_01SAME'])
  })

  it('a fresh session that dies before connecting is an error with its output, no restart loop', () => {
    t.butler.setEnabled(true)
    t.last().exit(1)
    t.last().emit('Error: You must be logged in with a Claude account that has a subscription')
    t.last().exit(1)
    expect(t.ptys).toHaveLength(2)
    expect(t.butler.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('logged in') })
    expect(t.timers).toHaveLength(0)
  })

  it('asks before answering the trust prompt, then answers it once', () => {
    t.butler.setEnabled(true)
    t.last().emit(TRUST_PROMPT)
    expect(t.butler.getState().status).toBe('needs_trust')
    expect(t.last().written).toEqual([])
    expect(t.butler.confirmTrust()).toBe(true)
    expect(t.last().written).toEqual(['y\r'])
    expect(t.butler.getState().status).toBe('starting')
    t.last().emit('…redraw…')
    expect(t.butler.getState().status).toBe('starting')
    expect(t.butler.confirmTrust()).toBe(false)
  })

  it('after one OK, later trust prompts are answered without asking', () => {
    t.butler.setEnabled(true)
    t.last().emit(TRUST_PROMPT)
    t.butler.confirmTrust()
    expect(readButlerSettings(t.dataDir)).toEqual({ enabled: true, trusted: true, offered: true, pinned: false, setup: {}, setupCardHidden: false })
    t.butler.shutdown()
    t.butler.restore()
    t.last().emit(TRUST_PROMPT)
    expect(t.last().written).toEqual(['y\r'])
    expect(t.butler.getState().status).toBe('starting')
  })

  it('switching off withdraws the OK: switching on asks again', () => {
    t.butler.setEnabled(true)
    t.last().emit(TRUST_PROMPT)
    t.butler.confirmTrust()
    t.butler.setEnabled(false)
    expect(readButlerSettings(t.dataDir)).toEqual({ enabled: false, trusted: false, offered: true, pinned: false, setup: {}, setupCardHidden: false })
    t.butler.setEnabled(true)
    t.last().emit(TRUST_PROMPT)
    expect(t.last().written).toEqual([])
    expect(t.butler.getState().status).toBe('needs_trust')
  })

  it('asks again when Claude Code no longer trusts the folder, read at that start', () => {
    t.butler.setEnabled(true)
    t.last().emit(TRUST_PROMPT)
    t.butler.confirmTrust()
    t.butler.shutdown()
    t.claudeTrust(false)
    t.butler.restore()
    t.last().emit(TRUST_PROMPT)
    expect(t.last().written).toEqual([])
    expect(t.butler.getState().status).toBe('needs_trust')
  })

  it('answers "Enable Remote Control?" itself, once', () => {
    t.butler.setEnabled(true)
    t.last().emit('Enable Remote Control? (y/n) ')
    expect(t.last().written).toEqual(['y\r'])
    t.last().emit('\r\n')
    expect(t.last().written).toEqual(['y\r'])
    expect(t.butler.getState().status).toBe('starting')
  })

  it('switching off kills the session and keeps the folder', () => {
    t.butler.setEnabled(true)
    const p = t.last()
    t.butler.setEnabled(false)
    expect(t.killed).toEqual([p])
    expect(t.butler.getState()).toEqual({ enabled: false, status: 'off' })
    expect(readButlerSettings(t.dataDir).enabled).toBe(false)
    expect(existsSync(join(t.dataDir, 'butler', 'CLAUDE.md'))).toBe(true)
    p.exit(0)
    expect(t.ptys).toHaveLength(1)
  })

  it('restarts a connected session that exits, backing off, then gives up', () => {
    t.butler.setEnabled(true)
    for (let i = 0; i < RESTART_DELAYS_MS.length; i++) {
      t.last().emit('https://claude.ai/code/s')
      t.last().exit(1)
      expect(t.timers[i].ms).toBe(RESTART_DELAYS_MS[i])
      t.timers[i].fn()
      expect(t.last().args).toContain('--continue')
    }
    t.last().emit('https://claude.ai/code/s')
    t.last().exit(1)
    expect(t.butler.getState().status).toBe('error')
    expect(t.timers).toHaveLength(RESTART_DELAYS_MS.length)
  })

  it('a session that stayed up a while gets a fresh restart budget', () => {
    t.butler.setEnabled(true)
    for (let i = 0; i < 3; i++) {
      t.last().emit('https://claude.ai/code/s')
      t.last().exit(1)
      t.timers[t.timers.length - 1].fn()
    }
    t.last().emit('https://claude.ai/code/s')
    t.advance(STABLE_AFTER_MS)
    t.last().exit(1)
    expect(t.timers[t.timers.length - 1].ms).toBe(RESTART_DELAYS_MS[0])
  })

  it('switching off cancels a pending restart', () => {
    t.butler.setEnabled(true)
    t.last().emit('https://claude.ai/code/s')
    t.last().exit(1)
    t.butler.setEnabled(false)
    expect(t.timers[0].cleared).toBe(true)
  })

  it('shutdown on quit stops the session but keeps the switch on', () => {
    t.butler.setEnabled(true)
    t.butler.shutdown()
    expect(t.killed).toHaveLength(1)
    expect(readButlerSettings(t.dataDir).enabled).toBe(true)
  })
})

describe('one-time offer', () => {
  it('offered to someone who never answered and has it off', () => {
    const t = setup()
    expect(t.butler.shouldOffer).toBe(true)
  })
  it('"Not now" is final and survives a restart', () => {
    const t = setup()
    t.butler.offerAnswered()
    expect(t.butler.shouldOffer).toBe(false)
    expect(readButlerSettings(t.dataDir)).toEqual({ enabled: false, trusted: false, offered: true, pinned: false, setup: {}, setupCardHidden: false })
    const again = createButler({
      dataDir: t.dataDir, resourcesDir: RESOURCES, claudeTrusts: () => true, recordedSessionId: () => null,
      spawn: () => new FakePty([], ''), kill: () => {}, killStale: () => {}, onState: () => {}
    })
    expect(again.shouldOffer).toBe(false)
  })
  it('turning it on counts as the answer, also after turning it off', () => {
    const t = setup()
    t.butler.setEnabled(true)
    t.butler.setEnabled(false)
    expect(t.butler.shouldOffer).toBe(false)
  })
  it('setup marks: valid ids only, clearable, remembered', () => {
    const t = setup()
    t.butler.markSetup('theme', 'done')
    t.butler.markSetup('voice', 'skipped')
    t.butler.markSetup('../evil', 'done')
    t.butler.markSetup('voice', null)
    t.butler.hideSetupCard(true)
    expect(readButlerSettings(t.dataDir)).toMatchObject({ setup: { theme: 'done' }, setupCardHidden: true })
    expect(t.butler.getSetup()).toEqual({ marks: { theme: 'done' }, cardHidden: true })
  })
  it('pinned is remembered across a restart', () => {
    const t = setup()
    t.butler.setPinned(true)
    expect(readButlerSettings(t.dataDir).pinned).toBe(true)
    const again = createButler({
      dataDir: t.dataDir, resourcesDir: RESOURCES, claudeTrusts: () => true, recordedSessionId: () => null,
      spawn: () => new FakePty([], ''), kill: () => {}, killStale: () => {}, onState: () => {}
    })
    expect(again.pinned).toBe(true)
  })
  it('never offered while already on', () => {
    expect(setup({ enabled: true }).butler.shouldOffer).toBe(false)
  })
})

describe('createButler at launch', () => {
  it('restores when the switch was left on, sweeping a butler left by a crash', () => {
    const t = setup({ enabled: true })
    mkdirSync(join(t.dataDir, 'butler'), { recursive: true })
    writeFileSync(join(t.dataDir, 'butler', '.pid'), '4242')
    t.butler.restore()
    expect(t.stale).toEqual([4242])
    expect(t.ptys).toHaveLength(1)
    expect(t.last().args).toContain('--continue')
    t.butler.restore()
    expect(t.ptys).toHaveLength(1)
  })

  it('retry after an error starts again without touching the switch', () => {
    const t = setup({ enabled: true })
    t.butler.restore()
    t.last().exit(1)
    t.last().exit(1)
    expect(t.butler.getState().status).toBe('error')
    t.butler.retry()
    expect(t.ptys).toHaveLength(3)
    expect(t.butler.getState().status).toBe('starting')
  })
})
