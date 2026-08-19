/**
 * Hive self-updater (v2.4.0) — GitHub Releases based, no code signing
 * required. Distributes as unsigned .dmg from the nocodevit/hive repo.
 *
 * Design:
 *   1. Menu → Hive → "Check for Updates…" runs checkForUpdates() manually.
 *   2. On app startup, autoCheckIfDue() runs once per 24h (state persists
 *      in ~/.hive/updater-state.json — timestamp only).
 *   3. When a newer release is found, dialog.showMessageBox offers:
 *      - Download → net.download the .dmg to ~/Downloads, then
 *        shell.showItemInFolder so user drags into /Applications
 *      - Release notes → shell.openExternal(release.html_url)
 *      - Later → dismiss (auto-check will re-offer next day)
 *   4. When no update, dialog says "You're on the latest (vX.Y.Z) ✓"
 *      unless silent=true (auto-check path stays silent on no-update).
 *
 * All operations are graceful: network fail = silent skip on auto-check,
 * informative dialog on manual check. Never blocks app startup.
 */
import { app, dialog, shell, net, Notification } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const RELEASES_API = 'https://api.github.com/repos/nocodevit/hive/releases/latest'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24h
const STATE_PATH = () => join(homedir(), '.hive', 'updater-state.json')

interface UpdaterState {
  lastCheckedAt?: number
  lastSeenTag?: string
  snoozedTag?: string  // user clicked Later — don't re-offer THIS version
}

interface GitHubRelease {
  tag_name: string
  name?: string
  body?: string
  html_url: string
  published_at?: string
  assets: Array<{ name: string; browser_download_url: string; size?: number }>
}

/**
 * Compare two semver-style strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Accepts "vX.Y.Z" or "X.Y.Z". Pre-release suffixes are stripped.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** Read updater state or return empty. */
export function loadState(): UpdaterState {
  try {
    return JSON.parse(readFileSync(STATE_PATH(), 'utf8'))
  } catch {
    return {}
  }
}

/** Persist updater state (best-effort). */
export function saveState(state: UpdaterState): void {
  try {
    const dir = join(homedir(), '.hive')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(STATE_PATH(), JSON.stringify(state, null, 2))
  } catch { /* best effort */ }
}

/**
 * Fetch latest release metadata from GitHub. Returns null on any network
 * or parse failure (caller decides how to surface).
 */
export function fetchLatestRelease(): Promise<GitHubRelease | null> {
  return new Promise(resolve => {
    try {
      const req = net.request({
        url: RELEASES_API,
        redirect: 'follow'
      })
      req.setHeader('User-Agent', 'Hive-updater')
      req.setHeader('Accept', 'application/vnd.github+json')
      let body = ''
      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          resolve(null)
          return
        }
        res.on('data', (chunk) => { body += chunk.toString() })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as GitHubRelease
            if (typeof parsed?.tag_name === 'string' && Array.isArray(parsed.assets)) {
              resolve(parsed)
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        })
        res.on('error', () => resolve(null))
      })
      req.on('error', () => resolve(null))
      req.end()
    } catch {
      resolve(null)
    }
  })
}

/** Pick the .dmg asset for arm64 (only arch we distribute right now). */
export function pickDmgAsset(release: GitHubRelease): { name: string; url: string; size?: number } | null {
  // Prefer arm64/aarch64 explicit assets, fall back to any .dmg.
  const arm64 = release.assets.find(a => /arm64|aarch64/.test(a.name) && a.name.endsWith('.dmg'))
  if (arm64) return { name: arm64.name, url: arm64.browser_download_url, size: arm64.size }
  const anyDmg = release.assets.find(a => a.name.endsWith('.dmg'))
  if (anyDmg) return { name: anyDmg.name, url: anyDmg.browser_download_url, size: anyDmg.size }
  return null
}

