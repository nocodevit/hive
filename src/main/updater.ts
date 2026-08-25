/**
 * Hive self-updater — GitHub Releases based, no code signing required.
 * Distributes unsigned .dmg from the nocodevit/hive repo.
 *
 * Design (v2.14.0):
 *   1. Menu → Hive → "Check for Updates…" runs checkForUpdates() manually.
 *   2. On app startup, autoCheckIfDue() runs once per 24h (state persists
 *      in ~/.hive/updater-state.json — timestamp only).
 *   3. When a newer release is found, showReleaseNotes() opens a custom
 *      BrowserWindow (see release-notes-window.ts) that renders the full
 *      markdown release body, keeps the "View on GitHub" link click
 *      non-destructive, and streams download progress inline. Native
 *      dialog.showMessageBox is only used for the tiny "up to date" and
 *      "check failed" states where scroll/markdown don't matter.
 *   4. All operations are graceful: network fail = silent skip on
 *      auto-check, informative dialog on manual check.
 */
import { app, dialog, net } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { showReleaseNotes } from './release-notes-window.js'

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
  const tagStripped = release.tag_name.replace(/^v/, '')

  // v2.14.0: swap dialog.showMessageBox for a self-owned BrowserWindow.
  // The native NSAlert route lost markdown, lost scrolling, closed on
  // "View release notes" click, and gave zero download progress —
  // four separate bugs all rooted in the wrong primitive. The window
  // owns render + download-with-progress + external-link handling
  // without ever closing itself for a link click.
  showReleaseNotes({
    currentVersion,
    latestVersion: tagStripped,
    releaseTitle: release.name || `Hive v${tagStripped}`,
    bodyMarkdown: release.body || '',
    releaseUrl: release.html_url,
    dmg: asset ? { url: asset.url, name: asset.name, size: asset.size } : null,
    onLater: () => {
      state.snoozedTag = release.tag_name
      saveState(state)
    }
  })
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
