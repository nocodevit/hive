import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from 'fs'
import { tmpdir, homedir } from 'os'

/**
 * Butler API e2e: drive a chat purely over the local HTTP API, the way
 * hive-butler does — list agents, get refused while the chat is off,
 * start it, send into it, read the reply back — and check the message
 * also shows up in the Hive window.
 *
 * Cost: 1 short claude turn. Requires a working `claude` CLI (same as
 * chat-basic.spec.ts).
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(tmpdir(), 'hive-e2e-butler-api')
const FIXTURE = join(tmpdir(), 'hive-e2e-butler-api-fixture')
const HIVE_PORT = 17817
const BASE = `http://127.0.0.1:${HIVE_PORT}`
const MARKER = 'k7m2-butler-marker'

let app: ElectronApplication
let page: Page
let token = ''

const call = (path: string, init: RequestInit = {}, withToken = true) =>
  fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(withToken ? { 'X-Hive-Token': token } : {}), ...(init.headers || {}) }
  })
const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) })

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`butler-api requires a working \`claude\` CLI on PATH: ${e?.message || e}`)
  }
  for (const d of [HIVE_DATA_DIR, FIXTURE]) {
    if (existsSync(d)) rmSync(d, { recursive: true })
    mkdirSync(d, { recursive: true })
  }
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, FIXTURE)

  await page.getByText('Add Project').click()
  await page.getByRole('button', { name: 'Browse' }).first().click()
  await page.getByPlaceholder('My Project').fill('Butler E2E')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.getByText('Butler E2E').first().click()
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.getByRole('button', { name: /Full-Stack Engineer/ }).first().click()
  await page.getByPlaceholder('e.g. Alex').fill('Robin')
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.getByRole('button', { name: 'Create Agent' }).click()
  // The agent exists but its pane was never opened: nothing is mounted or
  // running, so a remote start has to mount the chat by itself.
  await expect(page.getByText('Robin', { exact: true }).first()).toBeVisible({ timeout: 15000 })
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  for (const d of [HIVE_DATA_DIR, FIXTURE]) if (existsSync(d)) rmSync(d, { recursive: true })
  try {
    const dir = join(homedir(), '.claude', 'projects', FIXTURE.replace(/[/.]/g, '-'))
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  } catch {}
})

test('butler API: auth → list → refused while off → start → send → tail, mirrored in the window', async () => {
  // Token file is created on first use, private to the user.
  expect((await call('/agents', {}, false)).status).toBe(401)
  const tokenFile = join(HIVE_DATA_DIR, 'api-token')
  expect(existsSync(tokenFile)).toBe(true)
  expect(statSync(tokenFile).mode & 0o077).toBe(0)
  token = readFileSync(tokenFile, 'utf-8').trim()

  // A browser-originated request is refused even with the token.
  expect((await call('/agents', { headers: { Origin: 'https://example.com' } })).status).toBe(403)

  // List: the agent exists and its chat is off.
  const listed = await (await call('/agents')).json()
  expect(listed.ok).toBe(true)
  const row = listed.agents.find((a: any) => a.agent === 'Robin')
  expect(row).toMatchObject({ project: 'Butler E2E', chatLive: false, activity: 'off' })

  // Exact-name matching only.
  expect((await post('/chat/send', { project: 'Butler E2E', agent: 'robin', text: 'hi' })).status).toBe(404)

  // Sending to a chat that is not running is refused, and starts nothing.
  const refused = await post('/chat/send', { project: 'Butler E2E', agent: 'Robin', text: 'hi' })
  expect(refused.status).toBe(409)
  expect((await refused.json()).error).toBe('no_session')
  expect((await (await call('/agents')).json()).agents.find((a: any) => a.agent === 'Robin').chatLive).toBe(false)

  // Start a fresh session over the API.
  const started = await post('/chat/start', { project: 'Butler E2E', agent: 'Robin', mode: 'new' })
  expect(started.status).toBe(200)
  expect((await started.json()).started).toBe(true)

  // Starting again is a no-op.
  expect((await (await post('/chat/start', { agentId: row.agentId })).json()).alreadyRunning).toBe(true)

  // Send into the chat.
  const sent = await post('/chat/send', { agentId: row.agentId, text: `Do not use any tools. Reply with exactly: ${MARKER}` })
  expect(sent.status).toBe(200)
  expect((await sent.json()).ok).toBe(true)

  // The reply is readable back through the API…
  await expect.poll(async () => {
    const tail = await (await call(`/chat/tail?agentId=${row.agentId}&n=10`)).json()
    return tail.items.some((i: any) => i.role === 'assistant' && i.text.includes(MARKER))
      && tail.items.some((i: any) => i.role === 'result')
  }, { timeout: 120000, intervals: [1000] }).toBe(true)
  const tail = await (await call(`/chat/tail?agentId=${row.agentId}&n=10`)).json()
  expect(tail.items[0]).toMatchObject({ role: 'user' })
  expect(tail.items[0].text).toContain(MARKER)

  // …and once the user opens that agent, the window shows both the
  // externally-sent bubble and the reply. The remote start must not have
  // stolen the selection.
  await expect(page.getByTestId('hive-chat-input')).toBeHidden()
  await page.getByText('Robin', { exact: true }).first().click()
  await expect(page.getByTestId('hive-chat-input')).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => {
    const body = await page.locator('body').innerText()
    return body.split(MARKER).length - 1
  }, { timeout: 15000 }).toBeGreaterThanOrEqual(2)

  // Back to idle.
  await expect.poll(async () =>
    (await (await call('/agents')).json()).agents.find((a: any) => a.agent === 'Robin').activity
  , { timeout: 15000 }).toBe('waiting')
})

test('chat-search: a run token that ended sees nothing; not signed in is said plainly', async () => {
  const ended = await call('/feishu/chat-search?q=roaming', { headers: { 'X-Hive-Run': 'no-such-run' } })
  expect(ended.status).toBe(200)
  expect(await ended.json()).toEqual({ ok: true, hits: [], note: 'run ended' })
  const owner = await (await call('/feishu/chat-search?q=roaming')).json()
  expect(owner).toEqual({ ok: true, hits: [], note: 'Feishu not signed in' })
})

test('feishu-try: owner only, needs text, not signed in is said plainly', async () => {
  expect((await post('/feishu/try', { text: ' ' })).status).toBe(400)
  const inRun = await call('/feishu/try', { method: 'POST', body: JSON.stringify({ text: 'hi' }), headers: { 'X-Hive-Run': 'r1' } })
  expect(inRun.status).toBe(403)
  expect(await (await post('/feishu/try', { text: 'FAE-1 上线了吗？' })).json()).toEqual({ ok: false, error: 'signed_out' })
})

test('routines/run: runs one routine now and says how it went; "jira" is the Jira routine', async () => {
  expect((await post('/routines/run', { id: 'nope' })).status).toBe(400)
  const inbox = await (await post('/routines/run', { id: 'sort-inbox' })).json()
  expect(inbox).toMatchObject({ ok: true, name: 'Sort inbox', run: { id: 'sort-inbox', ok: true } })
  const jira = await (await post('/routines/run', { id: 'jira' })).json()
  expect(jira).toMatchObject({ ok: false, name: 'Jira', run: { id: 'jira-check', ok: false, error: 'Jira not connected' } })
})
