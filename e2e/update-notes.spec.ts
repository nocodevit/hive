import { test, expect, ElectronApplication } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createServer, Server } from 'http'

/**
 * Someone several versions behind sees the notes of EVERY version they skip
 * in the update window, newest first — not only the newest one's. A loopback
 * server plays GitHub (HIVE_RELEASES_API), so nothing leaves the machine.
 */

const PROJECT_ROOT = join(__dirname, '..')
const bump = (v: string, n: number) => { const [a, b] = v.split('.').map(Number); return `${a}.${b + n}.0` }
const rel = (v: string, body: string) => ({ tag_name: `v${v}`, name: `Hive v${v}`, body, html_url: `https://example.invalid/${v}`, published_at: '2026-10-27T00:00:00Z', assets: [] })
// Built once the app says which version it runs (app.getVersion()).
let current = '', v1 = '', v2 = '', v3 = ''
let releases: ReturnType<typeof rel>[] = []

let app: ElectronApplication
let server: Server
let dataDir: string
const hits: string[] = []

test.beforeAll(async () => {
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 90000 })
  server = createServer((req, res) => {
    hits.push(req.url || '')
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.startsWith('/repos/x/releases/latest')) return res.end(JSON.stringify(releases[0]))
    if (req.url?.startsWith('/repos/x/releases?')) return res.end(JSON.stringify(releases))
    res.statusCode = 404; res.end('{}')
  })
  await new Promise<void>(r => server.listen(17897, '127.0.0.1', r))
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-update-notes-'))
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17898', HIVE_DATA_DIR: dataDir, HIVE_RELEASES_API: 'http://127.0.0.1:17897/repos/x/releases/latest' }
  })
  await app.firstWindow({ timeout: 60000 })
  current = await app.evaluate(({ app }) => app.getVersion())
  ;[v1, v2, v3] = [bump(current, 1), bump(current, 2), bump(current, 3)]
  releases = [rel(v3, '- 🎃 newest thing'), rel(v2, '- ⚡ priority thing'), rel(v1, '- 🎙 voice thing'), rel(current, '- already have this')]
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  server?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('three versions behind: the update window lists all three, newest first, and not the one already installed', async () => {
  const opened = app.waitForEvent('window', { timeout: 20000 })
  // Hive › Check for Updates…, as the owner would.
  await app.evaluate(({ Menu }) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) { if (/Check for Updates/.test(i.label)) return i; const sub = i.submenu && find(i.submenu.items); if (sub) return sub }
    }
    const item = find(Menu.getApplicationMenu()?.items ?? [])
    if (!item) throw new Error('no Check for Updates menu item')
    item.click()
  })
  const notes = await opened.catch(e => { throw new Error(`no update window; server saw ${JSON.stringify(hits)}`) })
  await notes.waitForLoadState('domcontentloaded')
  const body = notes.locator('body')
  await expect(body).toContainText('🎃 newest thing')
  await expect(body).toContainText('⚡ priority thing')
  await expect(body).toContainText('🎙 voice thing')
  await expect(body).not.toContainText('already have this')
  await expect(body).toContainText(`3 updates since v${current}`)
  const text = await body.innerText()
  expect(text.indexOf(v3)).toBeLessThan(text.indexOf(v2))
  expect(text.indexOf(v2)).toBeLessThan(text.indexOf(v1))
  await notes.screenshot({ path: test.info().outputPath('update-notes.png') })
})
