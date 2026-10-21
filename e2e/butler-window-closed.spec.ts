import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync, spawn } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * A user closes Hive's window (red button) and leaves; on macOS Hive keeps
 * running in the Dock. The phone Butler must still reach it: port.lock
 * stays, the API answers, and a remote "start" reopens the window and
 * starts the chat. Quitting Hive removes port.lock.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-window-closed')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')
const PORT = 17891
const LOCK = join(HIVE_DATA_DIR, 'port.lock')

let app: ElectronApplication
let page: Page

const api = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${PORT}${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', 'X-Hive-Token': readFileSync(join(HIVE_DATA_DIR, 'api-token'), 'utf8').trim(), ...(init.headers || {}) }
})

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  // A stand-in claude: idle --print child, never talks.
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Away Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'non-rnd', hasGit: false }] }],
    agents: [{ avatar, id: 'a1', projectId: 'p1', zoneId: 'z1', name: 'Missy', role: 'Eng', type: 'non-coding', department: 'Non-R&D', group: '', order: 0, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' }],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(PORT), HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('Away Test').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('closing the window keeps port.lock and the API', async () => {
  expect(existsSync(LOCK)).toBe(true)
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close() })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  expect(existsSync(LOCK)).toBe(true)
  const r = await api('/agents')
  expect(r.status).toBe(200)
  expect((await r.json()).agents.map((a: { agent: string }) => a.agent)).toEqual(['Missy'])
})

test('a remote start with no window reopens it and starts the chat', async () => {
  const r = await api('/chat/start', { method: 'POST', body: JSON.stringify({ agent: 'Missy', mode: 'new' }) })
  const body = await r.json()
  expect(body).toMatchObject({ ok: true })
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  const rows = await (await api('/agents')).json()
  expect(rows.agents[0].chatLive).toBe(true)
})

test('a second Hive launch exits, keeps the lock, and shows the running window', async () => {
  const before = readFileSync(LOCK, 'utf8')
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close() })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  const second = spawn(require('electron') as unknown as string, [join(PROJECT_ROOT, 'out', 'main', 'index.js')], {
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(PORT), HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') },
    stdio: 'ignore'
  })
  const code = await new Promise<number | null>(r => second.on('exit', c => r(c)))
  expect(code).toBe(0)
  expect(readFileSync(LOCK, 'utf8')).toBe(before)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect((await api('/agents')).status).toBe(200)
})

test('quitting removes port.lock', async () => {
  await app.close()
  expect(existsSync(LOCK)).toBe(false)
})
