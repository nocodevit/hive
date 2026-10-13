import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn, spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { releasesApiUrl, GITHUB_RELEASES_API } from '../version'
import { bundlePathFromExe, selfInstallBlocker, parseTeamId, replacementProblem, prepareUpdate, INSTALL_SCRIPT } from '../selfUpdate'

describe('bundlePathFromExe', () => {
  it('finds the .app that contains the executable', () => {
    expect(bundlePathFromExe('/Applications/Hive.app/Contents/MacOS/Hive')).toBe('/Applications/Hive.app')
    expect(bundlePathFromExe('/Users/me/My Apps/Hive.app/Contents/MacOS/Hive')).toBe('/Users/me/My Apps/Hive.app')
  })
  it('is null outside a bundle', () => {
    expect(bundlePathFromExe('/repo/node_modules/electron/dist/electron')).toBeNull()
    expect(bundlePathFromExe('/Applications/Hive.app/Contents/Frameworks/Helper')).toBeNull()
  })
})

describe('selfInstallBlocker', () => {
  const ok = { platform: 'darwin', packaged: true, bundlePath: '/Applications/Hive.app' }
  it('allows a packaged app in a normal location', () => {
    expect(selfInstallBlocker(ok)).toBeNull()
  })
  it('refuses dev builds, other platforms and odd locations, saying why', () => {
    expect(selfInstallBlocker({ ...ok, packaged: false })).toMatch(/development/)
    expect(selfInstallBlocker({ ...ok, platform: 'win32' })).toMatch(/macOS/)
    expect(selfInstallBlocker({ ...ok, bundlePath: null })).toMatch(/app bundle/)
    expect(selfInstallBlocker({ ...ok, bundlePath: '/private/var/folders/x/AppTranslocation/ABC/d/Hive.app' })).toMatch(/Applications/)
    expect(selfInstallBlocker({ ...ok, bundlePath: '/Volumes/Hive 2.26.0/Hive.app' })).toMatch(/disk image/)
  })
})

describe('parseTeamId', () => {
  it('reads the team from codesign -dv output', () => {
    expect(parseTeamId('Executable=/x\nIdentifier=com.hive.app\nTeamIdentifier=B57FS77RR8\nSealed Resources version=2')).toBe('B57FS77RR8')
  })
  it('is empty for ad-hoc or unsigned', () => {
    expect(parseTeamId('Signature=adhoc\nTeamIdentifier=not set\n')).toBe('')
    expect(parseTeamId('code object is not signed at all')).toBe('')
  })
})

describe('replacementProblem', () => {
  const base = { currentVersion: '2.25.2', currentBundleId: 'com.hive.app', currentTeam: 'TEAM1', newVersion: '2.26.0', newBundleId: 'com.hive.app', newTeam: 'TEAM1' }
  it('accepts a newer Hive from the same developer', () => {
    expect(replacementProblem(base)).toBeNull()
  })
  it('refuses the same or an older version', () => {
    expect(replacementProblem({ ...base, newVersion: '2.25.2' })).toMatch(/not newer/)
    expect(replacementProblem({ ...base, newVersion: '2.9.9' })).toMatch(/not newer/)
    expect(replacementProblem({ ...base, newVersion: '' })).toMatch(/no version/)
  })
  it('refuses a different app', () => {
    expect(replacementProblem({ ...base, newBundleId: 'com.evil.app' })).toMatch(/not Hive/)
  })
  it('refuses a different or missing signer when the installed app has one', () => {
    expect(replacementProblem({ ...base, newTeam: 'TEAM2' })).toMatch(/different developer/)
    expect(replacementProblem({ ...base, newTeam: '' })).toMatch(/different developer/)
  })
  it('an ad-hoc installed app (older local builds) can move to a signed one', () => {
    expect(replacementProblem({ ...base, currentTeam: '', newTeam: 'TEAM1' })).toBeNull()
    expect(replacementProblem({ ...base, currentTeam: '', newTeam: '' })).toBeNull()
  })
})

const mac = process.platform === 'darwin'