/**
 * Main entry — user clicked "Check for Updates…" OR auto-check timer fired.
 * silent=true suppresses the "you're on the latest" dialog (used by
 * auto-check to avoid nagging users daily when nothing's new).
 */
export async function checkForUpdates(silent = false): Promise<void> {
  const currentVersion = app.getVersion()
  const release = await fetchLatestRelease()

  const state = loadState()
  state.lastCheckedAt = Date.now()

  if (!release) {
    saveState(state)
    if (!silent) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not reach GitHub to check for updates.',
        detail: 'Check your internet connection and try again. You can also visit https://github.com/nocodevit/hive/releases manually.',
        buttons: ['OK']
      })
    }
    return
  }

  state.lastSeenTag = release.tag_name
  saveState(state)

  const isNewer = compareVersions(release.tag_name, currentVersion) > 0
  if (!isNewer) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Hive is up to date',
        message: `You're on the latest version (${currentVersion}) ✓`,
        buttons: ['OK']
      })
    }
    return
  }

  // Silent auto-check: respect snooze on this exact tag.
  if (silent && state.snoozedTag === release.tag_name) return

  const asset = pickDmgAsset(release)
  const notesText = (release.body || '').slice(0, 800) + ((release.body || '').length > 800 ? '\n\n…(truncated)' : '')

  const choice = await dialog.showMessageBox({
    type: 'info',
    title: `Hive ${release.tag_name} available`,
    message: `A new version is available.\nCurrent: ${currentVersion} · Latest: ${release.tag_name}`,
    detail: notesText || 'No release notes provided.',
    buttons: asset
      ? ['Download & Reveal', 'View release notes', 'Later']
      : ['View release notes', 'Later'],
    defaultId: 0,
    cancelId: asset ? 2 : 1
  })

  const btnIdx = choice.response
  const btnLabel = asset
    ? ['Download & Reveal', 'View release notes', 'Later'][btnIdx]
    : ['View release notes', 'Later'][btnIdx]

  if (btnLabel === 'Later') {
    state.snoozedTag = release.tag_name
    saveState(state)
    return
  }
  if (btnLabel === 'View release notes') {
    shell.openExternal(release.html_url)
    return
  }
  if (btnLabel === 'Download & Reveal' && asset) {
    downloadAndReveal(asset.url, asset.name)
  }
}

/**
 * Download the .dmg to ~/Downloads, then Finder-reveal it. User drags
 * it into /Applications manually — no auto-install path (would require
 * signing + notarization we don't have).
 */
function downloadAndReveal(url: string, filename: string): void {
  const downloadsDir = join(homedir(), 'Downloads')
  const target = join(downloadsDir, filename)
  const notify = (title: string, body: string) => {
    try { new Notification({ title, body }).show() } catch { /* silent */ }
  }
  notify('Hive update download started', filename)
  try {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', 'Hive-updater')
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        notify('Hive update download failed', `HTTP ${res.statusCode}`)
        return
      }
      const out = createWriteStream(target)
      res.on('data', (chunk) => out.write(chunk))
      res.on('end', () => {
        out.end(() => {
          notify('Hive update downloaded', 'Opening Finder…')
          shell.showItemInFolder(target)
        })
      })
      res.on('error', (err) => {
        notify('Hive update download failed', String(err))
        out.end()
      })
    })
    req.on('error', (err) => {
      notify('Hive update download failed', String(err))
    })
    req.end()
  } catch (err) {
    notify('Hive update download failed', String(err))
  }
}

/**
 * Startup entry — check if 24h has elapsed since last check, and if so
 * run a silent check. Never surfaces "up to date" via dialog on this
 * path; only fires the "new version available" dialog when there's
 * actually something new + user hasn't snoozed this tag.
 */
export async function autoCheckIfDue(): Promise<void> {
  const state = loadState()
  const lastAt = state.lastCheckedAt || 0
  if (Date.now() - lastAt < CHECK_INTERVAL_MS) return
  await checkForUpdates(true)
}
