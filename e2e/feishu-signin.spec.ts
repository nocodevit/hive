import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { createServer, type Server } from 'http'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * App Settings → Feishu → "Sign in with Feishu" against a fake Prime relay
 * on 127.0.0.1: the start URL Hive would open in the browser is captured
 * (no real browser), the relay's redirect to Hive's loopback callback is
 * replayed, the code is exchanged, the session survives a restart, and
 * sign-out clears it. Tokens go to a plain file in the isolated data dir
 * (HIVE_FEISHU_PLAIN_STORE), never the Keychain.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(tmpdir(), 'hive-e2e-feishu-signin')
const RELAY_PORT = 17841
const RELAY = `http://127.0.0.1:${RELAY_PORT}`

let app: ElectronApplication
let page: Page
let relay: Server
const relayCalls: Array<{ path: string; body: any; headers: Record<string, unknown> }> = []

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17842', HIVE_DATA_DIR, HIVE_FEISHU_RELAY: RELAY, HIVE_FEISHU_PLAIN_STORE: '1' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ shell }) => {
    ;(globalThis as any).__opened = []
    shell.openExternal = async (u: string) => { (globalThis as any).__opened.push(u) }
  })
  await page.getByRole('button', { name: 'App Settings' }).click()
}

const opened = () => app.evaluate(() => (globalThis as any).__opened as string[])

test.beforeAll(async () => {
  if (existsSync(HIVE_DATA_DIR)) rmSync(HIVE_DATA_DIR, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  relay = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      relayCalls.push({ path: req.url || '', body, headers: req.headers })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, access_token: 'u-fake', expires_in: 7200, refresh_token: 'ur-fake',
        refresh_token_expires_in: 604800, scope: 'offline_access im:message', open_id: 'ou_fake', name: 'Mei Test' }))
    })
  })
  await new Promise<void>(r => relay.listen(RELAY_PORT, '127.0.0.1', () => r()))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  await new Promise<void>(r => relay.close(() => r()))
})

test('starts signed out', async () => {
  await expect(page.getByText('Not connected')).toBeVisible()
})

test('sign in: browser opens the relay, callback is exchanged, name shows', async () => {
  await page.getByRole('button', { name: 'Sign in with Feishu' }).click()
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeVisible()
  await expect.poll(async () => (await opened()).length).toBe(1)
  const start = new URL((await opened())[0])
  expect(start.origin + start.pathname).toBe(`${RELAY}/api/hive/oauth/start`)
  const port = start.searchParams.get('port')
  const state = start.searchParams.get('state')!

  // A callback without our state is refused and does not sign in.
  const wrong = await fetch(`http://127.0.0.1:${port}/callback?code=x&state=nope`)
  expect(wrong.status).toBe(400)

  // What the relay's redirect would do in the browser.
  const ok = await fetch(`http://127.0.0.1:${port}/callback?code=C0DE&state=${encodeURIComponent(state)}`)
  expect(await ok.text()).toContain('Signed in to Feishu')

  await expect(page.getByText('Signed in · Mei Test')).toBeVisible()
  const exchange = relayCalls.find(c => c.path === '/api/hive/oauth/token')!
  expect(exchange.body).toMatchObject({ code: 'C0DE', redirect_uri: `${RELAY}/api/hive/oauth/callback` })
  expect(exchange.headers['x-hive-client']).toBe('1')
  expect(exchange.headers.origin).toBeUndefined()
  expect(JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'feishu-token.bin'), 'utf8'))).toMatchObject({ accessToken: 'u-fake', name: 'Mei Test' })
})

test('the session survives a restart', async () => {
  await app.close()
  await launch()
  await expect(page.getByText('Signed in · Mei Test')).toBeVisible()
})

test('sign out clears it', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Not connected')).toBeVisible()
  expect(existsSync(join(HIVE_DATA_DIR, 'feishu-token.bin'))).toBe(false)
})