describe.skipIf(!mac)('install script (real files, fake apps)', () => {
  let dir: string
  let script: string
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hive-install-test-')))
    script = join(dir, 'install.sh')
    writeFileSync(script, INSTALL_SCRIPT)
    chmodSync(script, 0o700)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const fakeApp = (path: string, marker: string) => {
    mkdirSync(join(path, 'Contents'), { recursive: true })
    writeFileSync(join(path, 'Contents', 'marker'), marker)
  }
  const setup = (name: string) => {
    const root = join(dir, name)
    const target = join(root, 'Applications', 'Hive.app')
    const staged = join(root, 'Applications', '.Hive-update-9.9.9', 'Hive.app')
    fakeApp(target, 'old')
    fakeApp(staged, 'new')
    return { root, target, staged }
  }
  const markerOf = (app: string) => readFileSync(join(app, 'Contents', 'marker'), 'utf-8')
  const deadPid = () => { const p = spawnSync('/bin/sh', ['-c', 'echo $$']); return p.stdout.toString().trim() }

  it('swaps the bundle once the app has exited, and cleans up', () => {
    const { root, target, staged } = setup('swap')
    const r = spawnSync('/bin/sh', [script, deadPid(), staged, target, '0'])
    expect(r.status).toBe(0)
    expect(markerOf(target)).toBe('new')
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(join(root, 'Applications', '.Hive-update-9.9.9'))).toBe(false)
    expect(execFileSync('/bin/ls', ['-A', join(root, 'Applications')]).toString().trim()).toBe('Hive.app')
  })

  it('waits for the app to exit before touching anything', async () => {
    const { target, staged } = setup('waits')
    const app = spawn('/bin/sleep', ['1.2'])
    const started = Date.now()
    const child = spawn('/bin/sh', [script, String(app.pid), staged, target, '0'])
    await new Promise(r => setTimeout(r, 500))
    expect(markerOf(target)).toBe('old')   // still running → untouched
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    expect(code).toBe(0)
    expect(Date.now() - started).toBeGreaterThan(1000)
    expect(markerOf(target)).toBe('new')
  })

  it('leaves the installed app alone when the staged copy is missing', () => {
    const { target, staged } = setup('missing')
    rmSync(staged, { recursive: true })
    const r = spawnSync('/bin/sh', [script, deadPid(), staged, target, '0'])
    expect(r.status).toBe(4)
    expect(markerOf(target)).toBe('old')
  })

  it('puts the old app back if the new one cannot be moved in', () => {
    const { root, target } = setup('rollback')
    // A "staged app" whose parent vanishes between the check and the move is
    // hard to stage; a staged path on a read-only location is equivalent:
    // -d passes, mv fails.
    const locked = join(root, 'locked')
    fakeApp(join(locked, 'Hive.app'), 'new')
    chmodSync(locked, 0o500)
    try {
      const r = spawnSync('/bin/sh', [script, deadPid(), join(locked, 'Hive.app'), target, '0'])
      expect(r.status).toBe(6)
      expect(markerOf(target)).toBe('old')
      expect(execFileSync('/bin/ls', ['-A', join(root, 'Applications')]).toString()).not.toMatch(/Hive-previous/)
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it('handles paths with spaces', () => {
    const root = join(dir, 'with space')
    const target = join(root, 'My Apps', 'Hive.app')
    const staged = join(root, 'My Apps', '.Hive-update-1', 'Hive.app')
    fakeApp(target, 'old'); fakeApp(staged, 'new')
    expect(spawnSync('/bin/sh', [script, deadPid(), staged, target, '0']).status).toBe(0)
    expect(markerOf(target)).toBe('new')
  })
})

describe.skipIf(!mac)('prepareUpdate (real disk image, fake signed apps)', () => {
  let dir: string
  const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'pipe' })

  function makeApp(parent: string, version: string, bundleId = 'local.hive.selfupdate-test'): string {
    const app = join(parent, 'Hive.app')
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'MacOS', 'Hive'), '#!/bin/sh\necho hive\n')
    chmodSync(join(app, 'Contents', 'MacOS', 'Hive'), 0o755)
    writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Hive</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`)
    sh('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])
    return app
  }
  function makeDmg(name: string, version: string | null, bundleId?: string): string {
    const src = join(dir, `${name}-src`)
    mkdirSync(src, { recursive: true })
    if (version) makeApp(src, version, bundleId); else writeFileSync(join(src, 'readme.txt'), 'no app here')
    const dmg = join(dir, `${name}.dmg`)
    sh('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', `Hive ${name}`, '-fs', 'HFS+', dmg])
    return dmg
  }
  const installed = () => join(dir, 'Applications', 'Hive.app')

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'hive-prepare-test-')))
    mkdirSync(join(dir, 'Applications'), { recursive: true })
    makeApp(join(dir, 'Applications'), '1.0.0')
  }, 60_000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('stages a newer, validly signed Hive next to the installed one and unmounts the image', async () => {
    const r = await prepareUpdate(makeDmg('newer', '1.1.0'), installed())
    expect(r).toEqual({ ok: true, version: '1.1.0', stagedApp: join(dir, 'Applications', '.Hive-update-1.1.0', 'Hive.app') })
    const stagedApp = r.stagedApp as string
    expect(readFileSync(join(stagedApp, 'Contents', 'Info.plist'), 'utf-8')).toContain('1.1.0')
    sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
    // The installed app is untouched until the swap.
    expect(readFileSync(join(installed(), 'Contents', 'Info.plist'), 'utf-8')).toContain('1.0.0')
    expect(execFileSync('/usr/bin/hdiutil', ['info']).toString()).not.toContain('hive-update-')
  }, 60_000)

  it('refuses an image that is not newer, without staging anything', async () => {
    const r = await prepareUpdate(makeDmg('same', '1.0.0'), installed())
    expect(r).toMatchObject({ ok: false })
    expect(r.error).toMatch(/not newer/)
    expect(existsSync(join(dir, 'Applications', '.Hive-update-1.0.0'))).toBe(false)
  }, 60_000)

  it('refuses a different app', async () => {
    const r = await prepareUpdate(makeDmg('other', '9.0.0', 'local.someone.else'), installed())
    expect(r.error).toMatch(/not Hive/)
  }, 60_000)

  it('refuses an image with no Hive in it', async () => {
    const r = await prepareUpdate(makeDmg('empty', null), installed())
    expect(r.error).toMatch(/does not contain Hive/)
  }, 60_000)

  it('refuses an app whose signature no longer matches its contents', async () => {
    const src = join(dir, 'tampered-src')
    mkdirSync(src, { recursive: true })
    const app = makeApp(src, '2.0.0')
    writeFileSync(join(app, 'Contents', 'MacOS', 'Hive'), '#!/bin/sh\necho tampered\n')
    const dmg = join(dir, 'tampered.dmg')
    sh('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', 'Hive tampered', '-fs', 'HFS+', dmg])
    const r = await prepareUpdate(dmg, installed())
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'Applications', '.Hive-update-2.0.0'))).toBe(false)
  }, 60_000)

  it('reports a file that is not a disk image', async () => {
    const bogus = join(dir, 'bogus.dmg')
    writeFileSync(bogus, 'not an image')
    const r = await prepareUpdate(bogus, installed())
    expect(r.ok).toBe(false)
  }, 60_000)
})

describe('releasesApiUrl', () => {
  it('is GitHub by default', () => {
    expect(releasesApiUrl(undefined)).toBe(GITHUB_RELEASES_API)
    expect(releasesApiUrl('')).toBe(GITHUB_RELEASES_API)
  })
  it('honours a loopback override for rehearsals', () => {
    expect(releasesApiUrl('http://127.0.0.1:8123/latest')).toBe('http://127.0.0.1:8123/latest')
  })
  it('ignores anything that is not this machine', () => {
    for (const u of ['https://evil.example/latest', 'http://127.0.0.1.evil.example:80/x', 'http://localhost:80/x', 'http://192.168.1.5:80/x', 'http://127.0.0.1/x', 'file:///tmp/x']) {
      expect(releasesApiUrl(u)).toBe(GITHUB_RELEASES_API)
    }
  })
})
