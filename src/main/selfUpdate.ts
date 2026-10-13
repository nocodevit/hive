// Installing an update without the user dragging anything.
//
// The old flow opened the downloaded disk image and left the user to drag
// Hive into Applications — which fails while Hive is running, i.e. always.
// Now Hive does it:
//   1. prepareUpdate   mount the image, check what is inside is a newer
//                      Hive signed by the same developer, copy it next to
//                      the installed app, unmount.
//   2. installAndQuit  start a tiny shell script that waits for Hive to
//                      exit, swaps the bundles and reopens Hive; then quit.
// If any check fails nothing is touched and the caller falls back to the
// manual installer.

import { execFile, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compareVersions } from './version'

/** /Applications/Hive.app/Contents/MacOS/Hive → /Applications/Hive.app */
export function bundlePathFromExe(exePath: string): string | null {
  const m = exePath.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/)
  return m ? m[1] : null
}

/** Why this install cannot update itself, or null when it can. */
export function selfInstallBlocker(o: { platform: string; packaged: boolean; bundlePath: string | null }): string | null {
  if (o.platform !== 'darwin') return 'automatic install is only available on macOS'
  if (!o.packaged) return 'this is a development build'
  if (!o.bundlePath) return 'Hive is not running from an app bundle'
  if (o.bundlePath.includes('/AppTranslocation/')) return 'Hive is running from a temporary location — move it to Applications first'
  if (o.bundlePath.startsWith('/Volumes/')) return 'Hive is running from a disk image'
  return null
}

/** `codesign -dv` output → the signing Team ID ('' for ad-hoc / unsigned). */
export function parseTeamId(codesignOutput: string): string {
  const m = codesignOutput.match(/^TeamIdentifier=(.+)$/m)
  const id = m ? m[1].trim() : ''
  return id === 'not set' ? '' : id
}

/**
 * Is the app on the image acceptable as a replacement for the running one?
 * Same bundle id, strictly newer, and — when the running app is signed by
 * a developer team — signed by that same team.
 */
export function replacementProblem(o: {
  currentVersion: string; currentBundleId: string; currentTeam: string
  newVersion: string; newBundleId: string; newTeam: string
}): string | null {
  if (!o.newVersion) return 'the update has no version'
  if (o.newBundleId !== o.currentBundleId) return 'the update is not Hive'
  if (compareVersions(o.newVersion, o.currentVersion) <= 0) return `the update (v${o.newVersion}) is not newer than this version`
  if (o.currentTeam && o.newTeam !== o.currentTeam) return 'the update is signed by a different developer'
  return null
}

type Run = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const run: Run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${cmd.split('/').pop()} failed: ${String(stderr || err.message).trim().split('\n').pop()}`))
    else resolve({ stdout: String(stdout), stderr: String(stderr) })
  })
})

async function plistValue(appPath: string, key: string, exec: Run): Promise<string> {
  const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, join(appPath, 'Contents', 'Info.plist')])
  return stdout.trim()
}
async function teamOf(appPath: string, exec: Run): Promise<string> {
  // codesign -dv prints to stderr.
  const { stdout, stderr } = await exec('/usr/bin/codesign', ['-dv', appPath])
  return parseTeamId(stderr + '\n' + stdout)
}

/** `ok` → stagedApp + version are set; otherwise `error` says why. */
export interface PrepareResult { ok: boolean; stagedApp?: string; version?: string; error?: string }

/**
 * Mount `dmgPath`, validate the Hive inside against the installed bundle,
 * and stage a copy beside it (same volume, so the later swap is a rename).
 */
export async function prepareUpdate(dmgPath: string, bundlePath: string, exec: Run = run): Promise<PrepareResult> {
  const mount = mkdtempSync(join(tmpdir(), 'hive-update-'))
  let attached = false
  try {
    await exec('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmgPath])
    attached = true
    const candidate = join(mount, `${bundlePath.split('/').pop()}`)
    if (!existsSync(candidate)) return { ok: false, error: 'the update image does not contain Hive' }

    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate])
    const problem = replacementProblem({
      currentVersion: await plistValue(bundlePath, 'CFBundleShortVersionString', exec),
      currentBundleId: await plistValue(bundlePath, 'CFBundleIdentifier', exec),
      currentTeam: await teamOf(bundlePath, exec),
      newVersion: await plistValue(candidate, 'CFBundleShortVersionString', exec),
      newBundleId: await plistValue(candidate, 'CFBundleIdentifier', exec),
      newTeam: await teamOf(candidate, exec)
    })
    if (problem) return { ok: false, error: problem }

    const version = await plistValue(candidate, 'CFBundleShortVersionString', exec)
    const stageDir = join(dirname(bundlePath), `.Hive-update-${version}`)
    rmSync(stageDir, { recursive: true, force: true })
    const stagedApp = join(stageDir, bundlePath.split('/').pop()!)
    await exec('/usr/bin/ditto', [candidate, stagedApp])
    // The copy is what gets installed — check it, not just the original.
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
    return { ok: true, stagedApp, version }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (attached) { try { await exec('/usr/bin/hdiutil', ['detach', mount, '-force']) } catch { /* left mounted; harmless */ } }
    try { rmSync(mount, { recursive: true, force: true }) } catch { /* still mounted */ }
  }
}

/**
 * Waits for Hive to exit, then replaces the bundle. If moving the new one
 * in fails, the old one is put back. Exit codes: 0 done · 3 Hive never
 * exited (nothing touched) · 4 staged app missing · 5 could not move the
 * old app aside · 6 could not move the new app in (old one restored).
 */
export const INSTALL_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"; RELAUNCH="$4"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  [ "$i" -gt 240 ] && exit 3
  sleep 0.25
done
[ -d "$NEW" ] || exit 4
OLD="$(dirname "$TARGET")/.Hive-previous-$$"
if [ -e "$TARGET" ]; then mv "$TARGET" "$OLD" || exit 5; fi
if mv "$NEW" "$TARGET"; then
  rm -rf "$OLD"
  rmdir "$(dirname "$NEW")" 2>/dev/null
else
  [ -e "$OLD" ] && mv "$OLD" "$TARGET"
  exit 6
fi
[ "$RELAUNCH" = "1" ] && open "$TARGET"
exit 0
`

/** Launch the swap script for `pid`; it outlives the caller. */
export function startInstaller(pid: number, stagedApp: string, bundlePath: string, relaunch = true): void {
  const script = join(mkdtempSync(join(tmpdir(), 'hive-install-')), 'install.sh')
  writeFileSync(script, INSTALL_SCRIPT)
  chmodSync(script, 0o700)
  spawn('/bin/sh', [script, String(pid), stagedApp, bundlePath, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref()
}
