// v2.14.0 — self-contained BrowserWindow for the update dialog.
//
// Replaces dialog.showMessageBox for the "new version available" path.
// The native NSAlert route couldn't scroll, couldn't render markdown,
// and vanished the moment the user clicked "View release notes" —
// three separate complaints that all traced back to the same wrong
// primitive. This module owns the whole flow instead: render markdown
// scroll-natively, keep the window open across "View on GitHub"
// clicks, and pipe download progress into a live progress bar.
//
// UNTESTABLE: BrowserWindow / ipcMain wiring depends on the real
// Electron main-process runtime. The render logic (release-notes-render.ts)
// is a pure function and IS unit-tested. Manual-test steps live in
// docs/manual-test-plan.md.

import { BrowserWindow, ipcMain, shell, net, Notification } from 'electron'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { renderReleaseNotesHTML } from './release-notes-render.js'

export interface ShowReleaseNotesOptions {
  currentVersion: string
  latestVersion: string
  releaseTitle: string
  bodyMarkdown: string
  releaseUrl: string
  dmg: { url: string; name: string; size?: number } | null
  onLater?: () => void       // fired when user clicks Later / closes without downloading
}

// Only one release-notes window at a time.
let currentWindow: BrowserWindow | null = null

export function showReleaseNotes(opts: ShowReleaseNotesOptions): BrowserWindow {
  ensureHelloHandshakeRegistered()
  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.focus()
    return currentWindow
  }

  const preloadPath = writePreloadShim()

  const win = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 520,
    minHeight: 480,
    title: `Hive v${opts.latestVersion}`,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0a1a',
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  currentWindow = win

  const html = renderReleaseNotesHTML({
    currentVersion: opts.currentVersion,
    latestVersion: opts.latestVersion,
    releaseTitle: opts.releaseTitle,
    bodyMarkdown: opts.bodyMarkdown,
    releaseUrl: opts.releaseUrl,
    hasDmg: !!opts.dmg
  })
  const dataUrl = 'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64')
  win.loadURL(dataUrl)
  win.once('ready-to-show', () => win.show())

  // ---- IPC bridge (window-scoped) ----
  const CH = {
    openExternal: `release:${win.id}:openExternal`,
    close:        `release:${win.id}:close`,
    download:     `release:${win.id}:download`,
    progress:     `release:${win.id}:progress`,
    done:         `release:${win.id}:done`
  }

  const openExternalHandler = (_e: unknown, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url)
    }
  }
  const closeHandler = () => {
    if (!win.isDestroyed()) win.close()
  }
  let downloadStarted = false
  const downloadHandler = () => {
    if (downloadStarted || !opts.dmg) return
    downloadStarted = true
    downloadDmgWithProgress(opts.dmg.url, opts.dmg.name, (evt) => {
      if (win.isDestroyed()) return
      if (evt.type === 'progress') win.webContents.send(CH.progress, evt.payload)
      else if (evt.type === 'done') win.webContents.send(CH.done, evt.payload)
    })
  }
  ipcMain.on(CH.openExternal, openExternalHandler)
  ipcMain.on(CH.close, closeHandler)
  ipcMain.on(CH.download, downloadHandler)

  // Expose channel names to the preload so it can wire window.hiveRelease.*
  ;(win as any)._releaseChannels = CH

  win.on('closed', () => {
    ipcMain.removeListener(CH.openExternal, openExternalHandler)
    ipcMain.removeListener(CH.close, closeHandler)
    ipcMain.removeListener(CH.download, downloadHandler)
    currentWindow = null
    if (!downloadStarted && opts.onLater) opts.onLater()
  })

  return win
}

// ---- Preload shim ----
//
// We write a small preload script to a temp file (once per app run) so
// electron-vite doesn't need to bundle a second preload entry point.
// The preload reads channel names from process.argv (passed via
// additionalArguments) — but simpler: the renderer script itself
// invokes ipcRenderer through contextBridge because we generate the
// html at runtime and can splice channel ids in there. Below is the
// simplest working shape: preload discovers channels via a synchronous
// IPC handshake right after load.
let _preloadPathCache: string | null = null
function writePreloadShim(): string {
  if (_preloadPathCache) return _preloadPathCache
  const code = `
const { contextBridge, ipcRenderer } = require('electron')
// Discover channel names once. We use ipcRenderer.sendSync to a
// well-known 'release:hello' handler registered lazily below.
const CH = ipcRenderer.sendSync('release:hello')
contextBridge.exposeInMainWorld('hiveRelease', {
  openExternal: (url) => ipcRenderer.send(CH.openExternal, url),
  close:        () => ipcRenderer.send(CH.close),
  download:     () => ipcRenderer.send(CH.download),
  onProgress:   (cb) => ipcRenderer.on(CH.progress, (_e, p) => cb(p)),
  onDone:       (cb) => ipcRenderer.on(CH.done, (_e, p) => cb(p))
})
`
  const p = join(tmpdir(), `hive-release-preload-${process.pid}.js`)
  writeFileSync(p, code, 'utf8')
  _preloadPathCache = p
  return p
}

// Register the 'release:hello' handshake lazily on first
// showReleaseNotes() call. Doing it at module load breaks headless
// unit tests where Electron's ipcMain is mocked/absent, and it also
// wastes a listener slot until the user actually opens the window.
let _helloRegistered = false
function ensureHelloHandshakeRegistered(): void {
  if (_helloRegistered) return
  ipcMain.on('release:hello', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const CH = win && (win as any)._releaseChannels
    event.returnValue = CH || null
  })
  _helloRegistered = true
}

// ---- Downloader with per-chunk progress ----
type DownloadEvent =
  | { type: 'progress'; payload: { percent: number; downloaded: number; total: number; label: string } }
  | { type: 'done';     payload: { path?: string; error?: string } }

function downloadDmgWithProgress(url: string, filename: string, emit: (e: DownloadEvent) => void): void {
  const downloadsDir = join(homedir(), 'Downloads')
  const target = join(downloadsDir, filename)

  const notify = (title: string, body: string) => {
    try { new Notification({ title, body }).show() } catch { /* silent */ }
  }
  notify('Hive update download started', filename)
  emit({ type: 'progress', payload: { percent: 0, downloaded: 0, total: 0, label: 'Connecting…' } })

  try {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', 'Hive-updater')
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        emit({ type: 'done', payload: { error: `HTTP ${res.statusCode}` } })
        notify('Hive update download failed', `HTTP ${res.statusCode}`)
        return
      }
      const total = Number(res.headers['content-length']) || 0
      let downloaded = 0
      const out = createWriteStream(target)
      res.on('data', (chunk: Buffer) => {
        out.write(chunk)
        downloaded += chunk.length
        const percent = total > 0 ? (downloaded / total) * 100 : 0
        emit({
          type: 'progress',
          payload: {
            percent,
            downloaded,
            total,
            label: total > 0
              ? `Downloading… ${formatBytes(downloaded)} / ${formatBytes(total)}`
              : `Downloading… ${formatBytes(downloaded)}`
          }
        })
      })
      res.on('end', () => {
        out.end(async () => {
          emit({ type: 'progress', payload: { percent: 100, downloaded, total: total || downloaded, label: 'Opening installer…' } })
          notify('Hive update downloaded', 'Opening installer…')
          try {
            const errMsg = await shell.openPath(target)
            if (errMsg) shell.showItemInFolder(target)
          } catch {
            shell.showItemInFolder(target)
          }
          emit({ type: 'done', payload: { path: target } })
        })
      })
    })
    req.on('error', (err) => {
      emit({ type: 'done', payload: { error: err.message } })
      notify('Hive update download failed', err.message)
    })
    req.end()
  } catch (err: any) {
    emit({ type: 'done', payload: { error: err?.message || 'Download failed' } })
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
